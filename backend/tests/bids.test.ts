import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { Prisma, type Auction, type Bid, type Lot } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { errorHandler } from "../src/middlewares/error-handler";
import { createBidRouter } from "../src/modules/bids/bid.routes";
import type { BidRepository, BidState } from "../src/modules/bids/bid.types";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository, PublicUser } from "../src/modules/auth/auth.types";

describe("Lances HTTP (JWT real, repositório em memória)", () => {
  const userId = randomUUID(), ownerId = randomUUID(), otherId = randomUUID(), lotId = randomUUID();
  const users = new Map<string, PublicUser>(), rows: Bid[] = [], keys = new Map<string, Bid>();
  const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  let state: BidState, server: Server, base: string, fail = false;
  const repository: BidRepository = {
    async list(id, query) {
      if (id !== lotId) throw new HttpError(404, "Lote não encontrado.");
      const bids = [...rows].sort((a,b) => b.sequence - a.sequence);
      return { bids: bids.slice((query.page - 1) * query.limit, query.page * query.limit), total: bids.length };
    },
    async place(id, user, amount, key, validate) {
      if (fail) throw new Error("Detalhe privado");
      if (id !== lotId) throw new HttpError(404, "Lote não encontrado.");
      const previous = keys.get(`${user}:${key}`);
      if (previous) {
        if (previous.lotId !== id || !previous.amount.equals(amount)) throw new HttpError(409, "Chave reutilizada.");
        return { bid: previous, replayed: true };
      }
      validate({ ...state, latest: rows.at(-1) ?? null });
      const bid: Bid = { id: randomUUID(), userId: user, lotId: id, amount, sequence: rows.length + 1, createdAt: state.now };
      rows.push(bid); keys.set(`${user}:${key}`, bid); return { bid, replayed: false };
    },
  };
  const auth: AuthRepository = {
    async findPublicById(id) { return users.get(id) ?? null; },
    async findByEmail() { throw new Error("Não utilizado"); }, async createBidder() { throw new Error("Não utilizado"); },
  };
  before(async () => {
    const app = express(); app.use(express.json());
    app.use("/api/lots/:lotId/bids", createBidRouter(repository, createAuthenticate(auth, () => config))); app.use(errorHandler);
    await new Promise<void>((resolve, reject) => { server = app.listen(0, "127.0.0.1", (e?: Error) => e ? reject(e) : resolve()); server.once("error", reject); });
    const address = server.address(); assert(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}/api/lots`;
  });
  beforeEach(() => {
    users.clear(); rows.length = 0; keys.clear(); fail = false;
    for (const id of [userId, otherId, ownerId]) users.set(id, { id, name: "Privado", email: "private@example.com", role: id === ownerId ? "AUCTIONEER" : "BIDDER", createdAt: new Date() });
    const auction: Auction = { id: randomUUID(), organizerId: ownerId, ...{ temporalGeneration: "UTC_V2" }, title: "Fixture", description: null, startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000), status: "OPEN", createdAt: new Date(), updatedAt: new Date() };
    const lot: Lot = { id: lotId, auctionId: auction.id, vehicleId: randomUUID(), number: 1, startingPrice: new Prisma.Decimal(100), minimumIncrement: new Prisma.Decimal(10), status: "OPEN", winnerId: null, endsAt: null, version: 0, createdAt: new Date(), updatedAt: new Date() };
    state = { auction, lot, latest: null, vehicleOwnerId: ownerId, hasReceipt: false, now: new Date() };
  });
  after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
  async function request(method: string, body?: unknown, key: string | undefined = "a", user: string = userId, id: string = lotId, query = "") {
    const headers: Record<string, string> = {};
    if (user) headers.Authorization = `Bearer ${signAccessToken(user, config)}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (key !== undefined) headers["Idempotency-Key"] = key;
    return fetch(`${base}/${id}/bids${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  it("aceita lance inicial e expõe somente campos públicos", async () => {
    const res = await request("POST", { amount: "100.00" }); assert.equal(res.status, 201);
    const body = await res.json(); assert.equal(body.bid.amount, "100.00"); assert.equal(body.bid.sequence, 1); assert.equal(body.replayed, false);
    assert.deepEqual(Object.keys(body.bid).sort(), ["amount", "createdAt", "id", "lotId", "sequence"]);
  });
  it("exige autenticação e BIDDER para postar", async () => {
    assert.equal((await request("POST", { amount: "100" }, "a", "")).status, 401);
    assert.equal((await request("POST", { amount: "100" }, "a", ownerId)).status, 403); assert.equal(rows.length, 0);
  });
  it("revalida usuário e perfil do token", async () => {
    users.get(userId)!.role = "AUCTIONEER"; assert.equal((await request("POST", { amount: "100" })).status, 403);
    users.delete(userId); assert.equal((await request("POST", { amount: "100" })).status, 401);
    assert.equal((await fetch(`${base}/${lotId}/bids`, { method: "POST", headers: { Authorization: "Bearer inválido" } })).status, 401);
  });
  it("proíbe lance no próprio leilão e veículo, mesmo com perfil BIDDER", async () => {
    state.auction.organizerId = userId; assert.equal((await request("POST", { amount: "100" })).status, 403);
    state.auction.organizerId = ownerId; state.vehicleOwnerId = userId; assert.equal((await request("POST", { amount: "100" })).status, 403);
  });
  for (const amount of [undefined, null, 100, "0", "0.00", "-1", "1.001", "1e3", "1,00", "10000000000000000", "NaN", " 100", "0100", ""]) it(`rejeita amount inválido ${JSON.stringify(amount)}`, async () => {
    assert.equal((await request("POST", { amount })).status, 400); assert.equal(rows.length, 0);
  });
  it("rejeita corpo inválido, campos extras, IDs financeiros e status", async () => {
    for (const body of [null, [], {}, ...["userId", "walletId", "lotId", "reservationId", "status", "sequence", "id", "idempotencyKey"].map(field => ({ amount: "100", [field]: "forjado" }))]) assert.equal((await request("POST", body)).status, 400);
  });
  it("exige chave de idempotência válida e rejeita query de escrita", async () => {
    for (const key of ["", "a".repeat(65), "com espaço", "a,b"]) assert.equal((await request("POST", { amount: "100" }, key)).status, 400);
    const response = await fetch(`${base}/${lotId}/bids`, { method: "POST", headers: { Authorization: `Bearer ${signAccessToken(userId, config)}`, "Content-Type": "application/json" }, body: '{"amount":"100"}' });
    assert.equal(response.status, 400); assert.equal((await request("POST", { amount: "100" }, "a", userId, lotId, "?userId=x")).status, 400);
  });
  it("valida valor inicial e incremento como mínimo, sem exigir múltiplo exato", async () => {
    assert.equal((await request("POST", { amount: "99.99" })).status, 409);
    assert.equal((await request("POST", { amount: "100" })).status, 201);
    assert.equal((await request("POST", { amount: "109.99" }, "b")).status, 409);
    assert.equal((await request("POST", { amount: "110.01" }, "b")).status, 201);
  });
  for (const status of ["DRAFT", "SCHEDULED", "CLOSED", "CANCELLED"] as const) it(`bloqueia leilão ${status}`, async () => {
    state.auction.status = status; assert.equal((await request("POST", { amount: "100" })).status, 409);
  });
  for (const status of ["PENDING", "SOLD", "UNSOLD", "CANCELLED"] as const) it(`bloqueia lote ${status}`, async () => {
    state.lot.status = status; assert.equal((await request("POST", { amount: "100" })).status, 409);
  });
  it("aplica início inclusivo e fim exclusivo usando o horário validado na transação", async () => {
    state.auction.startsAt = new Date(state.now.getTime() + 1); assert.equal((await request("POST", { amount: "100" })).status, 409);
    state.auction.startsAt = state.now; assert.equal((await request("POST", { amount: "100" })).status, 201);
    state.auction.endsAt = state.now; assert.equal((await request("POST", { amount: "110" }, "b")).status, 409);
  });
  it("bloqueia recibo, vencedor ou configuração financeira inválida", async () => {
    state.hasReceipt = true; assert.equal((await request("POST", { amount: "100" })).status, 409);
    state.hasReceipt = false; state.lot.winnerId = otherId; assert.equal((await request("POST", { amount: "100" })).status, 409);
    state.lot.winnerId = null; state.lot.minimumIncrement = new Prisma.Decimal(0); assert.equal((await request("POST", { amount: "100" })).status, 409);
  });
  it("reenvio idempotente retorna mesmo lance e não depende de o lote continuar aberto", async () => {
    const first = await (await request("POST", { amount: "100" })).json(); state.lot.status = "UNSOLD";
    const response = await request("POST", { amount: "100.00" }); assert.equal(response.status, 200);
    const second = await response.json(); assert.equal(second.bid.id, first.bid.id); assert.equal(second.replayed, true); assert.equal(rows.length, 1);
    assert.equal((await request("POST", { amount: "110" })).status, 409);
  });
  it("lista publicamente com paginação e sequência decrescente sem identificar participantes", async () => {
    await request("POST", { amount: "100" }); await request("POST", { amount: "110" }, "b", otherId);
    const response = await request("GET", undefined, undefined, "", lotId, "?page=1&limit=1"); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.data[0].amount, "110.00"); assert.deepEqual(body.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
    assert.equal(body.data[0].userId, undefined); assert.equal(body.data[0].walletId, undefined);
    assert.equal((await (await request("GET", undefined, undefined, "", lotId, "?page=2&limit=1")).json()).data[0].amount, "100.00");
  });
  it("trata paginação inválida, UUID inválido, lote inexistente e lista vazia", async () => {
    for (const query of ["?page=0", "?limit=101", "?page=1.5", "?page=1&page=2", "?userId=x"]) assert.equal((await request("GET", undefined, undefined, "", lotId, query)).status, 400);
    for (const method of ["GET", "POST"]) {
      assert.equal((await request(method, method === "POST" ? { amount: "100" } : undefined, "a", userId, "invalid")).status, 400);
      assert.equal((await request(method, method === "POST" ? { amount: "100" } : undefined, "a", userId, randomUUID())).status, 404);
    }
    assert.deepEqual((await (await request("GET", undefined, undefined, "")).json()).data, []);
  });
  it("preserva mensagem genérica para falhas inesperadas", async () => {
    fail = true; const res = await request("POST", { amount: "100" }); assert.equal(res.status, 500); assert.deepEqual(await res.json(), { message: "Erro interno do servidor." });
  });
});
