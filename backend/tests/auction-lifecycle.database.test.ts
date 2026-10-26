import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { createAuctionLifecycleRepository } from "../src/modules/auctions/auction-lifecycle.repository";
import { AuctionLifecycleService } from "../src/modules/auctions/auction-lifecycle.service";
import { verifyOpeningAuditChain } from "../src/modules/audit/opening-audit";
import { BidService } from "../src/modules/bids/bid.service";
import { createBidRepository } from "../src/modules/bids/bid.repository";
import { WalletService } from "../src/modules/wallet/wallet.service";
import { createWalletRepository } from "../src/modules/wallet/wallet.repository";
import { HttpError } from "../src/errors/http-error";
import { seedLifecycle, withLifecycleDatabase } from "./helpers/lifecycle-database";

describe("Transições PostgreSQL (tabelas isoladas descartáveis)", { skip: process.env.AUCTION_LIFECYCLE_DATABASE_TESTS !== "1" }, () => {
  const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;
  const service = (client: PrismaClient) => new AuctionLifecycleService(createAuctionLifecycleRepository(() => client));
  async function scheduled(client: PrismaClient, lots = 2) {
    const fixture = await seedLifecycle(client, { future: false, lots });
    await client.auction.update({ where: { id: fixture.auctionId }, data: { status: "SCHEDULED" } });
    return fixture;
  }
  it("agenda somente o DRAFT do responsável, com lotes válidos e sem tocar finanças", async () => {
    await withLifecycleDatabase(async client => {
      const f = await seedLifecycle(client);
      await assert.rejects(service(client).transition(f.auctionId, "schedule", f.otherId), status(403));
      const first = await service(client).transition(f.auctionId, "schedule", f.ownerId); assert.equal(first.auction.status, "SCHEDULED"); assert.equal(first.unchanged, false);
      assert.equal((await service(client).transition(f.auctionId, "schedule", f.ownerId)).unchanged, true);
      assert.equal(await client.lot.count({ where: { auctionId: f.auctionId, status: "PENDING" } }), 2);
      assert.equal(await client.walletTransaction.count(), 0); assert.equal(await client.auditEvent.count(), 0);
    });
  });
  it("recusa agendamento sem lotes e abertura antes/depois do período", async () => {
    await withLifecycleDatabase(async client => {
      const empty = await seedLifecycle(client, { lots: 0 }); await assert.rejects(service(client).transition(empty.auctionId, "schedule", empty.ownerId), status(409));
      const f = await seedLifecycle(client); await service(client).transition(f.auctionId, "schedule", f.ownerId);
      await assert.rejects(service(client).transition(f.auctionId, "open", f.ownerId), status(409));
      await client.auction.update({ where: { id: f.auctionId }, data: { startsAt: new Date(Date.now() - 2000), endsAt: new Date(Date.now() - 1000) } });
      await assert.rejects(service(client).transition(f.auctionId, "open", f.ownerId), status(409));
      assert.equal(await client.auditEvent.count(), 0); assert.equal(await client.lot.count({ where: { auctionId: f.auctionId, status: "OPEN" } }), 0);
    });
  });
  it("abre leilão e todos os PENDING elegíveis, preservando CANCELLED, com cadeia válida", async () => {
    await withLifecycleDatabase(async client => {
      const f = await scheduled(client, 3); await client.lot.update({ where: { id: f.lotIds[2] }, data: { status: "CANCELLED" } });
      const result = await service(client).transition(f.auctionId, "open", f.ownerId); assert.equal(result.openedLots, 2); assert.equal(result.auction.status, "OPEN");
      assert.equal((await client.lot.findUniqueOrThrow({ where: { id: f.lotIds[2] } })).status, "CANCELLED");
      const events = await client.auditEvent.findMany({ orderBy: { sequence: "asc" } }); assert.equal(events.length, 3); assert(verifyOpeningAuditChain(events));
      assert.equal(events[0].action, "AUCTION_OPENED"); assert.equal(events[0].previousHash, null); assert(events.every(event => event.authorId === f.ownerId));
      assert.equal(events.filter(event => event.action === "LOT_OPENED").length, 2);
      assert(!JSON.stringify(events.map(event => event.publicData)).includes(f.ownerId));
      const repeat = await service(client).transition(f.auctionId, "open", f.ownerId); assert.equal(repeat.unchanged, true); assert.equal(repeat.openedLots, 0); assert.equal(await client.auditEvent.count(), 3);
    });
  });
  it("revalida propriedade do veículo e histórico após agendamento", async () => {
    await withLifecycleDatabase(async client => {
      const f = await scheduled(client); const lot = await client.lot.findUniqueOrThrow({ where: { id: f.lotIds[0] } });
      await client.vehicle.update({ where: { id: lot.vehicleId }, data: { ownerId: f.otherId } });
      await assert.rejects(service(client).transition(f.auctionId, "open", f.ownerId), status(409));
      await client.vehicle.update({ where: { id: lot.vehicleId }, data: { ownerId: f.ownerId } });
      await client.bid.create({ data: { userId: f.bidderId, lotId: lot.id, amount: "100", sequence: 1 } });
      await assert.rejects(service(client).transition(f.auctionId, "open", f.ownerId), status(409));
      assert.equal(await client.bid.count(), 1); assert.equal(await client.auditEvent.count(), 0);
    });
  });
  it("falha no segundo evento reverte leilão, lotes, versões e evento inicial", async () => {
    await withLifecycleDatabase(async client => {
      const f = await scheduled(client); let inserts = 0;
      const failing = { $transaction: (operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) => client.$transaction(async tx => {
        const audit = new Proxy(tx.auditEvent, { get(target, property) {
          if (property === "create") return async (...args: Parameters<typeof tx.auditEvent.create>) => {
            if (++inserts === 2) throw new Error("Falha de auditoria simulada");
            return tx.auditEvent.create(...args);
          };
          return Reflect.get(target, property);
        } });
        return operation(new Proxy(tx, { get(target, property) { return property === "auditEvent" ? audit : Reflect.get(target, property); } }));
      }, options) } as unknown as PrismaClient;
      await assert.rejects(service(failing).transition(f.auctionId, "open", f.ownerId), /Falha de auditoria/);
      assert.equal((await client.auction.findUniqueOrThrow({ where: { id: f.auctionId } })).status, "SCHEDULED");
      const lots = await client.lot.findMany({ where: { auctionId: f.auctionId } }); assert(lots.every(lot => lot.status === "PENDING" && lot.version === 0)); assert.equal(await client.auditEvent.count(), 0);
    });
  });
  it("cadeia adulterada bloqueia nova abertura sem tentar reparar registros", async () => {
    await withLifecycleDatabase(async client => {
      const first = await scheduled(client); await service(client).transition(first.auctionId, "open", first.ownerId);
      const event = await client.auditEvent.findFirstOrThrow(); await client.auditEvent.update({ where: { id: event.id }, data: { currentHash: "0".repeat(64) } });
      const next = await scheduled(client); await assert.rejects(service(client).transition(next.auctionId, "open", next.ownerId), status(409));
      assert.equal((await client.auction.findUniqueOrThrow({ where: { id: next.auctionId } })).status, "SCHEDULED");
      assert.equal((await client.auditEvent.findUniqueOrThrow({ where: { id: event.id } })).currentHash, "0".repeat(64)); assert.equal(await client.auditEvent.count(), 3);
    });
  });
  it("abertura habilita lance e reserva sem alterar o saldo total", async () => {
    await withLifecycleDatabase(async client => {
      const f = await scheduled(client); await client.wallet.create({ data: { userId: f.bidderId, balance: "500" } });
      const bids = new BidService(createBidRepository(() => client));
      await assert.rejects(bids.place(f.lotIds[0], f.bidderId, "100", "first"), status(409));
      await service(client).transition(f.auctionId, "open", f.ownerId);
      const accepted = await bids.place(f.lotIds[0], f.bidderId, "100", "first"); assert.equal(accepted.bid.sequence, 1);
      const wallets = new WalletService(createWalletRepository(() => client)); assert.deepEqual(await wallets.get(f.bidderId), { totalBalance: "500.00", reservedBalance: "100.00", availableBalance: "400.00" });
      assert.equal(await client.auditEvent.count(), 3);
    });
  });
  it("aberturas concorrentes do mesmo leilão não duplicam lotes nem eventos", async () => {
    await withLifecycleDatabase(async client => {
      const f = await scheduled(client); const api = service(client);
      const results = await Promise.allSettled([api.transition(f.auctionId, "open", f.ownerId), api.transition(f.auctionId, "open", f.ownerId)]);
      const accepted = results.map(result => { if (result.status === "rejected") throw result.reason; return result.value; });
      assert.equal(accepted.filter(result => result.unchanged).length, 1); assert.equal(await client.auditEvent.count(), 3);
      assert((await client.lot.findMany({ where: { auctionId: f.auctionId } })).every(lot => lot.version === 1));
      assert(verifyOpeningAuditChain(await client.auditEvent.findMany({ orderBy: { sequence: "asc" } })));
    });
  });
  it("aberturas de leilões distintos serializam a cadeia global e criam uma única raiz", async () => {
    await withLifecycleDatabase(async client => {
      const a = await scheduled(client), b = await scheduled(client), api = service(client);
      const results = await Promise.allSettled([api.transition(a.auctionId, "open", a.ownerId), api.transition(b.auctionId, "open", b.ownerId)]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
      const events = await client.auditEvent.findMany({ orderBy: { sequence: "asc" } }); assert.equal(events.length, 6); assert.equal(events.filter(event => event.previousHash === null).length, 1); assert(verifyOpeningAuditChain(events));
    });
  });
  it("lance concorrente nunca vê abertura parcial e pode reenviar sua chave", async () => {
    await withLifecycleDatabase(async client => {
      const f = await scheduled(client); await client.wallet.create({ data: { userId: f.bidderId, balance: "500" } });
      const bids = new BidService(createBidRepository(() => client));
      const results = await Promise.allSettled([service(client).transition(f.auctionId, "open", f.ownerId), bids.place(f.lotIds[0], f.bidderId, "100", "race")]);
      if (results[0].status === "rejected") throw results[0].reason;
      if (results[1].status === "rejected") { assert(results[1].reason instanceof HttpError); assert.equal(results[1].reason.status, 409); }
      await bids.place(f.lotIds[0], f.bidderId, "100", "race");
      assert.equal(await client.bid.count(), 1); assert.equal(await client.bidReservation.count({ where: { status: "ACTIVE" } }), 1); assert.equal(await client.auditEvent.count(), 3);
    });
  });
  it("espera na auditoria não abre leilão depois do término", async () => {
    await withLifecycleDatabase(async client => {
      const f = await scheduled(client); let ready!: () => void, unlock!: () => void;
      const locked = new Promise<void>(resolve => ready = resolve), release = new Promise<void>(resolve => unlock = resolve);
      const blocker = client.$transaction(async tx => {
        await tx.$executeRaw`LOCK TABLE "AuditEvent" IN SHARE ROW EXCLUSIVE MODE`;
        ready(); await release;
      });
      await locked;
      await client.auction.update({ where: { id: f.auctionId }, data: { endsAt: new Date(Date.now() + 400) } });
      const opening = service(client).transition(f.auctionId, "open", f.ownerId).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      try { await delay(700); } finally { unlock(); await blocker; }
      const result = await opening; assert(result.error instanceof HttpError); assert.equal(result.error.status, 409);
      assert.equal((await client.auction.findUniqueOrThrow({ where: { id: f.auctionId } })).status, "SCHEDULED"); assert.equal(await client.auditEvent.count(), 0);
    });
  });
});
