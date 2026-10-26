import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { attachBidSocket } from "../src/realtime/bid-socket";
import { BidEventBus, type BidCreatedEvent } from "../src/realtime/bid-events";
import { createBidRouter } from "../src/modules/bids/bid.routes";
import { createBidRepository } from "../src/modules/bids/bid.repository";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository } from "../src/modules/auth/auth.types";
import { HttpError } from "../src/errors/http-error";
import { errorHandler } from "../src/middlewares/error-handler";
import { withLifecycleDatabase } from "./helpers/lifecycle-database";
import { seedBidFixture } from "./helpers/bid-fixture";
import { nextBid, socketClient } from "./helpers/socket-client";

describe("Socket.IO após commit PostgreSQL (tabelas isoladas)", { skip: process.env.SOCKET_DATABASE_TESTS !== "1" }, () => {
  async function fixture(check: (c: {
    client: PrismaClient; socket: Awaited<ReturnType<typeof socketClient>>; events: BidCreatedEvent[];
    waitForBoundary: Promise<void>; control: { hold: boolean; fail: boolean }; release: () => void;
    post: (amount?: string, key?: string) => Promise<Response>; lotId: string; walletId: string;
  }) => Promise<void>) {
    await withLifecycleDatabase(async client => {
      const ids = await client.$transaction(seedBidFixture), bus = new BidEventBus();
      const control = { hold: false, fail: false };
      let boundary!: () => void, release!: () => void;
      const waitForBoundary = new Promise<void>(resolve => boundary = resolve), gate = new Promise<void>(resolve => release = resolve);
      const scoped = { $transaction: (operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) => client.$transaction(async tx => {
        const result = await operation(tx);
        if (control.hold) { boundary(); await gate; }
        if (control.fail) throw new HttpError(409, "Rollback antes do commit");
        return result;
      }, options) } as unknown as PrismaClient;
      const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
      const auth: AuthRepository = {
        findPublicById: id => client.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, role: true, createdAt: true } }),
        async findByEmail() { throw new Error("Não utilizado"); }, async createBidder() { throw new Error("Não utilizado"); },
      };
      const app = express(); app.use(express.json()); app.use("/api/lots/:lotId/bids", createBidRouter(createBidRepository(() => scoped), createAuthenticate(auth, () => config), bus)); app.use(errorHandler);
      const server = createServer(app), io = attachBidSocket(server, { events: bus, lotExists: async id => !!await client.lot.findUnique({ where: { id }, select: { id: true } }) });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address(); assert(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
      const socket = await socketClient(base), events: BidCreatedEvent[] = [];
      socket.on("bid:created", event => events.push(event));
      await socket.timeout(1500).emitWithAck("lot:join", { lotId: ids.lotIds[0] });
      const post = (amount = "100", key = "first") => fetch(`${base}/api/lots/${ids.lotIds[0]}/bids`, { method: "POST", headers: { Authorization: `Bearer ${signAccessToken(ids.bidders[0], config)}`, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ amount }) });
      try { await check({ client, socket, events, waitForBoundary, control, release, post, lotId: ids.lotIds[0], walletId: ids.walletIds[0] }); }
      finally { release(); socket.close(); await new Promise<void>(resolve => { void io.close(() => resolve()); }); }
    });
  }
  it("não publica enquanto a transação está aberta e publica somente o registro confirmado", async () => {
    await fixture(async ({ client, socket, events, waitForBoundary, control, release, post, lotId }) => {
      control.hold = true; const request = post(); await waitForBoundary;
      assert.equal(await client.bid.count({ where: { lotId } }), 0); assert.equal(events.length, 0);
      const notification = nextBid(socket); release(); assert.equal((await request).status, 201);
      const event = await notification; assert(await client.bid.findUnique({ where: { id: event.bidId } }));
      assert.equal(event.amount, "100.00"); assert.equal(event.sequence, 1); assert.equal(events.length, 1);
    });
  });
  it("rollback após gravar lance e reserva não emite nem persiste movimentos", async () => {
    await fixture(async ({ client, events, control, post, lotId, walletId }) => {
      control.fail = true; assert.equal((await post()).status, 409); await delay(60); assert.equal(events.length, 0);
      assert.equal(await client.bid.count({ where: { lotId } }), 0); assert.equal(await client.bidReservation.count(), 0);
      assert.equal(await client.walletTransaction.count({ where: { walletId, type: "RESERVE" } }), 0);
      assert.equal((await client.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance.toFixed(2), "500.00");
    });
  });
  it("dois lances na mesma sala preservam sequência e reenvio não duplica evento", async () => {
    await fixture(async ({ socket, events, waitForBoundary, control, release, post }) => {
      control.hold = true; const first = post("100", "a"); await waitForBoundary;
      const second = post("110", "b"); await delay(40); assert.equal(events.length, 0);
      const last = new Promise<void>(resolve => socket.on("bid:created", event => { if (event.sequence === 2) resolve(); }));
      release(); const responses = await Promise.all([first, second]); assert(responses.every(response => response.status === 201)); await last;
      assert.deepEqual(events.map(event => event.sequence), [1, 2]); assert.equal((await post("100.00", "a")).status, 200);
      await delay(60); assert.equal(events.length, 2); assert(events.every(event => !JSON.stringify(event).includes("wallet")));
    });
  });
});
