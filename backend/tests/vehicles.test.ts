import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { Prisma, type Vehicle } from "../src/generated/prisma/client";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { errorHandler } from "../src/middlewares/error-handler";
import { createVehicleRouter } from "../src/modules/vehicles/vehicle.routes";
import type { VehicleLotState, VehicleRepository } from "../src/modules/vehicles/vehicle.types";
import { HttpError } from "../src/errors/http-error";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository, PublicUser } from "../src/modules/auth/auth.types";

describe("Veículos HTTP (repositório em memória, JWT real)", () => {
  const rows = new Map<string, Vehicle>();
  const users = new Map<string, PublicUser>();
  const lots = new Map<string, VehicleLotState[]>();
  const audited = new Set<string>();
  const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  const auctioneer = randomUUID(), other = randomUUID(), bidder = randomUUID();
  let base: string, server: Server;
  let fail = false;
  let changeBeforeMutation: (() => void) | undefined;
  const repository: VehicleRepository = {
    async create(input, ownerId) {
      if (fail) throw new Error("Falha privada");
      const vehicle: Vehicle = { ...input, ownerId, id: randomUUID(), fipeReferencePrice: input.fipeReferencePrice === null ? null : new Prisma.Decimal(input.fipeReferencePrice), fipeConsultedAt: null, createdAt: new Date(), updatedAt: new Date() };
      rows.set(vehicle.id, vehicle);
      return vehicle;
    },
    async findById(id) { if (fail) throw new Error("Falha privada"); return rows.get(id) ?? null; },
    async list(q) {
      const filtered = [...rows.values()].filter(v => (!q.brand || v.brand.toLowerCase().includes(q.brand.toLowerCase())) && (!q.model || v.model.toLowerCase().includes(q.model.toLowerCase())) && (!q.year || v.year === q.year))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
      return { vehicles: filtered.slice((q.page - 1) * q.limit, q.page * q.limit), total: filtered.length };
    },
    async mutate(id, decide) {
      if (fail) throw new Error("Falha privada");
      changeBeforeMutation?.();
      const vehicle = rows.get(id);
      if (!vehicle) throw new HttpError(404, "Veículo não encontrado.");
      const decision = decide({ vehicle, lots: lots.get(id) ?? [], hasAuditHistory: audited.has(id) });
      if (decision.operation === "delete") { rows.delete(id); return vehicle; }
      const input = { ...vehicle, ...decision.data };
      const updated = { ...input, fipeReferencePrice: input.fipeReferencePrice === null ? null : new Prisma.Decimal(input.fipeReferencePrice), fipeConsultedAt: null, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
  };
  const authRepository: AuthRepository = {
    async findPublicById(id) { return users.get(id) ?? null; },
    async findByEmail() { throw new Error("Não utilizado"); },
    async createBidder() { throw new Error("Não utilizado"); },
  };
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/vehicles", createVehicleRouter(repository, createAuthenticate(authRepository, () => config)));
    app.use(errorHandler);
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
      server.once("error", reject);
    });
    const address = server.address();
    assert(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}/api/vehicles`;
  });
  beforeEach(() => {
    rows.clear(); users.clear(); lots.clear(); audited.clear(); fail = false; changeBeforeMutation = undefined;
    for (const id of [auctioneer, other, bidder]) users.set(id, { id, name: "Privado", email: "private@example.com", role: id === bidder ? "BIDDER" : "AUCTIONEER", createdAt: new Date() });
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const payload = () => ({ brand: " Fiat ", model: "Uno", year: 2020, description: "Veículo conservado", imageUrls: ["https://example.com/uno.jpg"] });
  async function request(method: string, path = "", body?: unknown, userId?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (userId) headers.Authorization = `Bearer ${signAccessToken(userId, config)}`;
    return fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function create() {
    const response = await request("POST", "", payload(), auctioneer);
    assert.equal(response.status, 201);
    return (await response.json()).vehicle;
  }
  it("cadastra manualmente sem BrasilAPI e normaliza dados", async () => {
    const vehicle = await create();
    assert.equal(vehicle.brand, "Fiat");
    assert.equal(vehicle.version, null);
    assert.equal(vehicle.fipeConsultedAt, null);
    assert.equal(vehicle.fipeReferencePriceVerified, false);
    assert.equal(rows.size, 1);
    assert.equal(rows.get(vehicle.id)!.ownerId, auctioneer);
    assert.equal(vehicle.ownerId, undefined);
  });
  it("aceita FIPE opcional como referência não verificada com decimal exato", async () => {
    const response = await request("POST", "", { ...payload(), fipeCode: "001001-1", fipeBrandCode: "21", fipeModelCode: "123", fipeYearCode: "2020-1", fipeReferenceMonth: "outubro/2026", fipeReferencePrice: "9999999999999999.99" }, auctioneer);
    assert.equal(response.status, 201);
    const { vehicle } = await response.json();
    assert.equal(vehicle.fipeReferencePrice, "9999999999999999.99");
    assert.equal(vehicle.fipeReferencePriceVerified, false);
    assert.equal(vehicle.fipeConsultedAt, null);
  });
  it("aceita campos opcionais nulos e lista vazia de imagens", async () => {
    const response = await request("POST", "", { ...payload(), imageUrls: [], version: null, description: null, fipeReferencePrice: null }, auctioneer);
    assert.equal(response.status, 201);
  });
  for (const [name, change] of Object.entries({
    "marca ausente": { brand: undefined }, "modelo vazio": { model: " " },
    "marca longa": { brand: "a".repeat(101) }, "modelo longo": { model: "a".repeat(151) },
    "versão longa": { version: "a".repeat(151) }, "descrição longa": { description: "a".repeat(10001) },
    "ano antigo": { year: 1885 }, "ano futuro": { year: new Date().getUTCFullYear() + 2 },
    "ano string": { year: "2020" }, "ano fracionário": { year: 2020.5 },
    "imagens ausentes": { imageUrls: undefined }, "imagens demais": { imageUrls: Array(21).fill("https://example.com/a") },
    "URL inválida": { imageUrls: ["imagem.jpg"] }, "URL javascript": { imageUrls: ["javascript:alert(1)"] },
    "URL com credenciais": { imageUrls: ["https://user:pass@example.com/a"] },
    "campo desconhecido": { unknown: true }, "id interno": { id: randomUUID() },
    "proprietário forjado": { ownerId: randomUUID() }, "relações": { lots: [] },
    "consulta FIPE forjada": { fipeConsultedAt: new Date().toISOString() },
    "preço numérico": { fipeReferencePrice: 100 }, "preço negativo": { fipeReferencePrice: "-1" },
    "preço impreciso": { fipeReferencePrice: "1.001" }, "preço enorme": { fipeReferencePrice: "10000000000000000" },
    "código longo": { fipeCode: "a".repeat(31) }, "caractere nulo": { brand: "Fi\0at" },
  })) it(`rejeita ${name}`, async () => {
    assert.equal((await request("POST", "", { ...payload(), ...change }, auctioneer)).status, 400);
    assert.equal(rows.size, 0);
  });
  it("rejeita corpos que não são objetos", async () => {
    for (const body of [null, [], {}]) assert.equal((await request("POST", "", body, auctioneer)).status, 400);
  });
  it("exige JWT e AUCTIONEER em todas as escritas", async () => {
    const vehicle = await create();
    for (const [method, path, body] of [["POST", "", payload()], ["PATCH", `/${vehicle.id}`, { brand: "Novo" }], ["DELETE", `/${vehicle.id}`, undefined]] as const) {
      assert.equal((await request(method, path, body)).status, 401);
      assert.equal((await request(method, path, body, bidder)).status, 403);
    }
  });
  it("rejeita JWT inválido e revalida perfil no banco", async () => {
    assert.equal((await fetch(base, { method: "POST", headers: { Authorization: "Bearer inválido" } })).status, 401);
    users.get(auctioneer)!.role = "BIDDER";
    assert.equal((await request("POST", "", payload(), auctioneer)).status, 403);
  });
  it("lista publicamente com filtros combinados e paginação", async () => {
    await create(); await create();
    const response = await request("GET", "?brand=FI&model=un&year=2020&page=1&limit=1");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.length, 1);
    assert.deepEqual(body.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
    const page2 = await (await request("GET", "?page=2&limit=1")).json();
    assert.notEqual(page2.data[0].id, body.data[0].id);
    assert.deepEqual((await (await request("GET", "?brand=Ford")).json()).data, []);
    assert.deepEqual((await (await request("GET", "?page=10")).json()).data, []);
  });
  it("valida filtros, paginação e parâmetros duplicados", async () => {
    for (const q of ["page=0", "page=1.5", "page=1000001", "limit=101", "limit=abc", "year=1800", "year=2020x", "brand=", "model=a&model=b", "page=1&page=2", "ownerId=x"]) assert.equal((await request("GET", `?${q}`)).status, 400, q);
  });
  it("consulta detalhe público com seleção explícita", async () => {
    const vehicle = await create();
    Object.assign(rows.get(vehicle.id)!, { lots: [{ private: true }], owner: { email: "private@example.com", passwordHash: "private" } });
    const response = await request("GET", `/${vehicle.id}`);
    assert.equal(response.status, 200);
    const body = (await response.json()).vehicle;
    assert.equal(body.id, vehicle.id);
    assert.equal(body.lots, undefined); assert.equal(body.ownerId, undefined);
    assert.equal(body.owner, undefined);
    const list = await (await request("GET")).json();
    assert.equal(list.data[0].lots, undefined);
    assert.equal(list.data[0].ownerId, undefined);
    assert.equal(list.data[0].owner, undefined);
  });
  it("trata IDs inválidos e registros inexistentes em todas as rotas", async () => {
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const body = method === "PATCH" ? { brand: "Novo" } : undefined;
      assert.equal((await request(method, "/invalid", body, auctioneer)).status, 400);
      assert.equal((await request(method, `/${randomUUID()}`, body, auctioneer)).status, 404);
    }
  });
  it("bloqueia edição e exclusão por outro leiloeiro", async () => {
    const vehicle = await create();
    const snapshot = JSON.stringify([...rows.values()]);
    for (const user of [other]) {
      assert.equal((await request("PATCH", `/${vehicle.id}`, { description: "Mudança" }, user)).status, 403);
      assert.equal((await request("DELETE", `/${vehicle.id}`, undefined, user)).status, 403);
    }
    assert.equal(JSON.stringify([...rows.values()]), snapshot);
  });
  const pendingLot = (): VehicleLotState => ({ status: "PENDING", winnerId: null, hasHistory: false, auction: { status: "DRAFT", startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 172800000) } });
  it("edita campos permitidos pelo proprietário sem trocar propriedade", async () => {
    const vehicle = await create();
    const response = await request("PATCH", `/${vehicle.id}`, { brand: "Ford", model: "Ka", year: 2021, version: null, description: "Revisado", imageUrls: [], fipeReferencePrice: "123.40" }, auctioneer);
    assert.equal(response.status, 200);
    const body = (await response.json()).vehicle;
    assert.equal(body.brand, "Ford"); assert.equal(body.fipeReferencePrice, "123.40");
    assert.equal(body.ownerId, undefined);
    assert.equal(rows.get(vehicle.id)!.ownerId, auctioneer);
    assert.equal(rows.get(vehicle.id)!.fipeConsultedAt, null);
  });
  it("permite edição com lote PENDING em leilão DRAFT ou SCHEDULED futuro", async () => {
    const vehicle = await create();
    for (const status of ["DRAFT", "SCHEDULED"] as const) {
      const lot = pendingLot(); lot.auction.status = status;
      lots.set(vehicle.id, [lot]);
      assert.equal((await request("PATCH", `/${vehicle.id}`, { version: "Nova versão" }, auctioneer)).status, 200);
    }
  });
  it("exclui veículo sem vínculos pelo proprietário e retorna 204 sem corpo", async () => {
    const vehicle = await create();
    const response = await request("DELETE", `/${vehicle.id}`, undefined, auctioneer);
    assert.equal(response.status, 204); assert.equal(await response.text(), "");
    assert.equal(rows.size, 0);
    assert.equal((await request("GET", `/${vehicle.id}`)).status, 404);
  });
  it("bloqueia exclusão com qualquer lote, inclusive PENDING e CANCELLED", async () => {
    const vehicle = await create();
    for (const status of ["PENDING", "OPEN", "SOLD", "UNSOLD", "CANCELLED"] as const) {
      lots.set(vehicle.id, [{ ...pendingLot(), status }]);
      assert.equal((await request("DELETE", `/${vehicle.id}`, undefined, auctioneer)).status, 409);
      assert(rows.has(vehicle.id));
    }
  });
  it("protege edição em leilões ativos, encerrados, cancelados ou já iniciados", async () => {
    const vehicle = await create();
    for (const status of ["OPEN", "CLOSED", "CANCELLED"] as const) {
      const lot = pendingLot(); lot.auction.status = status;
      lots.set(vehicle.id, [lot]);
      assert.equal((await request("PATCH", `/${vehicle.id}`, { year: 2021 }, auctioneer)).status, 409);
    }
    const lot = pendingLot(); lot.auction.startsAt = new Date(Date.now() - 1000);
    lots.set(vehicle.id, [lot]);
    assert.equal((await request("PATCH", `/${vehicle.id}`, { year: 2021 }, auctioneer)).status, 409);
    assert.equal(rows.get(vehicle.id)!.year, 2020);
  });
  it("bloqueia edição com lote não pendente, vencedor ou histórico", async () => {
    const vehicle = await create();
    for (const change of [{ status: "OPEN" as const }, { status: "SOLD" as const }, { status: "UNSOLD" as const }, { status: "CANCELLED" as const }, { winnerId: bidder }, { hasHistory: true }]) {
      lots.set(vehicle.id, [{ ...pendingLot(), ...change }]);
      assert.equal((await request("PATCH", `/${vehicle.id}`, { year: 2021 }, auctioneer)).status, 409);
    }
    assert.equal(rows.get(vehicle.id)!.year, 2020);
  });
  it("preserva auditoria e bloqueia edição e exclusão mesmo sem lote", async () => {
    const vehicle = await create(); audited.add(vehicle.id);
    assert.equal((await request("PATCH", `/${vehicle.id}`, { year: 2021 }, auctioneer)).status, 409);
    assert.equal((await request("DELETE", `/${vehicle.id}`, undefined, auctioneer)).status, 409);
    assert(audited.has(vehicle.id)); assert(rows.has(vehicle.id));
  });
  it("usa o estado da transação para autorizar e conferir lotes", async () => {
    const vehicle = await create();
    changeBeforeMutation = () => { rows.get(vehicle.id)!.ownerId = other; };
    assert.equal((await request("PATCH", `/${vehicle.id}`, { year: 2021 }, auctioneer)).status, 403);
    rows.get(vehicle.id)!.ownerId = auctioneer;
    changeBeforeMutation = () => { lots.set(vehicle.id, [pendingLot()]); };
    assert.equal((await request("DELETE", `/${vehicle.id}`, undefined, auctioneer)).status, 409);
    assert(rows.has(vehicle.id));
  });
  it("rejeita tentativas de escolher ou alterar proprietário", async () => {
    const vehicle = await create();
    for (const field of ["ownerId", "owner", "userId", "organizerId"]) {
      assert.equal((await request("POST", "", { ...payload(), [field]: other }, auctioneer)).status, 400);
      assert.equal((await request("PATCH", `/${vehicle.id}`, { [field]: other }, auctioneer)).status, 400);
    }
    assert.equal(rows.get(vehicle.id)!.ownerId, auctioneer);
    assert.equal(rows.size, 1);
  });
  it("valida PATCH sem efetuar alterações inválidas", async () => {
    const vehicle = await create();
    for (const body of [{}, { id: randomUUID() }, { year: 1 }, { imageUrls: ["ftp://example.com/a"] }]) assert.equal((await request("PATCH", `/${vehicle.id}`, body, auctioneer)).status, 400);
  });
  it("rejeita corpo no DELETE sem apagar o veículo", async () => {
    const vehicle = await create();
    for (const body of [{}, { cascade: true }, { id: randomUUID() }]) {
      assert.equal((await request("DELETE", `/${vehicle.id}`, body, auctioneer)).status, 400);
    }
    assert.equal(rows.size, 1);
  });
  it("não expõe falhas internas", async () => {
    fail = true;
    const response = await request("POST", "", payload(), auctioneer);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: "Erro interno do servidor." });
  });
});
