import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { withLifecycleDatabase } from "./helpers/lifecycle-database";
import { seedBidFixture } from "./helpers/bid-fixture";
import { socketClient } from "./helpers/socket-client";
import { attachBidSocket } from "../src/realtime/bid-socket";
import { SettlementEventBus } from "../src/realtime/settlement-events";
import { SettlementService } from "../src/modules/settlement/settlement.service";
import { createSettlementRepository } from "../src/modules/settlement/settlement.repository";
import { BidService } from "../src/modules/bids/bid.service";
import { createBidRepository } from "../src/modules/bids/bid.repository";

describe("Encerramento Socket.IO e commit PostgreSQL", { skip: process.env.SETTLEMENT_DATABASE_TESTS !== "1" }, () => {
  for (const rollback of [false, true]) it(rollback ? "rollback não emite encerramento nem captura" : "dois clientes recebem após commit; outra sala isolada e replay sem duplicação", async () => {
    await withLifecycleDatabase(async client => {
      const ids = await client.$transaction(seedBidFixture), events = new SettlementEventBus();
      await new BidService(createBidRepository(() => client)).place(ids.lotIds[0], ids.bidders[0], "100", "first");
      await client.auction.update({ where: { id: ids.auctionIds[0] }, data: { endsAt: new Date(Date.now() - 1000) } });
      let reached!: () => void, release!: () => void; const boundary = new Promise<void>(r => reached = r), gate = new Promise<void>(r => release = r);
      const scoped = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opts: object) => client.$transaction(async tx => { const result = await fn(tx); reached(); await gate; if (rollback) throw new Error("rollback"); return result; }, opts) } as unknown as PrismaClient;
      const service = new SettlementService(createSettlementRepository(() => scoped), events);
      const server = createServer(), io = attachBidSocket(server, { settlementEvents: events, lotExists: async id => ids.lotIds.includes(id) });
      await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); const address = server.address(); assert(address && typeof address !== "string"); const url = `http://127.0.0.1:${address.port}`;
      const sockets = await Promise.all([socketClient(url), socketClient(url), socketClient(url)]), received: unknown[][] = [[], [], []], order: string[] = [];
      let pending: Promise<void> | undefined;
      try {
        for (const [i, socket] of sockets.entries()) {
          socket.on("lot:closed", e => { received[i].push(e); if (i === 0) order.push("lot"); }); socket.on("auction:closed", e => { received[i].push(e); if (i === 0) order.push("auction"); });
          await socket.timeout(1500).emitWithAck("lot:join", { lotId: ids.lotIds[i === 2 ? 1 : 0] });
        }
        // First client joins two rooms of the same auction; union emission must deliver once.
        const extra = await client.lot.create({ data: { auctionId: ids.auctionIds[0], vehicleId: ids.vehicleIds[1], number: 2, startingPrice: "100", minimumIncrement: "10", status: "CANCELLED" } });
        // Existence is deliberately stubbed for fixture subscription only.
        ids.lotIds.push(extra.id); await sockets[0].timeout(1500).emitWithAck("lot:join", { lotId: extra.id });
        pending = service.process(ids.auctionIds[0], ids.lotIds[0]); const failure = pending.catch(e => e); await boundary;
        await delay(30); assert(received.every(r => !r.length)); assert.equal(await client.auctionReceipt.count(), 0); assert.equal(await client.walletTransaction.count({ where: { type: "DEBIT" } }), 0);
        release(); if (rollback) { assert(await failure instanceof Error); await delay(60); assert(received.every(r => !r.length)); assert.equal(await client.auctionReceipt.count(), 0); assert.equal((await client.bidReservation.findFirstOrThrow()).status, "ACTIVE"); }
        else {
          await pending; for (let i = 0; i < 40 && received[1].length < 2; i++) await delay(10);
          assert.deepEqual(order, ["lot", "auction"]); assert.equal(received[0].length, 2); assert.equal(received[1].length, 2); assert.equal(received[2].length, 0);
          const lot = received[0][0] as object, auction = received[0][1] as object; assert.deepEqual(Object.keys(lot).sort(), ["auctionId", "closedAt", "lotId", "status"]); assert.deepEqual(Object.keys(auction).sort(), ["auctionId", "closedAt", "status"]);
          assert(!JSON.stringify(received).includes(ids.bidders[0])); assert.equal(await client.auctionReceipt.count(), 1);
          await new SettlementService(createSettlementRepository(() => client), events).process(ids.auctionIds[0], ids.lotIds[0]); await delay(50); assert.equal(received[0].length, 2);
        }
      } finally { release(); await pending?.catch(() => {}); for (const socket of sockets) socket.close(); await new Promise<void>(r => { void io.close(() => r()); }); }
    });
  });
});
