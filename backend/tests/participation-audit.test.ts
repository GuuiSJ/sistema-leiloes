import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { Prisma, type AuditEvent, type PrismaClient } from "../src/generated/prisma/client";
import { createParticipationRepository } from "../src/modules/participations/participation.repository";
import { createParticipationRouter } from "../src/modules/participations/participation.routes";
import { createPublicReceiptRouter } from "../src/modules/receipts/receipt.routes";
import { auditResult, createPublicAuditRouter, createPublicAuditRepository } from "../src/modules/audit/public-audit";
import { openingAuditHash } from "../src/modules/audit/opening-audit";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository } from "../src/modules/auth/auth.types";
import { HttpError } from "../src/errors/http-error";
import { errorHandler } from "../src/middlewares/error-handler";

const lotId = randomUUID(), auctionId = randomUUID(), userId = randomUUID(), otherId = randomUUID();
const receipt = { id: randomUUID(), publicId: randomUUID(), lotId, winnerId: userId, winningBidId: randomUUID(), finalAmount: new Prisma.Decimal("1000.01"), issuedAt: new Date(), auctionTitle: "Teste", lotNumber: 1, vehicleBrand: "Fiat", vehicleModel: "Palio", vehicleYear: 2014, vehicleVersion: null };
function event(): AuditEvent {
  const base = { id: randomUUID(), sequence: 1n, authorId: userId, action: "LOT_OPENED" as const, entityType: "Lot", entityId: lotId, occurredAt: new Date(), publicData: { formatVersion: 2, auctionId, number: 1, status: "OPEN" }, previousHash: null };
  return { ...base, currentHash: openingAuditHash(base) };
}

describe("Participações e auditoria: consultas HTTP sem banco ou operações financeiras", () => {
  let server: Server, base: string, broken = false, calls: string[] = [];
  const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  const auth: AuthRepository = {
    async findPublicById(id) { return ([userId, otherId] as string[]).includes(id) ? { id, role: id === userId ? "BIDDER" : "AUCTIONEER", name: "Privado", email: "private@example.test", createdAt: new Date() } : null; },
    async findByEmail() { return null; }, async createBidder() { throw new Error("No writes allowed"); },
  };
  before(async () => {
    const app = express();
    app.use("/api/me/participations", createParticipationRouter({ async list(id, page, limit) { calls.push(id); return { data: [], pagination: { page, limit, total: 0, totalPages: 0 } }; } }, createAuthenticate(auth, () => config)));
    app.use("/api/receipts", createPublicReceiptRouter({ async find(id) { return id === receipt.publicId ? receipt : null; } }));
    app.use("/api/lots/:lotId/audit", createPublicAuditRouter({ async get(id, page, limit) {
      if (id !== lotId) throw new HttpError(404, "Lote não encontrado.");
      const item = event();
      return auditResult([broken ? { ...item, currentHash: "0".repeat(64) } : item], id, auctionId, page, limit);
    } }));
    app.use(errorHandler);
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); assert(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(() => { broken = false; calls = []; });
  after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const headers = (id: string) => ({ Authorization: `Bearer ${signAccessToken(id, config)}` });
  it("exige JWT e perfil BIDDER e usa exclusivamente o usuário da sessão", async () => {
    assert.equal((await fetch(`${base}/api/me/participations`)).status, 401);
    assert.equal((await fetch(`${base}/api/me/participations`, { headers: headers(otherId) })).status, 403);
    const response = await fetch(`${base}/api/me/participations?page=2&limit=10`, { headers: headers(userId) });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { data: [], pagination: { page: 2, limit: 10, total: 0, totalPages: 0 } });
    assert.deepEqual(calls, [userId]);
    for (const query of ["userId=other", "page=0", "page=1&page=2", "limit=101"]) assert.equal((await fetch(`${base}/api/me/participations?${query}`, { headers: headers(userId) })).status, 400);
    assert.deepEqual(calls, [userId]);
  });
  it("comprovante público usa publicId e nunca publica vencedor, proprietário ou dados privados", async () => {
    const response = await fetch(`${base}/api/receipts/${receipt.publicId}`);
    assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.receipt.finalAmount, "1000.01"); assert.equal(body.receipt.publicId, receipt.publicId);
    const json = JSON.stringify(body); for (const secret of [userId, receipt.id, "winnerId", "email", "passwordHash", "authorId"]) assert(!json.includes(secret));
    assert.equal((await fetch(`${base}/api/receipts/${lotId}`)).status, 404);
    assert.equal((await fetch(`${base}/api/receipts/invalid`)).status, 400);
    assert.equal((await fetch(`${base}/api/receipts/${receipt.publicId}?token=secret`)).status, 400);
  });
  it("auditoria pública confirma somente hashes válidos e sinaliza adulteração sem divulgar payloads", async () => {
    let response = await fetch(`${base}/api/lots/${lotId}/audit?page=1&limit=10`);
    assert.equal(response.status, 200);
    let body = await response.json(); assert.equal(body.integrity.status, "VALID"); assert.equal(body.data[0].sequence, "1");
    for (const secret of [userId, "authorId", "publicData", "email"]) assert(!JSON.stringify(body).includes(secret));
    broken = true;
    response = await fetch(`${base}/api/lots/${lotId}/audit?page=1&limit=10`); body = await response.json();
    assert.equal(body.integrity.status, "INVALID"); assert.deepEqual(body.data, []);
    assert.equal((await fetch(`${base}/api/lots/invalid/audit`)).status, 400);
    assert.equal((await fetch(`${base}/api/lots/${randomUUID()}/audit`)).status, 404);
    assert.equal((await fetch(`${base}/api/lots/${lotId}/audit?userId=other`)).status, 400);
  });
});

