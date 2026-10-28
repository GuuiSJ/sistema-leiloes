import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { Prisma, type Auction, type Vehicle } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { errorHandler } from "../src/middlewares/error-handler";
import { createLotRouter } from "../src/modules/lots/lot.routes";
import { LotService } from "../src/modules/lots/lot.service";
import type { LotRecord, LotRepository } from "../src/modules/lots/lot.types";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository, PublicUser } from "../src/modules/auth/auth.types";

describe("Lotes HTTP (JWT real, repositório em memória)", () => {
  const rows = new Map<string, LotRecord>(), auctions = new Map<string, Auction>(), vehicles = new Map<string, Vehicle>();
  const users = new Map<string, PublicUser>(), history = new Set<string>();
  const ownerId = randomUUID(), otherId = randomUUID(), bidderId = randomUUID();
  const auctionId = randomUUID(), otherAuctionId = randomUUID(), vehicleId = randomUUID(), secondVehicleId = randomUUID(), foreignVehicleId = randomUUID();
  const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  let server: Server, base: string;
  let beforeWrite: (() => void) | undefined;
  let fail = false;
  const repository: LotRepository = {
    async list(id, q) {
      if (!auctions.has(id)) throw new HttpError(404, "Leilão não encontrado.");
      const all = [...rows.values()].filter(l => l.auctionId === id).sort((a, b) => a.number - b.number);
      return { lots: all.slice((q.page - 1) * q.limit, q.page * q.limit), total: all.length };
    },
    async findById(id, lotId) { const lot = rows.get(lotId); return lot?.auctionId === id ? lot : null; },
    async write(command, validate) {
      if (fail) throw new Error("Mensagem privada");
      beforeWrite?.();
      const auction = auctions.get(command.auctionId);
      if (!auction) throw new HttpError(404, "Leilão não encontrado.");
      const lot = command.operation === "create" ? null : rows.get(command.lotId);
      if (command.operation !== "create" && (!lot || lot.auctionId !== command.auctionId)) throw new HttpError(404, "Lote não encontrado.");
      const selectedId = command.operation === "delete" ? lot!.vehicleId : command.input.vehicleId ?? lot!.vehicleId;
      const vehicle = vehicles.get(selectedId);
      if (!vehicle) throw new HttpError(404, "Veículo não encontrado.");
      validate({ auction, vehicle, lot: lot ?? null, currentVehicle: lot ? vehicles.get(lot.vehicleId)! : null, hasHistory: !!lot && history.has(lot.id) });
      if (command.operation === "delete") { rows.delete(lot!.id); return lot!; }
      const input = command.input;
      const number = input.number ?? lot!.number;
      if ([...rows.values()].some(row => row.auctionId === command.auctionId && row.id !== lot?.id && (row.number === number || row.vehicleId === selectedId))) throw new HttpError(409, "Lote duplicado.");
      const result: LotRecord = {
        id: lot?.id ?? randomUUID(), auctionId: command.auctionId, vehicleId: selectedId, vehicle, auction, number, endsAt: lot?.endsAt ?? null,
        startingPrice: new Prisma.Decimal(input.startingPrice ?? lot!.startingPrice),
        minimumIncrement: new Prisma.Decimal(command.operation === "create" ? command.input.minimumIncrement : lot!.minimumIncrement),
        status: lot?.status ?? "PENDING", winnerId: lot?.winnerId ?? null,
        version: lot ? lot.version + 1 : 0, createdAt: lot?.createdAt ?? new Date(), updatedAt: new Date(),
      };
      rows.set(result.id, result); return result;
    },
  };
  const auth: AuthRepository = {
    async findPublicById(id) { return users.get(id) ?? null; },
    async findByEmail() { throw new Error("Não utilizado"); }, async createBidder() { throw new Error("Não utilizado"); },
  };
  before(async () => {
    const app = express(); app.use(express.json());
    app.use("/api/auctions/:auctionId/lots", createLotRouter(repository, createAuthenticate(auth, () => config)));
    app.use(errorHandler);
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve()); server.once("error", reject);
    });
    const address = server.address(); assert(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}/api/auctions`;
  });
  beforeEach(() => {
    rows.clear(); auctions.clear(); vehicles.clear(); users.clear(); history.clear(); beforeWrite = undefined; fail = false;
    for (const id of [ownerId, otherId, bidderId]) users.set(id, { id, name: "Privado", email: "private@example.com", role: id === bidderId ? "BIDDER" : "AUCTIONEER", createdAt: new Date() });
    const auction: Auction = { id: auctionId, organizerId: ownerId, temporalGeneration: "UTC_V2", title: "Leilão", description: null, status: "DRAFT", startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 172800000), createdAt: new Date(), updatedAt: new Date() };
    auctions.set(auctionId, auction); auctions.set(otherAuctionId, { ...auction, id: otherAuctionId, organizerId: otherId });
    const vehicle: Vehicle = { id: vehicleId, ownerId, brand: "Fiat", model: "Uno", year: 2020, version: null, description: null, imageUrls: [], fipeCode: null, fipeBrandCode: null, fipeModelCode: null, fipeYearCode: null, fipeReferenceMonth: null, fipeReferencePrice: null, fipeConsultedAt: null, createdAt: new Date(), updatedAt: new Date() };
    vehicles.set(vehicleId, vehicle); vehicles.set(secondVehicleId, { ...vehicle, id: secondVehicleId }); vehicles.set(foreignVehicleId, { ...vehicle, id: foreignVehicleId, ownerId: otherId });
  });
  after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
  const payload = () => ({ vehicleId, number: 1, startingPrice: "45000.00", minimumIncrement: "500.00" });
  async function request(method: string, path = "", body?: unknown, userId?: string, auction: string = auctionId) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (userId) headers.Authorization = `Bearer ${signAccessToken(userId, config)}`;
    return fetch(`${base}/${auction}/lots${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function create() { const res = await request("POST", "", payload(), ownerId); assert.equal(res.status, 201); return (await res.json()).lot; }
  it("cria PENDING com valores exatos e veículo público, sem proprietário ou versão interna", async () => {
    const lot = await create(); assert.equal(lot.status, "PENDING"); assert.equal(lot.startingPrice, "45000.00");
    assert.equal(lot.minimumIncrement, "500.00"); assert.equal(lot.vehicle.brand, "Fiat");
    assert.equal(lot.vehicle.ownerId, undefined); assert.equal(lot.winnerId, undefined); assert.equal(lot.version, undefined);
    assert.equal(rows.get(lot.id)!.vehicleId, vehicleId);
  });
  it("aceita extremos Decimal sem arredondar em ponto flutuante", async () => {
    const res = await request("POST", "", { ...payload(), startingPrice: "9999999999999999.99", minimumIncrement: "0.01" }, ownerId);
    assert.equal(res.status, 201); const { lot } = await res.json(); assert.equal(lot.startingPrice, "9999999999999999.99"); assert.equal(lot.minimumIncrement, "0.01");
  });
  it("exige JWT e AUCTIONEER em todas as escritas", async () => {
    const lot = await create();
    for (const [method, path, body] of [["POST", "", payload()], ["PATCH", `/${lot.id}`, { number: 2 }], ["DELETE", `/${lot.id}`, undefined]] as const) {
      assert.equal((await request(method, path, body)).status, 401); assert.equal((await request(method, path, body, bidderId)).status, 403);
    }
  });
  it("rejeita JWT inválido e consulta o perfil atual", async () => {
    assert.equal((await fetch(`${base}/${auctionId}/lots`, { method: "POST", headers: { Authorization: "Bearer inválido" } })).status, 401);
    users.get(ownerId)!.role = "BIDDER"; assert.equal((await request("POST", "", payload(), ownerId)).status, 403);
  });
  it("proíbe criação, edição e exclusão por outro leiloeiro", async () => {
    const lot = await create();
    assert.equal((await request("POST", "", payload(), otherId)).status, 403);
    assert.equal((await request("PATCH", `/${lot.id}`, { number: 2 }, otherId)).status, 403);
    assert.equal((await request("DELETE", `/${lot.id}`, undefined, otherId)).status, 403); assert(rows.has(lot.id));
  });
  it("rejeita veículo de outro dono na criação e troca", async () => {
    assert.equal((await request("POST", "", { ...payload(), vehicleId: foreignVehicleId }, ownerId)).status, 403);
    const lot = await create(); assert.equal((await request("PATCH", `/${lot.id}`, { vehicleId: foreignVehicleId }, ownerId)).status, 403);
  });
  it("verifica também dono do veículo já associado", async () => {
    const lot = await create(); vehicles.get(vehicleId)!.ownerId = otherId;
    assert.equal((await request("PATCH", `/${lot.id}`, { vehicleId: secondVehicleId }, ownerId)).status, 403);
    assert.equal((await request("DELETE", `/${lot.id}`, undefined, ownerId)).status, 403);
  });
  for (const value of [undefined, null, 100, 0, "0", "0.00", "-1", "1.001", "1e3", "1,00", "NaN", "Infinity", "10000000000000000", "01.00", " 1.00", ""]) {
    it(`rejeita preço inválido ${JSON.stringify(value)}`, async () => {
      assert.equal((await request("POST", "", { ...payload(), startingPrice: value }, ownerId)).status, 400);
      assert.equal(rows.size, 0);
    });
  }
  it("valida incremento obrigatório positivo e número Int do PostgreSQL", async () => {
    for (const value of [undefined, null, "0", "-1", 10, "1.001"]) assert.equal((await request("POST", "", { ...payload(), minimumIncrement: value }, ownerId)).status, 400);
    for (const value of [undefined, null, "1", 0, -1, 1.5, 2147483648]) assert.equal((await request("POST", "", { ...payload(), number: value }, ownerId)).status, 400);
  });
  it("rejeita campos extras, IDs internos, dono e status", async () => {
    const lot = await create();
    for (const field of ["id", "auctionId", "ownerId", "organizerId", "status", "winnerId", "version", "endsAt", "bids", "unknown"]) {
      assert.equal((await request("POST", "", { ...payload(), [field]: "forjado" }, ownerId)).status, 400);
      assert.equal((await request("PATCH", `/${lot.id}`, { [field]: "forjado" }, ownerId)).status, 400);
    }
  });
  it("rejeita corpos inválidos e PATCH vazio ou de incremento", async () => {
    const lot = await create();
    for (const body of [null, [], {}]) {
      assert.equal((await request("POST", "", body, ownerId)).status, 400);
      assert.equal((await request("PATCH", `/${lot.id}`, body, ownerId)).status, 400);
    }
    assert.equal((await request("PATCH", `/${lot.id}`, { minimumIncrement: "2.00" }, ownerId)).status, 400);
    assert.equal((await request("PATCH", `/${lot.id}`, { startingPrice: "1.001" }, ownerId)).status, 400);
    assert.equal((await request("DELETE", `/${lot.id}`, {}, ownerId)).status, 400);
  });
  it("impede número e veículo duplicados na criação e edição", async () => {
    const first = await create();
    assert.equal((await request("POST", "", { ...payload(), vehicleId: secondVehicleId }, ownerId)).status, 409);
    assert.equal((await request("POST", "", { ...payload(), number: 2 }, ownerId)).status, 409);
    const second = await (await request("POST", "", { ...payload(), number: 2, vehicleId: secondVehicleId }, ownerId)).json();
    assert.equal((await request("PATCH", `/${second.lot.id}`, { number: first.number }, ownerId)).status, 409);
    assert.equal((await request("PATCH", `/${second.lot.id}`, { vehicleId }, ownerId)).status, 409);
  });
  it("permite o mesmo número e veículo em outro leilão do mesmo dono", async () => {
    await create(); auctions.get(otherAuctionId)!.organizerId = ownerId;
    assert.equal((await request("POST", "", payload(), ownerId, otherAuctionId)).status, 201);
  });
  it("lista publicamente em ordem de número com paginação", async () => {
    const high = await (await request("POST", "", { ...payload(), number: 10 }, ownerId)).json();
    const low = await (await request("POST", "", { ...payload(), vehicleId: secondVehicleId, number: 2 }, ownerId)).json();
    const page1 = await (await request("GET", "?limit=1")).json(); assert.equal(page1.data[0].id, low.lot.id);
    assert.deepEqual(page1.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
    const page2 = await (await request("GET", "?limit=1&page=2")).json(); assert.equal(page2.data[0].id, high.lot.id);
    assert.equal(page2.data[0].vehicle.ownerId, undefined);
    assert.deepEqual((await (await request("GET", "?page=100")).json()).data, []);
    assert.deepEqual((await (await request("GET", "", undefined, undefined, otherAuctionId)).json()).data, []);
  });
  it("valida paginação, filtros desconhecidos e parâmetros duplicados", async () => {
    for (const q of ["page=0", "page=1.5", "page=1000001", "limit=101", "limit=0", "limit=x", "page=1&page=2", "status=PENDING"]) assert.equal((await request("GET", `?${q}`)).status, 400);
  });
  it("consulta pública verifica o leilão do lote e omite dados privados", async () => {
    const lot = await create(); Object.assign(vehicles.get(vehicleId)!, { owner: { email: "private@example.com" } });
    const res = await request("GET", `/${lot.id}`); assert.equal(res.status, 200);
    const body = (await res.json()).lot; assert.equal(body.vehicle.owner, undefined); assert.equal(body.winnerId, undefined);
    assert.equal((await request("GET", `/${lot.id}`, undefined, undefined, otherAuctionId)).status, 404);
    assert.equal((await request("PATCH", `/${lot.id}`, { number: 2 }, ownerId, otherAuctionId)).status, 404);
    assert.equal((await request("DELETE", `/${lot.id}`, undefined, ownerId, otherAuctionId)).status, 404);
  });
  it("trata IDs malformados e inexistentes", async () => {
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const body = method === "PATCH" ? { number: 2 } : undefined;
      assert.equal((await request(method, "/invalid", body, ownerId)).status, 400);
      assert.equal((await request(method, `/${randomUUID()}`, body, ownerId)).status, 404);
      assert.equal((await request(method, `/${randomUUID()}`, body, ownerId, "invalid")).status, 400);
    }
    assert.equal((await request("GET", "", undefined, undefined, randomUUID())).status, 404);
    assert.equal((await request("POST", "", payload(), ownerId, randomUUID())).status, 404);
    assert.equal((await request("POST", "", { ...payload(), vehicleId: randomUUID() }, ownerId)).status, 404);
  });
  it("edita veículo, número e preço preservando incremento, IDs e status", async () => {
    const lot = await create();
    const res = await request("PATCH", `/${lot.id}`, { vehicleId: secondVehicleId, number: 3, startingPrice: "0.01" }, ownerId);
    assert.equal(res.status, 200); const updated = (await res.json()).lot;
    assert.equal(updated.vehicleId, secondVehicleId); assert.equal(updated.number, 3); assert.equal(updated.startingPrice, "0.01");
    assert.equal(updated.id, lot.id); assert.equal(updated.status, "PENDING"); assert.equal(updated.minimumIncrement, "500.00");
    assert.equal(rows.get(lot.id)!.version, 1);
  });
  it("exclui PENDING sem histórico, responde 204 e mantém veículo e leilão", async () => {
    const lot = await create(); const res = await request("DELETE", `/${lot.id}`, undefined, ownerId);
    assert.equal(res.status, 204); assert.equal(await res.text(), ""); assert.equal(rows.size, 0); assert(vehicles.has(vehicleId)); assert(auctions.has(auctionId));
  });
  for (const status of ["SCHEDULED", "OPEN", "CLOSED", "CANCELLED"] as const) it(`bloqueia escritas em leilão ${status}`, async () => {
    const lot = await create(); auctions.get(auctionId)!.status = status;
    assert.equal((await request("POST", "", { ...payload(), number: 2, vehicleId: secondVehicleId }, ownerId)).status, 409);
    assert.equal((await request("PATCH", `/${lot.id}`, { number: 2 }, ownerId)).status, 409);
    assert.equal((await request("DELETE", `/${lot.id}`, undefined, ownerId)).status, 409); assert(rows.has(lot.id));
  });
  for (const status of ["OPEN", "SOLD", "UNSOLD", "CANCELLED"] as const) it(`bloqueia edição e exclusão de lote ${status}`, async () => {
    const lot = await create(); rows.get(lot.id)!.status = status;
    assert.equal((await request("PATCH", `/${lot.id}`, { number: 2 }, ownerId)).status, 409);
    assert.equal((await request("DELETE", `/${lot.id}`, undefined, ownerId)).status, 409);
  });
  it("bloqueia leilão DRAFT com início alcançado", async () => {
    const lot = await create(); auctions.get(auctionId)!.startsAt = new Date(Date.now() - 1000);
    assert.equal((await request("POST", "", { ...payload(), number: 2, vehicleId: secondVehicleId }, ownerId)).status, 409);
    assert.equal((await request("PATCH", `/${lot.id}`, { number: 2 }, ownerId)).status, 409);
    assert.equal((await request("DELETE", `/${lot.id}`, undefined, ownerId)).status, 409);
  });
  it("reproduz o bloqueio do PALIO com datas vencidas sem criar lote", async () => {
    Object.assign(auctions.get(auctionId)!, {
      title: "leilão PALIO", startsAt: new Date("2026-10-28T14:30:00.000Z"), endsAt: new Date("2026-10-28T14:35:00.000Z"),
    });
    const service = new LotService(repository, () => new Date("2026-10-28T15:04:43.000Z"));
    await assert.rejects(service.create(auctionId, payload(), ownerId), (error: unknown) => {
      assert(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.message, "Somente leilões DRAFT ainda não iniciados permitem gerenciar lotes.");
      return true;
    });
    assert.equal(rows.size, 0);
  });
  it("retorna a causa temporal no corpo HTTP 409 sem confundir com duplicidade", async () => {
    auctions.get(auctionId)!.startsAt = new Date(Date.now() - 1000);
    const response = await request("POST", "", payload(), ownerId);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { message: "Somente leilões DRAFT ainda não iniciados permitem gerenciar lotes." });
    assert.equal(rows.size, 0);
  });
  it("preserva lote com histórico ou vencedor mesmo PENDING", async () => {
    const lot = await create(); history.add(lot.id);
    assert.equal((await request("PATCH", `/${lot.id}`, { number: 2 }, ownerId)).status, 409);
    assert.equal((await request("DELETE", `/${lot.id}`, undefined, ownerId)).status, 409);
    history.clear(); rows.get(lot.id)!.winnerId = bidderId;
    assert.equal((await request("DELETE", `/${lot.id}`, undefined, ownerId)).status, 409); assert(rows.has(lot.id));
  });
  it("revalida estado e dono dentro da operação atômica", async () => {
    const lot = await create(); beforeWrite = () => { history.add(lot.id); };
    assert.equal((await request("DELETE", `/${lot.id}`, undefined, ownerId)).status, 409);
    history.clear(); beforeWrite = () => { auctions.get(auctionId)!.organizerId = otherId; };
    assert.equal((await request("PATCH", `/${lot.id}`, { number: 2 }, ownerId)).status, 403); assert.equal(rows.get(lot.id)!.number, 1);
  });
  it("não expõe falhas internas", async () => {
    fail = true; const res = await request("POST", "", payload(), ownerId);
    assert.equal(res.status, 500); assert.deepEqual(await res.json(), { message: "Erro interno do servidor." });
  });
});
