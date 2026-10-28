import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { createLiveRoomRepository } from "../src/modules/lots/live-room.repository";
import { createLiveRoomRouter } from "../src/modules/lots/live-room.routes";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository } from "../src/modules/auth/auth.types";
import { errorHandler } from "../src/middlewares/error-handler";
import { HttpError } from "../src/errors/http-error";

const lotId = randomUUID(), auctionId = randomUUID(), bidder = randomUUID(), owner = randomUUID(), foreign = randomUUID(), bidId = randomUUID(), otherBid = randomUUID();
const now = new Date("2030-01-01T12:00:00Z"), endsAt = new Date("2030-01-01T12:02:00Z");
function fixture() {
  const state = { generation: "UTC_V2", status: "OPEN", winnerId: bidder, own: bidId as string | null, latest: bidId, queries: [] as any[] };
  const tx = {
    async $executeRaw(sql: TemplateStringsArray) { assert.equal(sql.join(""), "SET TRANSACTION READ ONLY"); return 0; },
    async $queryRaw() { return [{ milliseconds: BigInt(now.getTime()) }]; },
    auction: { async findUnique() { return { organizerId: owner }; } },
    bid: { async findFirst(q: any) { assert.equal(q.where.lotId, lotId); if (q.where.userId) { assert.equal(q.where.userId, bidder); return state.own ? { id: state.own } : null; } return { id: state.latest }; } },
    lot: {
      async findUnique() { return { id: lotId, auctionId, status: state.status, winnerId: state.winnerId, endsAt, auction: { status: "OPEN", endsAt, temporalGeneration: state.generation } }; },
      async findMany(q: any) { state.queries.push(q); return [
        { id: lotId, auctionId, number: 1, status: "SOLD", auction: { title: "Meu leilão" }, vehicle: { brand: "Fiat", model: "Palio", year: 2014 }, receipt: { finalAmount: new Prisma.Decimal("1000.01"), winningBidId: bidId, publicId: randomUUID() } },
        { id: randomUUID(), auctionId, number: 2, status: "UNSOLD", auction: { title: "Meu leilão" }, vehicle: { brand: "Fiat", model: "Uno", year: 2015 }, receipt: null },
      ]; },
      async count(q: any) { state.queries.push(q); return 2; },
    },
  };
  const client = { async $transaction(fn: (tx: unknown) => unknown, options: unknown) { assert.deepEqual(options, { isolationLevel: "RepeatableRead" }); return fn(tx); } } as unknown as PrismaClient;
  return { state, repo: createLiveRoomRepository(() => client, () => true), client };
}
describe("Sala de lances: novas consultas somente leitura", () => {
  it("relógio usa epoch do banco e só confirma UTC_V2 no runtime ativo", async () => {
    const { repo, state, client } = fixture();
    const clock = await repo.clock(lotId); assert.equal(clock.checkedAt.getTime(), now.getTime()); assert.equal(clock.endsAt, endsAt); assert.equal(clock.trusted, true);
    state.generation = "LEGACY"; assert.equal((await repo.clock(lotId)).trusted, false);
    state.generation = "UTC_V2"; assert.equal((await createLiveRoomRepository(() => client, () => false).clock(lotId)).trusted, false);
    for (const privateField of ["winnerId", "userId", "ownerId", "organizerId"]) assert(!JSON.stringify(clock).includes(privateField));
  });
  it("identifica sem participação, liderando, superado e resultado sem publicar identidades", async () => {
    const { repo, state } = fixture();
    assert.equal((await repo.position(lotId, bidder)).status, "LEADING");
    state.latest = otherBid; assert.equal((await repo.position(lotId, bidder)).status, "OUTBID");
    state.own = null; assert.equal((await repo.position(lotId, bidder)).status, "NONE");
    state.own = bidId; state.status = "SOLD"; assert.equal((await repo.position(lotId, bidder)).status, "WON");
    state.winnerId = owner; assert.equal((await repo.position(lotId, bidder)).status, "NOT_WON");
    state.status = "UNSOLD"; const closed = await repo.position(lotId, bidder); assert.equal(closed.status, "CLOSED");
    assert(!JSON.stringify(closed).includes(bidder)); assert(!JSON.stringify(closed).includes(owner));
  });
  it("resultados filtram proprietário e lotes encerrados no banco, com paginação e sem valor inventado", async () => {
    const { repo, state } = fixture(); const result = await repo.results(owner, 2, 10);
    assert.deepEqual(state.queries[0].where, { status: { in: ["SOLD", "UNSOLD"] }, auction: { organizerId: owner } });
    assert.equal(state.queries[0].skip, 10); assert.equal(state.queries[0].take, 10); assert.deepEqual(state.queries[1].where, state.queries[0].where);
    assert.equal(result.data[0]!.finalAmount, "1000.01"); assert.equal(result.data[1]!.finalAmount, null); assert.equal(result.data[1]!.winningBidId, null);
    assert(!JSON.stringify(result).includes(owner)); assert(!JSON.stringify(result).includes('"winnerId"'));
    await assert.rejects(repo.results(foreign, 1, 10, auctionId), e => e instanceof HttpError && e.status === 403);
  });
});
describe("Sala e resultados HTTP com JWT real e repositório simulado", () => {
  let server: Server, base: string;
  const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  const auth: AuthRepository = {
    async findPublicById(id) { return ([bidder, owner, foreign] as string[]).includes(id) ? { id, name: "Privado", email: "private@example.test", role: id === bidder ? "BIDDER" : "AUCTIONEER", createdAt: now } : null; },
    async findByEmail() { return null; }, async createBidder() { throw Error("No writes"); },
  };
  before(async () => {
    const app = express(); app.use("/api", createLiveRoomRouter(fixture().repo, createAuthenticate(auth, () => config))); app.use(errorHandler);
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); assert(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}/api`;
  });
  after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const get = (path: string, user?: string) => fetch(base + path, { headers: user ? { Authorization: `Bearer ${signAccessToken(user, config)}` } : {} });
  it("relógio público e posição privada respeitam papéis e rejeitam parâmetros arbitrários", async () => {
    assert.equal((await get(`/lots/${lotId}/clock`)).status, 200);
    assert.equal((await get(`/lots/${lotId}/position`)).status, 401);
    assert.equal((await get(`/lots/${lotId}/position`, owner)).status, 403);
    const position = await get(`/lots/${lotId}/position`, bidder); assert.equal(position.status, 200); assert.equal(position.headers.get("cache-control"), "no-store");
    assert.equal((await get(`/lots/${lotId}/position?userId=other`, bidder)).status, 400);
    assert.equal((await get('/lots/invalid/clock')).status, 400);
  });
  it("resultados exigem AUCTIONEER, negam outro proprietário e validam filtros", async () => {
    assert.equal((await get('/me/lot-results')).status, 401); assert.equal((await get('/me/lot-results', bidder)).status, 403);
    assert.equal((await get(`/me/lot-results?auctionId=${auctionId}&limit=10`, owner)).status, 200);
    assert.equal((await get(`/me/lot-results?auctionId=${auctionId}`, foreign)).status, 403);
    for (const query of ['userId=other', 'page=0', 'limit=101', `auctionId=${auctionId}&auctionId=${auctionId}`]) assert.equal((await get(`/me/lot-results?${query}`, owner)).status, 400);
  });
});
