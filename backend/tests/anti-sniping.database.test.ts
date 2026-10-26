import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { withLifecycleDatabase } from "./helpers/lifecycle-database";
import { seedBidFixture } from "./helpers/bid-fixture";
import { BidService } from "../src/modules/bids/bid.service";
import { createBidRepository } from "../src/modules/bids/bid.repository";
import { LotService } from "../src/modules/lots/lot.service";
import { createLotRepository } from "../src/modules/lots/lot.repository";
import { WalletService } from "../src/modules/wallet/wallet.service";
import { createWalletRepository } from "../src/modules/wallet/wallet.repository";
import { BidEventBus, BidExecutionQueue, type LotExtendedEvent } from "../src/realtime/bid-events";
import { HttpError } from "../src/errors/http-error";

describe("Anti-sniping PostgreSQL (tabelas isoladas)", { skip: process.env.ANTI_SNIPING_DATABASE_TESTS !== "1" }, () => {
  const status = (code: number) => (e: unknown) => e instanceof HttpError && e.status === code;
  async function fixture(check: (c: {
    client: PrismaClient; service: BidService; secondService: BidService; lots: LotService; wallets: WalletService;
    bidders: string[]; lotIds: string[]; auctionIds: string[]; walletIds: string[]; end: Date;
    control: { now: Date; rollback: boolean }; extensions: LotExtendedEvent[]; order: string[];
  }) => Promise<void>) {
    await withLifecycleDatabase(async client => {
      const ids = await client.$transaction(seedBidFixture), end = new Date(Date.now() + 3600000);
      for (const id of ids.auctionIds) await client.auction.update({ where: { id }, data: { endsAt: end } });
      const control = { now: new Date(end.getTime() - 60000), rollback: false }, events = new BidEventBus(), extensions: LotExtendedEvent[] = [], order: string[] = [];
      events.subscribe(event => { order.push(`bid:${event.sequence}`); }); events.subscribeExtensions(event => { extensions.push(event); order.push("extended"); });
      // Only the SQL clock result is controlled for exact millisecond boundaries.
      // All locks, writes, isolation, balances and commits use PostgreSQL itself.
      const scoped = { $transaction: (operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) => client.$transaction(async tx => {
        const wrapped = new Proxy(tx, { get(target, property) {
          if (property === "$queryRaw") return (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (Array.isArray(strings) && strings.join("").includes("EXTRACT(EPOCH FROM clock_timestamp())")) return Promise.resolve([{ milliseconds: BigInt(control.now.getTime()) }]);
            return tx.$queryRaw(strings, ...values);
          };
          return Reflect.get(target, property);
        } });
        const result = await operation(wrapped); if (control.rollback) throw new HttpError(409, "Rollback de teste"); return result;
      }, options) } as unknown as PrismaClient;
      await check({ ...ids, client, end, control, extensions, order,
        service: new BidService(createBidRepository(() => scoped), events, new BidExecutionQueue()),
        secondService: new BidService(createBidRepository(() => scoped), events, new BidExecutionQueue()),
        lots: new LotService(createLotRepository(() => client)), wallets: new WalletService(createWalletRepository(() => client)),
      });
    });
  }
  for (const [label, remaining] of [["fora da janela", 120001], ["no limite exato", 120000], ["dentro da janela", 119999]] as const) it(`lance ${label} mantém consistência e só emite mudança real`, async () => {
    await fixture(async ({ client, service, bidders, lotIds, control, end, extensions }) => {
      control.now = new Date(end.getTime() - remaining); const result = await service.place(lotIds[0], bidders[0], "100", "first");
      const lot = await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } });
      if (remaining < 120000) { assert.equal(lot.endsAt?.getTime(), control.now.getTime() + 120000); assert.equal(extensions[0].triggerBidId, result.bid.id); assert.equal(extensions.length, 1); }
      else { assert.equal(lot.endsAt, null); assert.equal(extensions.length, 0); }
    });
  });
  it("no prazo e após ele rejeita, sem prorrogar ou reservar", async () => {
    await fixture(async ({ client, service, bidders, lotIds, control, end, extensions }) => {
      for (const delta of [0, 1]) { control.now = new Date(end.getTime() + delta); await assert.rejects(service.place(lotIds[0], bidders[0], "100", `expired-${delta}`), status(409)); }
      assert.equal(await client.bid.count(), 0); assert.equal(await client.bidReservation.count(), 0); assert.equal(extensions.length, 0);
    });
  });
  it("primeira prorrogação é independente e REST retorna sempre o prazo efetivo", async () => {
    await fixture(async ({ client, service, lots, bidders, lotIds, auctionIds, control, end, extensions, order }) => {
      // Both lots belong to the same auction; extending one must not affect its sibling.
      await client.lot.update({ where: { id: lotIds[1] }, data: { auctionId: auctionIds[0], number: 2 } });
      assert.equal((await lots.findById(auctionIds[0], lotIds[0])).endsAt.getTime(), end.getTime());
      await service.place(lotIds[0], bidders[0], "100", "first");
      const expected = control.now.getTime() + 120000;
      assert.equal((await lots.findById(auctionIds[0], lotIds[0])).endsAt.getTime(), expected);
      assert.equal((await lots.findById(auctionIds[0], lotIds[1])).endsAt.getTime(), end.getTime());
      const page = await lots.list(auctionIds[0], { page: 1, limit: 20 }); assert.equal(page.data.find(l => l.id === lotIds[0])!.endsAt.getTime(), expected);
      assert.equal((await client.auction.findUniqueOrThrow({ where: { id: auctionIds[0] } })).endsAt.getTime(), end.getTime());
      assert.equal((await client.lot.findUniqueOrThrow({ where: { id: lotIds[1] } })).endsAt, null);
      assert.deepEqual(order, ["bid:1", "extended"]); assert.equal(extensions[0].previousEndsAt, end.toISOString());
      control.now = new Date(end.getTime() + 1000);
      await assert.rejects(service.place(lotIds[1], bidders[0], "100", "expired-sibling"), status(409));
      assert.equal((await service.place(lotIds[0], bidders[0], "110", "still-open")).replayed, false);
    });
  });
  it("prorroga sucessivamente e aceita após o prazo-base, até o novo prazo", async () => {
    await fixture(async ({ client, service, wallets, bidders, lotIds, control, end, extensions }) => {
      await service.place(lotIds[0], bidders[0], "100", "first");
      const firstEnd = (await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } })).endsAt!;
      control.now = new Date(end.getTime() + 1000); await service.place(lotIds[0], bidders[1], "110", "second");
      const secondEnd = (await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } })).endsAt!;
      assert.equal(secondEnd.getTime(), control.now.getTime() + 120000); assert(secondEnd > firstEnd); assert.equal(extensions[1].previousEndsAt, firstEnd.toISOString());
      control.now = secondEnd; await assert.rejects(service.place(lotIds[0], bidders[0], "120", "expired"), status(409));
      assert.equal((await wallets.get(bidders[0])).reservedBalance, "0.00"); assert.deepEqual(await wallets.get(bidders[1]), { totalBalance: "500.00", reservedBalance: "110.00", availableBalance: "390.00" });
    });
  });
  it("replay antigo não reemite nem prorroga mesmo depois do prazo", async () => {
    await fixture(async ({ client, service, bidders, lotIds, control, end, extensions, order }) => {
      const first = await service.place(lotIds[0], bidders[0], "100", "same"); const stored = await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } });
      control.now = new Date(end.getTime() + 999999); const replay = await service.place(lotIds[0], bidders[0], "100.00", "same");
      assert(replay.replayed); assert.equal(replay.bid.id, first.bid.id); assert.deepEqual(await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } }), stored);
      assert.equal(extensions.length, 1); assert.equal(order.length, 2);
    });
  });
  it("valor inválido, incremento e falta de saldo não alteram o prazo", async () => {
    await fixture(async ({ client, service, bidders, lotIds, extensions }) => {
      await assert.rejects(service.place(lotIds[0], bidders[0], "0", "invalid"), status(400));
      await assert.rejects(service.place(lotIds[0], bidders[0], "99", "low"), status(409));
      await assert.rejects(service.place(lotIds[0], bidders[0], "501", "poor"), status(409));
      assert.equal((await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } })).endsAt, null); assert.equal(extensions.length, 0);
      await service.place(lotIds[0], bidders[0], "100", "first"); const stored = await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } });
      await assert.rejects(service.place(lotIds[0], bidders[1], "109", "increment"), status(409)); assert.deepEqual(await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } }), stored); assert.equal(extensions.length, 1);
    });
  });
  it("rollback após todas as gravações reverte prazo, lance, reserva e eventos", async () => {
    await fixture(async ({ client, service, bidders, lotIds, control, extensions, order }) => {
      control.rollback = true; await assert.rejects(service.place(lotIds[0], bidders[0], "100", "fail"), status(409));
      const lot = await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } }); assert.equal(lot.endsAt, null); assert.equal(lot.version, 0);
      assert.equal(await client.bid.count(), 0); assert.equal(await client.bidReservation.count(), 0); assert.equal(await client.walletTransaction.count({ where: { type: "RESERVE" } }), 0); assert.equal(extensions.length, 0); assert.equal(order.length, 0);
    });
  });
  it("instâncias concorrentes disputam o mesmo lote sem regressão temporal ou dupla reserva", async () => {
    await fixture(async ({ client, service, secondService, bidders, lotIds, control, extensions }) => {
      const results = await Promise.allSettled([service.place(lotIds[0], bidders[0], "100", "a"), secondService.place(lotIds[0], bidders[1], "110", "b")]);
      for (const result of results) if (result.status === "rejected") assert(status(409)(result.reason));
      const latest = await client.bid.findFirstOrThrow({ where: { lotId: lotIds[0] }, orderBy: { sequence: "desc" } }); assert.equal(latest.amount.toFixed(2), "110.00");
      const active = await client.bidReservation.findMany({ where: { lotId: lotIds[0], status: "ACTIVE" } }); assert.equal(active.length, 1); assert.equal(active[0].bidId, latest.id);
      assert.equal((await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } })).endsAt?.getTime(), control.now.getTime() + 120000); assert.equal(extensions.length, 1);
    });
  });
  it("o relógio real do PostgreSQL define a prorrogação, sem relógio injetado", async () => {
    await withLifecycleDatabase(async client => {
      const ids = await client.$transaction(seedBidFixture);
      await client.auction.update({ where: { id: ids.auctionIds[0] }, data: { endsAt: new Date(Date.now() + 60000) } });
      const service = new BidService(createBidRepository(() => client)); const accepted = await service.place(ids.lotIds[0], ids.bidders[0], "100", "real");
      const lot = await client.lot.findUniqueOrThrow({ where: { id: ids.lotIds[0] } }); assert.equal(lot.endsAt!.getTime(), accepted.bid.createdAt.getTime() + 120000);
    });
  });
  it("prazo prorrogado não permite lance se o leilão deixou de estar OPEN", async () => {
    await fixture(async ({ client, service, bidders, lotIds, auctionIds, control, end, extensions }) => {
      await service.place(lotIds[0], bidders[0], "100", "first"); const stored = await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } });
      await client.auction.update({ where: { id: auctionIds[0] }, data: { status: "CLOSED" } }); control.now = new Date(end.getTime() + 1000);
      await assert.rejects(service.place(lotIds[0], bidders[1], "110", "closed"), status(409));
      assert.deepEqual(await client.lot.findUniqueOrThrow({ where: { id: lotIds[0] } }), stored); assert.equal(extensions.length, 1);
    });
  });
});