describe("Projeções e integridade sem banco", () => {
  it("consulta apenas lotes com lances do usuário, pagina no banco e separa vencidos dos demais", async () => {
    let winner = userId;
    const client = { async $transaction(fn: (tx: unknown) => unknown, options: unknown) {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return fn({ lot: {
        async findMany(query: any) {
          assert.deepEqual(query.where, { bids: { some: { userId } } }); assert.equal(query.skip, 10); assert.equal(query.take, 10);
          assert.deepEqual(query.include.bids.where, { userId }); assert.equal(query.include.bids.take, 1);
          assert.deepEqual(query.include._count.select.bids.where, { userId });
          return [{ id: lotId, number: 1, status: "SOLD", winnerId: winner, endsAt: null, auction: { id: auctionId, title: "Teste", endsAt: new Date() }, vehicle: { brand: "Fiat", model: "Palio", year: 2014, version: null }, bids: [{ id: receipt.winningBidId, amount: new Prisma.Decimal("1000.01"), createdAt: new Date() }], _count: { bids: 2 }, receipt }];
        },
        async count(query: unknown) { assert.deepEqual(query, { where: { bids: { some: { userId } } } }); return 11; },
      } });
    } } as unknown as PrismaClient;
    const repo = createParticipationRepository(() => client);
    const won = await repo.list(userId, 2, 10); assert.equal(won.data[0]!.outcome, "WON"); assert.equal(won.data[0]!.receiptPublicId, receipt.publicId);
    winner = otherId;
    const lost = await repo.list(userId, 2, 10); assert.equal(lost.data[0]!.outcome, "NOT_WON"); assert.equal(lost.data[0]!.receiptPublicId, null);
    for (const secret of [userId, otherId, "winnerId", "userId", "ownerId"]) assert(!JSON.stringify(lost).includes(secret));
  });
  it("cadeia vazia não é anunciada como válida; payload inesperado e elos quebrados são rejeitados", () => {
    assert.equal(auditResult([], lotId, auctionId, 1, 10).integrity.status, "UNAVAILABLE");
    const original = event();
    for (const changed of [{ ...original, previousHash: "a".repeat(64) }, { ...original, publicData: { email: "secret@example.test" } }]) {
      const result = auditResult([changed], lotId, auctionId, 1, 10); assert.equal(result.integrity.status, "INVALID"); assert.deepEqual(result.data, []);
    }
    const otherLot = { ...original, entityId: randomUUID() }; otherLot.currentHash = openingAuditHash(otherLot);
    assert.equal(auditResult([otherLot], lotId, auctionId, 1, 10).integrity.status, "UNAVAILABLE");
    assert.deepEqual(auditResult([original], lotId, auctionId, 2, 10).data, []);
  });
  it("indisponibilidade do banco propaga falha sem afirmar integridade e sem tentar gravar", async () => {
    const failure = new Error("offline");
    const client = { async $transaction() { throw failure; } } as unknown as PrismaClient;
    await assert.rejects(createPublicAuditRepository(() => client).get(lotId, 1, 10), error => error === failure);
    await assert.rejects(createParticipationRepository(() => client).list(userId, 1, 10), error => error === failure);
  });
});
