import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import type { Socket } from "socket.io-client";
import type { Server as SocketServer } from "socket.io";
import { attachBidSocket, type RoomAck } from "../src/realtime/bid-socket";
import { BidEventBus, type BidCreatedEvent } from "../src/realtime/bid-events";
import { createBidRouter } from "../src/modules/bids/bid.routes";
import type { BidRepository } from "../src/modules/bids/bid.types";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository } from "../src/modules/auth/auth.types";
import { errorHandler } from "../src/middlewares/error-handler";
import { HttpError } from "../src/errors/http-error";
import { frontendOrigin } from "../src/config/http";
import { nextBid, socketClient } from "./helpers/socket-client";

describe("Socket.IO público de lances", () => {
  const lotId = randomUUID(), secondLot = randomUUID(), thirdLot = randomUUID(), userId = randomUUID();
  const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  let server: Server, io: SocketServer, base: string, events: BidEventBus, clients: Socket[], committed: boolean;
  let databaseFailure: boolean, rollback: boolean, release: (() => void) | undefined, wait: Promise<void> | undefined;
  const records = new Map<string, { id: string; lotId: string; amount: import("../src/generated/prisma/client").Prisma.Decimal; sequence: number; createdAt: Date }>();
  beforeEach(async () => {
    clients = []; events = new BidEventBus(); records.clear(); committed = false; databaseFailure = false; rollback = false; release = undefined; wait = undefined;
    const repository: BidRepository = {
      async place(id, _user, amount, key) {
        if (wait) await wait;
        if (rollback) throw new HttpError(409, "Transação revertida");
        const previous = records.get(key); if (previous) return { bid: previous, replayed: true };
        const bid = { id: randomUUID(), lotId: id, amount, sequence: records.size + 1, createdAt: new Date() };
        records.set(key, bid); committed = true; return { bid, replayed: false };
      },
      async list() { return { bids: [], total: 0 }; },
    };
    const auth: AuthRepository = {
      async findPublicById(id) { return { id, name: "Privado", email: "private@example.com", role: "BIDDER", createdAt: new Date() }; },
      async findByEmail() { throw new Error("Não utilizado"); }, async createBidder() { throw new Error("Não utilizado"); },
    };
    const app = express(); app.use(express.json()); app.get("/health", (_req, res) => res.json({ ok: true }));
    app.use("/api/lots/:lotId/bids", createBidRouter(repository, createAuthenticate(auth, () => config), events)); app.use(errorHandler);
    server = createServer(app);
    io = attachBidSocket(server, { events, maxRooms: 2, maxOperations: 10, lotExists: async id => {
      if (databaseFailure) throw new Error("Credencial privada da falha simulada");
      return ([lotId, secondLot, thirdLot] as string[]).includes(id);
    } });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => { release?.(); for (const client of clients) client.close(); await new Promise<void>(resolve => { void io.close(() => resolve()); }); });
  const client = async () => { const socket = await socketClient(base); clients.push(socket); return socket; };
  const room = (socket: Socket, event: "lot:join" | "lot:leave", payload: unknown): Promise<RoomAck> => socket.timeout(1500).emitWithAck(event, payload);
  const payload = (id = lotId): BidCreatedEvent => ({ lotId: id, bidId: randomUUID(), amount: "150.00", createdAt: new Date().toISOString(), sequence: 1 });
  const post = (key = "a") => fetch(`${base}/api/lots/${lotId}/bids`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${signAccessToken(userId, config)}`, "Idempotency-Key": key }, body: '{"amount":"150.00"}' });
  it("conecta publicamente e mantém Express no mesmo servidor HTTP", async () => {
    assert((await client()).connected); assert.equal((await fetch(`${base}/health`)).status, 200);
  });
  it("permite polling e upgrade sem criar outra porta", async () => {
    const socket = await socketClient(base, { transports: ["polling", "websocket"] }); clients.push(socket); assert(socket.connected);
  });
  it("reutiliza a origem permitida e bloqueia outra origem no WebSocket", async () => {
    const socket = await socketClient(base, { extraHeaders: { Origin: frontendOrigin() } }); clients.push(socket); assert(socket.connected);
    await assert.rejects(socketClient(base, { extraHeaders: { Origin: "https://forbidden.example" } }));
  });
  it("join normaliza UUID e o cliente não escolhe nomes de salas", async () => {
    const socket = await client(); assert.deepEqual(await room(socket, "lot:join", { lotId: lotId.toUpperCase() }), { ok: true, lotId });
    const peer = io.sockets.sockets.get(socket.id!)!; assert(peer.rooms.has(`lot:${lotId}`)); assert.equal(peer.rooms.size, 2);
  });
  it("rejeita payloads inválidos, IDs e salas arbitrárias", async () => {
    const socket = await client();
    for (const value of [null, [], "lot:private", {}, { lotId: "invalid" }, { lotId: `lot:${lotId}` }, { lotId, room: "private" }]) {
      const result = await room(socket, "lot:join", value); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "INVALID_REQUEST");
    }
    assert.equal(io.sockets.sockets.get(socket.id!)!.rooms.size, 1);
  });
  it("não inscreve em lote inexistente e mantém erros de banco genéricos", async () => {
    const socket = await client(); const missing = await room(socket, "lot:join", { lotId: randomUUID() }); assert(!missing.ok); assert.equal(missing.error.code, "NOT_FOUND");
    databaseFailure = true; const failed = await room(socket, "lot:join", { lotId }); assert(!failed.ok); assert.equal(failed.error.code, "INTERNAL_ERROR"); assert(!failed.error.message.includes("Credencial"));
  });
  it("limita inscrições e permite reutilizar a vaga após leave", async () => {
    const socket = await client(); await room(socket, "lot:join", { lotId }); await room(socket, "lot:join", { lotId: secondLot });
    const full = await room(socket, "lot:join", { lotId: thirdLot }); assert(!full.ok); assert.equal(full.error.code, "SUBSCRIPTION_LIMIT");
    assert((await room(socket, "lot:leave", { lotId })).ok); assert((await room(socket, "lot:join", { lotId: thirdLot })).ok);
  });
  it("limita taxa inclusive para payloads inválidos", async () => {
    const socket = await client(); for (let i = 0; i < 10; i++) await room(socket, "lot:join", {});
    const result = await room(socket, "lot:join", { lotId }); assert(!result.ok); assert.equal(result.error.code, "RATE_LIMITED");
  });
  it("join e leave são idempotentes", async () => {
    const socket = await client(); await room(socket, "lot:join", { lotId }); await room(socket, "lot:join", { lotId }); assert.equal(io.sockets.sockets.get(socket.id!)!.rooms.size, 2);
    assert((await room(socket, "lot:leave", { lotId })).ok); assert((await room(socket, "lot:leave", { lotId })).ok); assert.equal(io.sockets.sockets.get(socket.id!)!.rooms.size, 1);
  });
  it("envia apenas à sala correta e deixa de enviar após leave", async () => {
    const a = await client(), b = await client(), outsider = await client(); const received: unknown[] = [];
    b.on("bid:created", value => received.push(value)); outsider.on("bid:created", value => received.push(value));
    await room(a, "lot:join", { lotId }); await room(b, "lot:join", { lotId: secondLot });
    const first = nextBid(a); const event = payload(); events.publish(event); assert.deepEqual(await first, event);
    await room(a, "lot:leave", { lotId }); a.on("bid:created", value => received.push(value)); events.publish(payload()); await delay(60); assert.equal(received.length, 0);
  });
  it("REST emite uma vez após a confirmação e não emite antes dela", async () => {
    const socket = await client(); await room(socket, "lot:join", { lotId }); const received: BidCreatedEvent[] = [];
    socket.on("bid:created", value => { assert(committed); received.push(value); });
    wait = new Promise<void>(resolve => release = resolve); const request = post(); await delay(50); assert.equal(received.length, 0);
    const event = nextBid(socket); release!(); assert.equal((await request).status, 201); await event;
    assert.equal((await post()).status, 200); await delay(60); assert.equal(received.length, 1);
    assert.deepEqual(Object.keys(received[0]).sort(), ["amount", "bidId", "createdAt", "lotId", "sequence"]);
  });
  it("não transmite em caso de rollback", async () => {
    const socket = await client(); await room(socket, "lot:join", { lotId }); const received: unknown[] = []; socket.on("bid:created", value => received.push(value));
    rollback = true; assert.equal((await post()).status, 409); await delay(60); assert.equal(received.length, 0); assert.equal(records.size, 0);
  });
  it("mensagens Socket.IO não registram lance nem retransmitem eventos forjados", async () => {
    const socket = await client(); await room(socket, "lot:join", { lotId }); const received: unknown[] = []; socket.on("bid:created", value => received.push(value));
    socket.emit("bid:created", payload()); socket.emit("bid:create", { amount: "999" }); await delay(60); assert.equal(records.size, 0); assert.equal(received.length, 0);
  });
  it("publicação seleciona campos públicos e falhas de assinantes não desfazem o REST", async () => {
    const socket = await client(); await room(socket, "lot:join", { lotId }); events.subscribe(() => { throw new Error("Segredo privado"); });
    const event = nextBid(socket); assert.equal((await post()).status, 201); const result = await event;
    assert.equal(result.amount, "150.00"); assert.equal(records.size, 1);
    const projected = nextBid(socket); events.publish({ ...payload(), email: "private@example.com", walletId: randomUUID() } as BidCreatedEvent);
    assert.equal("email" in await projected, false);
  });
});
