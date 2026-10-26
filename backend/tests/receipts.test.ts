import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { Prisma } from "../src/generated/prisma/client";
import { createReceiptRouter } from "../src/modules/receipts/receipt.routes";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { errorHandler } from "../src/middlewares/error-handler";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository } from "../src/modules/auth/auth.types";

describe("Comprovantes HTTP com JWT", () => {
  const owner = randomUUID(), winner = randomUUID(), other = randomUUID(), otherOwner = randomUUID(), lotId = randomUUID(), emptyLot = randomUUID();
  const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  const receipt = { id: randomUUID(), publicId: randomUUID(), lotId, winnerId: winner, winningBidId: randomUUID(), finalAmount: new Prisma.Decimal("100.00"), issuedAt: new Date(), auctionTitle: "Teste", lotNumber: 1, vehicleBrand: "Marca", vehicleModel: "Modelo", vehicleYear: 2020, vehicleVersion: null };
  const auth: AuthRepository = { async findPublicById(id) { return ([owner, winner, other, otherOwner] as string[]).includes(id) ? { id, name: "Private", email: "private@example.com", role: id === owner || id === otherOwner ? "AUCTIONEER" : "BIDDER", createdAt: new Date() } : null; }, async findByEmail() { return null; }, async createBidder() { throw new Error(); } };
  let server: Server, base: string;
  const get = (id: string = lotId, user?: string, suffix = "") => fetch(`${base}/${id}/receipt${suffix}`, { headers: user ? { Authorization: `Bearer ${signAccessToken(user, config)}` } : {} });
  before(async () => {
    const app = express(); app.use("/api/lots/:lotId/receipt", createReceiptRouter({ async find(id) { return id === lotId ? { auction: { organizerId: owner }, receipt } : id === emptyLot ? { auction: { organizerId: owner }, receipt: null } : null; } }, createAuthenticate(auth, () => config))); app.use(errorHandler);
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r)); const address = server.address(); assert(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}/api/lots`;
  });
  after(async () => { await new Promise<void>((r, j) => server.close(e => e ? j(e) : r())); });
  it("sem JWT retorna 401", async () => { assert.equal((await get()).status, 401); });
  for (const [label, user] of [["vencedor", winner], ["leiloeiro responsável", owner]] as const) it(`permite ${label} e projeta valores sem dados privados`, async () => {
    const response = await get(lotId, user); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); const data = await response.json(); assert.equal(data.receipt.finalAmount, "100.00"); assert.equal(data.receipt.publicId, receipt.publicId); const text = JSON.stringify(data); assert(!text.includes(winner)); assert(!text.includes(owner)); assert(!text.includes("email")); assert(!text.includes('"winnerId"')); assert(!text.includes('"walletId"'));
  });
  for (const [label, user] of [["outro participante", other], ["outro leiloeiro", otherOwner]] as const) it(`nega ${label}`, async () => { assert.equal((await get(lotId, user)).status, 403); });
  it("UUID inválido retorna 400", async () => { assert.equal((await get("invalid", winner)).status, 400); });
  it("lote inexistente retorna 404", async () => { assert.equal((await get(randomUUID(), owner)).status, 404); });
  it("sem comprovante retorna 404 ao responsável", async () => { assert.equal((await get(emptyLot, owner)).status, 404); });
  it("nega consulta sem comprovante a terceiros", async () => { assert.equal((await get(emptyLot, other)).status, 403); });
  it("rejeita parâmetros desconhecidos", async () => { assert.equal((await get(lotId, winner, "?userId=other")).status, 400); });
});
