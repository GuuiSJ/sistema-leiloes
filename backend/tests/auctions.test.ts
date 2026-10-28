import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import type { Auction, AuctionStatus } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { errorHandler } from "../src/middlewares/error-handler";
import { notFound } from "../src/middlewares/not-found";
import { createAuctionRouter } from "../src/modules/auctions/auction.routes";
import type { AuctionRepository } from "../src/modules/auctions/auction.types";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository, PublicUser } from "../src/modules/auth/auth.types";

describe("Gerenciamento de leilões HTTP (persistência em memória)", () => {
  const auctions = new Map<string, Auction>();
  const users = new Map<string, PublicUser>();
  const blocked = new Set<string>();
  const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const bidderId = randomUUID();
  const auctionId = randomUUID();
  const future = () => new Date(Date.now() + 86400000 * 10);
  const later = () => new Date(Date.now() + 86400000 * 11);
  let server: Server;
  let base: string;
  let fail = false;
  let changeBeforeMutation: AuctionStatus | undefined;

  const repository: AuctionRepository = {
    async create(input, organizerId) {
      if (fail) throw new Error("Falha simulada");
      const auction: Auction = { ...input, organizerId, ...{ temporalGeneration: "UTC_V2" }, id: randomUUID(), status: "DRAFT", createdAt: new Date(), updatedAt: new Date() };
      auctions.set(auction.id, auction);
      return auction;
    },
    async list(query) {
      if (fail) throw new Error("Falha simulada");
      const rows = [...auctions.values()]
        .filter(a => !query.status || a.status === query.status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
      return { auctions: rows.slice((query.page - 1) * query.limit, query.page * query.limit), total: rows.length };
    },
    async findById(id) {
      if (fail) throw new Error("Falha simulada");
      return auctions.get(id) ?? null;
    },
    async mutate(id, decide) {
      if (fail) throw new Error("Falha simulada");
      const auction = auctions.get(id);
      if (!auction) throw new HttpError(404, "Leilão não encontrado.");
      if (changeBeforeMutation) auction.status = changeBeforeMutation;
      const patch = decide({ auction, hasIncompatibleOperations: blocked.has(id) });
      const updated = { ...auction, ...patch, updatedAt: new Date() };
      auctions.set(id, updated);
      return updated;
    },
  };
  const authenticationRepository: AuthRepository = {
    async findPublicById(id) { return users.get(id) ?? null; },
    async findByEmail() { throw new Error("Não utilizado"); },
    async createBidder() { throw new Error("Não utilizado"); },
  };

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/auctions", createAuctionRouter(repository, createAuthenticate(authenticationRepository, () => config)));
    app.use(notFound);
    app.use(errorHandler);
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
      server.once("error", reject);
    });
    const address = server.address();
    assert(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}/api/auctions`;
  });
  beforeEach(() => {
    auctions.clear();
    users.clear();
    blocked.clear();
    fail = false;
    changeBeforeMutation = undefined;
    for (const [id, role] of [[ownerId, "AUCTIONEER"], [otherId, "AUCTIONEER"], [bidderId, "BIDDER"]] as const) {
      users.set(id, { id, role, name: "Pessoa privada", email: `${id}@example.com`, createdAt: new Date() });
    }
    auctions.set(auctionId, { id: auctionId, organizerId: ownerId, ...{ temporalGeneration: "UTC_V2" }, title: "Leilão inicial", description: null, startsAt: future(), endsAt: later(), status: "DRAFT", createdAt: new Date(), updatedAt: new Date() });
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const payload = () => ({ title: "  Leilão de veículos  ", description: "Descrição pública", startsAt: future().toISOString(), endsAt: later().toISOString() });
  async function request(method: string, path = "", body?: unknown, userId?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (userId) headers.Authorization = `Bearer ${signAccessToken(userId, config)}`;
    return fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  it("cria DRAFT associado ao leiloeiro autenticado sem expor organizador", async () => {
    const response = await request("POST", "", payload(), ownerId);
    assert.equal(response.status, 201);
    const { auction } = await response.json();
    assert.equal(auction.status, "DRAFT");
    assert.equal(auction.title, "Leilão de veículos");
    assert.equal(auctions.get(auction.id)?.organizerId, ownerId);
    assert.deepEqual(Object.keys(auction).sort(), ["createdAt", "description", "endsAt", "id", "startsAt", "status", "title", "updatedAt"]);
  });

  it("aceita descrição omitida ou null e datas com offset", async () => {
    const data = { title: "Leilão", startsAt: "2099-11-01T09:00:00-03:00", endsAt: "2099-11-01T12:00:00-03:00" };
    const response = await request("POST", "", data, ownerId);
    assert.equal(response.status, 201);
    const { auction } = await response.json();
    assert.equal(auction.description, null);
    assert.equal(auction.startsAt, "2099-11-01T12:00:00.000Z");
  });

  it("exige autenticação e perfil AUCTIONEER em todas as escritas", async () => {
    for (const [method, path, body] of [["POST", "", payload()], ["PATCH", `/${auctionId}`, { title: "Novo" }], ["PATCH", `/${auctionId}/cancel`, {}]] as const) {
      assert.equal((await request(method, path, body)).status, 401);
      assert.equal((await request(method, path, body, bidderId)).status, 403);
    }
  });

  it("rejeita token inválido nas escritas", async () => {
    const response = await fetch(base, { method: "POST", headers: { Authorization: "Bearer invalido", "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
    assert.equal(response.status, 401);
  });

  it("consulta novamente o perfil em cada requisição", async () => {
    users.get(ownerId)!.role = "BIDDER";
    assert.equal((await request("POST", "", payload(), ownerId)).status, 403);
  });

  it("valida cadastro, campos protegidos, datas reais e período", async () => {
    const data = payload();
    for (const invalid of [null, [], {}, { ...data, title: " " }, { ...data, title: "x".repeat(151) }, { ...data, description: 1 }, { ...data, description: "x".repeat(10001) }, { ...data, organizerId: otherId }, { ...data, status: "OPEN" }, { ...data, startsAt: "2099-02-30T12:00:00Z" }, { ...data, startsAt: "2099-01-01" }, { ...data, startsAt: "2099-01-01T12:00:00" }, { ...data, startsAt: 123 }, { ...data, endsAt: data.startsAt }, { ...data, startsAt: data.endsAt, endsAt: data.startsAt }]) {
      assert.equal((await request("POST", "", invalid, ownerId)).status, 400);
    }
    assert.equal(auctions.size, 1);
  });

  it("lista publicamente, pagina com ordenação estável e filtra status", async () => {
    const first = auctions.get(auctionId)!;
    const secondId = randomUUID();
    auctions.set(secondId, { ...first, id: secondId, status: "SCHEDULED", createdAt: new Date(first.createdAt.getTime() + 1000) });
    const page1 = await request("GET", "?page=1&limit=1");
    assert.equal(page1.status, 200);
    const firstBody = await page1.json();
    assert.equal(firstBody.data[0].id, secondId);
    assert.deepEqual(firstBody.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
    assert.equal(firstBody.data[0].organizerId, undefined);
    assert.equal(firstBody.data[0].organizer, undefined);
    const secondBody = await (await request("GET", "?page=2&limit=1")).json();
    assert.equal(secondBody.data[0].id, auctionId);
    const filtered = await (await request("GET", "?status=DRAFT")).json();
    assert.equal(filtered.data.length, 1);
    assert.equal(filtered.data[0].id, auctionId);
    const empty = await (await request("GET", "?status=CLOSED")).json();
    assert.equal(empty.data.length, 0);
    assert.equal(empty.pagination.totalPages, 0);
    assert.equal((await (await request("GET", "?page=5&limit=1")).json()).data.length, 0);
  });

  it("rejeita paginação, filtros inválidos e parâmetros duplicados", async () => {
    for (const query of ["?page=0", "?page=-1", "?page=1.5", "?page=1000001", "?limit=101", "?limit=0", "?limit=abc", "?status=INVALID", "?status=draft", "?status=DRAFT&status=OPEN", "?page=1&page=2", "?organizerId=indevido"]) {
      assert.equal((await request("GET", query)).status, 400);
    }
  });

  it("consulta detalhe público sem dados pessoais", async () => {
    const response = await request("GET", `/${auctionId}`);
    assert.equal(response.status, 200);
    const { auction } = await response.json();
    assert.equal(auction.id, auctionId);
    assert.equal(auction.status, "DRAFT");
    assert.equal(auction.organizer, undefined);
    assert.equal(auction.organizerId, undefined);
    assert.equal(auction.email, undefined);
  });

  it("trata UUID inválido e leilão inexistente em consulta, edição e cancelamento", async () => {
    for (const [method, suffix, body] of [["GET", "", undefined], ["PATCH", "", { title: "Título" }], ["PATCH", "/cancel", {}]] as const) {
      assert.equal((await request(method, `/invalido${suffix}`, body, ownerId)).status, 400);
      assert.equal((await request(method, `/${randomUUID()}${suffix}`, body, ownerId)).status, 404);
    }
  });

  it("edita campos permitidos do DRAFT preservando responsável e status", async () => {
    const response = await request("PATCH", `/${auctionId}`, { title: "Título atualizado", description: "Descrição" }, ownerId);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).auction.title, "Título atualizado");
    const saved = auctions.get(auctionId)!;
    assert.equal(saved.organizerId, ownerId);
    assert.equal(saved.status, "DRAFT");
    assert.equal((await request("PATCH", `/${auctionId}`, { description: null }, ownerId)).status, 200);
    assert.equal(auctions.get(auctionId)?.description, null);
  });

  it("proíbe edição e cancelamento por outro leiloeiro", async () => {
    assert.equal((await request("PATCH", `/${auctionId}`, { title: "Indevido" }, otherId)).status, 403);
    assert.equal((await request("PATCH", `/${auctionId}/cancel`, {}, otherId)).status, 403);
    assert.equal(auctions.get(auctionId)?.title, "Leilão inicial");
    assert.equal(auctions.get(auctionId)?.status, "DRAFT");
  });

  it("rejeita patch vazio, campos protegidos e datas incompatíveis com valor persistido", async () => {
    const stored = auctions.get(auctionId)!;
    for (const patch of [{}, { status: "OPEN" }, { organizerId: otherId }, { id: randomUUID() }, { startsAt: stored.endsAt.toISOString() }, { endsAt: stored.startsAt.toISOString() }, { startsAt: "2000-01-01T12:00:00Z" }]) {
      assert.equal((await request("PATCH", `/${auctionId}`, patch, ownerId)).status, 400);
    }
    assert.equal(auctions.get(auctionId)?.status, "DRAFT");
  });

  it("atualiza as duas datas conjuntamente e valida o período resultante", async () => {
    const startsAt = new Date(Date.now() + 86400000 * 20).toISOString();
    const endsAt = new Date(Date.now() + 86400000 * 21).toISOString();
    assert.equal((await request("PATCH", `/${auctionId}`, { startsAt, endsAt }, ownerId)).status, 200);
    assert.equal(auctions.get(auctionId)?.startsAt.toISOString(), startsAt);
  });

  it("bloqueia edição fora de DRAFT ou após horário de início", async () => {
    for (const status of ["SCHEDULED", "OPEN", "CLOSED", "CANCELLED"] as const) {
      auctions.get(auctionId)!.status = status;
      assert.equal((await request("PATCH", `/${auctionId}`, { title: "Novo" }, ownerId)).status, 409);
    }
    auctions.get(auctionId)!.status = "DRAFT";
    auctions.get(auctionId)!.startsAt = new Date(Date.now() - 1000);
    assert.equal((await request("PATCH", `/${auctionId}`, { title: "Novo" }, ownerId)).status, 409);
  });
  it("não permite reagendar um rascunho cujo início original já passou", async () => {
    const original = auctions.get(auctionId)!;
    original.startsAt = new Date(Date.now() - 1000);
    const previousStart = original.startsAt.toISOString(), previousEnd = original.endsAt.toISOString();
    const response = await request("PATCH", `/${auctionId}`, {
      startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 172800000).toISOString(),
    }, ownerId);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { message: "Somente leilões em DRAFT e ainda não iniciados podem ser editados." });
    assert.equal(original.startsAt.toISOString(), previousStart);
    assert.equal(original.endsAt.toISOString(), previousEnd);
  });

  it("usa o estado recebido dentro da mutação, sem leitura obsoleta", async () => {
    changeBeforeMutation = "OPEN";
    assert.equal((await request("PATCH", `/${auctionId}`, { title: "Indevido" }, ownerId)).status, 409);
    assert.equal((await request("PATCH", `/${auctionId}/cancel`, {}, ownerId)).status, 409);
    assert.equal(auctions.get(auctionId)?.title, "Leilão inicial");
  });

  it("cancela DRAFT ou SCHEDULED sem excluir fisicamente", async () => {
    for (const status of ["DRAFT", "SCHEDULED"] as const) {
      auctions.get(auctionId)!.status = status;
      const response = await request("PATCH", `/${auctionId}/cancel`, undefined, ownerId);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).auction.status, "CANCELLED");
      assert.equal(auctions.size, 1);
      assert.equal((await request("GET", `/${auctionId}`)).status, 200);
    }
  });

  it("bloqueia cancelamento com operações incompatíveis", async () => {
    blocked.add(auctionId);
    assert.equal((await request("PATCH", `/${auctionId}/cancel`, {}, ownerId)).status, 409);
    assert.equal(auctions.get(auctionId)?.status, "DRAFT");
  });

  it("bloqueia cancelamento de OPEN, CLOSED, CANCELLED ou com início atingido", async () => {
    for (const status of ["OPEN", "CLOSED", "CANCELLED"] as const) {
      auctions.get(auctionId)!.status = status;
      assert.equal((await request("PATCH", `/${auctionId}/cancel`, {}, ownerId)).status, 409);
    }
    for (const status of ["DRAFT", "SCHEDULED"] as const) {
      auctions.get(auctionId)!.status = status;
      auctions.get(auctionId)!.startsAt = new Date(Date.now() - 1000);
      assert.equal((await request("PATCH", `/${auctionId}/cancel`, {}, ownerId)).status, 409);
    }
  });

  it("rejeita dados na ação de cancelamento", async () => {
    for (const body of [{ status: "CANCELLED" }, { organizerId: ownerId }, [], null]) {
      assert.equal((await request("PATCH", `/${auctionId}/cancel`, body, ownerId)).status, 400);
    }
  });

  it("mantém erros internos genéricos", async () => {
    fail = true;
    const response = await request("GET");
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: "Erro interno do servidor." });
  });
});
