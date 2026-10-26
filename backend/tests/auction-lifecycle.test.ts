import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { Prisma, type Auction } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { errorHandler } from "../src/middlewares/error-handler";
import { createAuctionLifecycleRouter } from "../src/modules/auctions/auction-lifecycle.routes";
import type { AuctionLifecycleRepository, LifecycleLot } from "../src/modules/auctions/auction-lifecycle.types";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository, PublicUser } from "../src/modules/auth/auth.types";

describe("Agendamento e abertura HTTP (JWT real)", () => {
  const ownerId = randomUUID(), otherId = randomUUID(), bidderId = randomUUID(), auctionId = randomUUID();
  const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  const users = new Map<string, PublicUser>();
  let auction: Auction, lots: LifecycleLot[], now: Date, auditCount: number, failAudit: boolean, server: Server, base: string;
  const repository: AuctionLifecycleRepository = {
    async transition(id, operation, _authorId, decide) {
      if (id !== auctionId) throw new HttpError(404, "Leilão não encontrado.");
      const decision = decide({ auction, lots, now });
      if (decision.unchanged) return { auction, openedLots: 0, unchanged: true };
      if (operation === "open" && failAudit) throw new Error("Falha na auditoria");
      auction = { ...auction, status: decision.status };
      lots = lots.map(lot => decision.openLotIds.includes(lot.id) ? { ...lot, status: "OPEN", version: lot.version + 1 } : lot);
      if (operation === "open") auditCount += 1 + decision.openLotIds.length;
      return { auction, openedLots: decision.openLotIds.length, unchanged: false };
    },
  };
  const auth: AuthRepository = {
    async findPublicById(id) { return users.get(id) ?? null; },
    async findByEmail() { throw new Error("Não utilizado"); }, async createBidder() { throw new Error("Não utilizado"); },
  };
  before(async () => {
    const app = express(); app.use(express.json());
    app.use("/api/auctions", createAuctionLifecycleRouter(repository, createAuthenticate(auth, () => config))); app.use(errorHandler);
    await new Promise<void>((resolve, reject) => { server = app.listen(0, "127.0.0.1", (e?: Error) => e ? reject(e) : resolve()); server.once("error", reject); });
    const address = server.address(); assert(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}/api/auctions`;
  });
  beforeEach(() => {
    now = new Date(); auditCount = 0; failAudit = false; users.clear();
    for (const id of [ownerId, otherId, bidderId]) users.set(id, { id, name: "Privado", email: "private@example.com", role: id === bidderId ? "BIDDER" : "AUCTIONEER", createdAt: now });
    auction = { id: auctionId, organizerId: ownerId, title: "Fixture", description: null, status: "DRAFT", startsAt: new Date(now.getTime() + 86400000), endsAt: new Date(now.getTime() + 172800000), createdAt: now, updatedAt: now };
    lots = [1, 2].map(number => ({ id: randomUUID(), auctionId, vehicleId: randomUUID(), number, startingPrice: new Prisma.Decimal(100), minimumIncrement: new Prisma.Decimal(10), status: "PENDING", winnerId: null, version: 0, createdAt: now, updatedAt: now, vehicleOwnerId: ownerId, hasFinancialHistory: false }));
  });
  after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
  async function request(operation: "schedule" | "open", user: string = ownerId, body?: unknown, id: string = auctionId, query = "") {
    const headers: Record<string, string> = {};
    if (user) headers.Authorization = `Bearer ${signAccessToken(user, config)}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(`${base}/${id}/${operation}${query}`, { method: "PATCH", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  it("agenda DRAFT futuro e mantém os lotes PENDING", async () => {
    const res = await request("schedule"); assert.equal(res.status, 200); const body = await res.json();
    assert.equal(body.auction.status, "SCHEDULED"); assert.equal(body.openedLots, 0); assert.equal(body.unchanged, false); assert.equal(body.auction.organizerId, undefined);
    assert(lots.every(lot => lot.status === "PENDING")); assert.equal(auditCount, 0);
  });
  it("exige JWT, AUCTIONEER e propriedade em ambas as transições", async () => {
    for (const operation of ["schedule", "open"] as const) {
      assert.equal((await request(operation, "")).status, 401); assert.equal((await request(operation, bidderId)).status, 403); assert.equal((await request(operation, otherId)).status, 403);
    }
    assert.equal(auction.status, "DRAFT");
  });
  it("consulta novamente o perfil do responsável", async () => {
    users.get(ownerId)!.role = "BIDDER"; assert.equal((await request("schedule")).status, 403);
  });
  it("rejeita payloads de status, proprietário, datas e query", async () => {
    for (const body of [null, [], { status: "OPEN" }, { organizerId: otherId }, { startsAt: now.toISOString() }]) assert.equal((await request("schedule", ownerId, body)).status, 400);
    assert.equal((await request("schedule", ownerId, undefined, auctionId, "?force=true")).status, 400);
    assert.equal((await request("schedule", ownerId, {})).status, 200);
  });
  it("trata UUID inválido e registro inexistente", async () => {
    for (const operation of ["schedule", "open"] as const) {
      assert.equal((await request(operation, ownerId, undefined, "invalid")).status, 400); assert.equal((await request(operation, ownerId, undefined, randomUUID())).status, 404);
    }
  });
  it("não agenda sem lotes ou com todos cancelados", async () => {
    lots = []; assert.equal((await request("schedule")).status, 409);
    lots = [{ id: randomUUID(), status: "CANCELLED" } as LifecycleLot]; assert.equal((await request("schedule")).status, 409);
  });
  it("agendamento exige início futuro e período coerente", async () => {
    auction.startsAt = now; assert.equal((await request("schedule")).status, 409);
    auction.startsAt = new Date(now.getTime() + 1000); auction.endsAt = auction.startsAt; assert.equal((await request("schedule")).status, 409);
  });
  for (const status of ["OPEN", "CLOSED", "CANCELLED"] as const) it(`não agenda leilão ${status}`, async () => {
    auction.status = status; assert.equal((await request("schedule")).status, 409);
  });
  it("não abre diretamente DRAFT nem antes do horário", async () => {
    assert.equal((await request("open")).status, 409);
    await request("schedule"); assert.equal((await request("open")).status, 409); assert.equal(auction.status, "SCHEDULED");
  });
  it("abre exatamente no início, atomicamente, sem abrir lote cancelado", async () => {
    lots[1].status = "CANCELLED"; await request("schedule"); now = auction.startsAt;
    const res = await request("open"); assert.equal(res.status, 200); const body = await res.json();
    assert.equal(body.auction.status, "OPEN"); assert.equal(body.openedLots, 1); assert.equal(lots[0].status, "OPEN"); assert.equal(lots[1].status, "CANCELLED"); assert.equal(auditCount, 2);
  });
  it("bloqueia abertura no término e depois dele", async () => {
    await request("schedule"); now = auction.endsAt; assert.equal((await request("open")).status, 409);
    now = new Date(auction.endsAt.getTime() + 1); assert.equal((await request("open")).status, 409); assert(lots.every(lot => lot.status === "PENDING"));
  });
  for (const field of ["foreignVehicle", "history", "winner", "invalidPrice", "invalidIncrement", "openLot", "soldLot"] as const) it(`bloqueia lote incompatível: ${field}`, async () => {
    if (field === "foreignVehicle") lots[0].vehicleOwnerId = otherId;
    if (field === "history") lots[0].hasFinancialHistory = true;
    if (field === "winner") lots[0].winnerId = bidderId;
    if (field === "invalidPrice") lots[0].startingPrice = new Prisma.Decimal(0);
    if (field === "invalidIncrement") lots[0].minimumIncrement = new Prisma.Decimal(0);
    if (field === "openLot") lots[0].status = "OPEN";
    if (field === "soldLot") lots[0].status = "SOLD";
    assert.equal((await request("schedule")).status, 409);
    auction.status = "SCHEDULED"; now = auction.startsAt; assert.equal((await request("open")).status, 409); assert.equal(auction.status, "SCHEDULED");
  });
  it("reenvios são idempotentes e não duplicam eventos nem reabrem lotes", async () => {
    await request("schedule"); assert.equal((await (await request("schedule")).json()).unchanged, true);
    now = auction.startsAt; await request("open"); const audit = auditCount;
    const response = await request("open"); assert.equal(response.status, 200); assert.equal((await response.json()).unchanged, true); assert.equal(auditCount, audit); assert(lots.every(lot => lot.version === 1));
  });
  it("falha da auditoria mantém leilão e todos os lotes sem abertura", async () => {
    await request("schedule"); now = auction.startsAt; failAudit = true;
    const res = await request("open"); assert.equal(res.status, 500); assert.deepEqual(await res.json(), { message: "Erro interno do servidor." });
    assert.equal(auction.status, "SCHEDULED"); assert(lots.every(lot => lot.status === "PENDING")); assert.equal(auditCount, 0);
  });
});
