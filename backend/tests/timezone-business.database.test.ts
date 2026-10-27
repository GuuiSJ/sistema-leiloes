import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withLifecycleDatabase, seedLifecycle } from "./helpers/lifecycle-database";
import { withTestClock, type TestTimezone } from "./helpers/timezone-database";
import { seedBidFixture } from "./helpers/bid-fixture";
import { AuctionLifecycleService } from "../src/modules/auctions/auction-lifecycle.service";
import { createAuctionLifecycleRepository } from "../src/modules/auctions/auction-lifecycle.repository";
import { BidService } from "../src/modules/bids/bid.service";
import { createBidRepository } from "../src/modules/bids/bid.repository";
import { BidEventBus, BidExecutionQueue } from "../src/realtime/bid-events";
import { SettlementService } from "../src/modules/settlement/settlement.service";
import { createSettlementRepository } from "../src/modules/settlement/settlement.repository";
import { SettlementEventBus } from "../src/realtime/settlement-events";
import { verifyOpeningAuditChain } from "../src/modules/audit/opening-audit";
import { HttpError } from "../src/errors/http-error";

const conflict = (e: unknown) => e instanceof HttpError && e.status === 409;
const base = new Date("2030-01-01T15:00:00.000Z");
for (const timezone of ["America/Sao_Paulo", "UTC"] as TestTimezone[]) describe(`Regressão temporal dos serviços: ${timezone}`, { skip: process.env.POSTGRES_TIMEZONE_DATABASE_TESTS !== "1" }, () => {
  it("agenda no futuro, abre exatamente no início e rejeita abertura tardia", async () => {
    await withLifecycleDatabase(async client => {
      const f = await seedLifecycle(client), late = await seedLifecycle(client);
      for (const id of [f.auctionId, late.auctionId]) await client.auction.update({ where: { id }, data: { startsAt: base, endsAt: new Date(base.getTime() + 240000) } });
      const clock = { now: new Date(base.getTime() - 1) }, scoped = withTestClock(client, clock);
      const service = new AuctionLifecycleService(createAuctionLifecycleRepository(() => scoped));
      await service.transition(f.auctionId, "schedule", f.ownerId); await service.transition(late.auctionId, "schedule", late.ownerId);
      await assert.rejects(service.transition(f.auctionId, "open", f.ownerId), conflict); assert.equal(await client.auditEvent.count(), 0);
      clock.now = base; await service.transition(f.auctionId, "open", f.ownerId);
      assert.equal(await client.lot.count({ where: { auctionId: f.auctionId, status: "OPEN" } }), 2);
      const chain = await client.auditEvent.findMany({ orderBy: { sequence: "asc" } }); assert(verifyOpeningAuditChain(chain)); assert(chain.every(e => e.occurredAt.getTime() === base.getTime()));
      clock.now = new Date(base.getTime() + 240000); await assert.rejects(service.transition(late.auctionId, "open", late.ownerId), conflict);
    }, { timezone });
  });
  for (const remaining of [120001, 120000, 119999, 1, 0, -1]) it(`lance com ${remaining}ms restantes: prazo e janela exatos`, async () => {
    await withLifecycleDatabase(async client => {
      const f = await client.$transaction(seedBidFixture);
      await client.auction.update({ where: { id: f.auctionIds[0] }, data: { startsAt: new Date(base.getTime() - 3600000), endsAt: base } });
      const clock = { now: new Date(base.getTime() - remaining) }, scoped = withTestClock(client, clock), bus = new BidEventBus();
      let extended = 0; bus.subscribeExtensions(() => { extended++; });
      const service = new BidService(createBidRepository(() => scoped), bus, new BidExecutionQueue());
      if (remaining <= 0) { await assert.rejects(service.place(f.lotIds[0], f.bidders[0], "100", "first"), conflict); assert.equal(await client.bid.count(), 0); assert.equal(await client.bidReservation.count(), 0); }
      else {
        const bid = await service.place(f.lotIds[0], f.bidders[0], "100", "first"); assert.equal(bid.bid.createdAt.getTime(), clock.now.getTime());
        const lot = await client.lot.findUniqueOrThrow({ where: { id: f.lotIds[0] } });
        const expected = remaining < 120000 ? clock.now.getTime() + 120000 : null; assert.equal(lot.endsAt?.getTime() ?? null, expected);
        assert.equal(extended, expected === null ? 0 : 1);
        const [physical] = await client.$queryRaw<{ milliseconds: bigint }[]>`SELECT (EXTRACT(EPOCH FROM "createdAt")*1000)::bigint AS milliseconds FROM "Bid" WHERE "id" = ${bid.bid.id}::uuid`;
        assert.equal(Number(physical.milliseconds) - clock.now.getTime(), timezone === "UTC" ? 0 : 10800000);
      }
    }, { timezone });
  });
  it("prorrogações sucessivas, independência, replay e captura preservam finanças", async () => {
    await withLifecycleDatabase(async client => {
      const f = await client.$transaction(seedBidFixture);
      await client.lot.update({ where: { id: f.lotIds[1] }, data: { auctionId: f.auctionIds[0], number: 2 } });
      await client.auction.update({ where: { id: f.auctionIds[0] }, data: { startsAt: new Date(base.getTime() - 3600000), endsAt: base } });
      const clock = { now: new Date(base.getTime() - 60000) }, scoped = withTestClock(client, clock), bus = new BidEventBus();
      let extended = 0, closed = 0; bus.subscribeExtensions(() => { extended++; });
      const closing = new SettlementEventBus(); closing.subscribeLot(() => { closed++; });
      const bids = new BidService(createBidRepository(() => scoped), bus, new BidExecutionQueue()), settle = new SettlementService(createSettlementRepository(() => scoped), closing);
      const first = await bids.place(f.lotIds[0], f.bidders[0], "100", "first");
      const heldBefore = await client.bidReservation.findFirstOrThrow({ where: { lotId: f.lotIds[0] } });
      await assert.rejects(bids.place(f.lotIds[0], f.bidders[1], "900", "insufficient"), conflict); assert.equal(extended, 1);
      assert.deepEqual(await client.bidReservation.findUniqueOrThrow({ where: { id: heldBefore.id } }), heldBefore);
      clock.now = new Date(base.getTime() + 1);
      await settle.process(f.auctionIds[0], f.lotIds[0]); assert.equal(closed, 0);
      await settle.process(f.auctionIds[0], f.lotIds[1]); assert.equal(closed, 1);
      assert.equal((await client.auction.findUniqueOrThrow({ where: { id: f.auctionIds[0] } })).status, "OPEN");
      assert.equal((await bids.place(f.lotIds[0], f.bidders[0], "100", "first")).bid.id, first.bid.id); assert.equal(extended, 1);
      await bids.place(f.lotIds[0], f.bidders[1], "110", "second"); assert.equal(extended, 2);
      const deadline = (await client.lot.findUniqueOrThrow({ where: { id: f.lotIds[0] } })).endsAt!;
      assert.equal(deadline.getTime(), clock.now.getTime() + 120000);
      clock.now = new Date(deadline.getTime() - 1); await settle.process(f.auctionIds[0], f.lotIds[0]); assert.equal(closed, 1);
      clock.now = deadline; await assert.rejects(bids.place(f.lotIds[0], f.bidders[0], "120", "late"), conflict);
      await settle.process(f.auctionIds[0], f.lotIds[0]); await settle.process(f.auctionIds[0], f.lotIds[0]);
      assert.equal(closed, 2); assert.equal(await client.walletTransaction.count({ where: { type: "DEBIT" } }), 1);
      assert.equal((await client.wallet.findUniqueOrThrow({ where: { id: f.walletIds[1] } })).balance.toFixed(2), "390.00");
      assert.equal(await client.bidReservation.count({ where: { status: "ACTIVE" } }), 0);
      assert.equal((await client.auctionReceipt.findUniqueOrThrow({ where: { lotId: f.lotIds[0] } })).issuedAt.getTime(), clock.now.getTime());
      assert.equal((await client.auction.findUniqueOrThrow({ where: { id: f.auctionIds[0] } })).status, "CLOSED");
      assert(verifyOpeningAuditChain(await client.auditEvent.findMany({ orderBy: { sequence: "asc" } })));
    }, { timezone });
  });
});
