import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { Prisma, type Wallet, type WalletTransaction } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { errorHandler } from "../src/middlewares/error-handler";
import { getSimulatedCreditDiagnostics, requireSimulatedCreditEnvironment, requireSimulatedCreditAuthorization } from "../src/config/wallet";
import { createWalletRouter } from "../src/modules/wallet/wallet.routes";
import type { WalletRepository } from "../src/modules/wallet/wallet.types";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository, PublicUser } from "../src/modules/auth/auth.types";

describe("Carteira HTTP (JWT real e persistência em memória)", () => {
  const wallets = new Map<string, Wallet>(), transactions = new Map<string, WalletTransaction>();
  const reserved = new Map<string, Prisma.Decimal>(), users = new Map<string, PublicUser>();
  const bidder = randomUUID(), other = randomUUID(), auctioneer = randomUUID();
  const config = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  let server: Server, base: string, env: NodeJS.ProcessEnv, fail = false;
  function own(userId: string) {
    let wallet = wallets.get(userId);
    if (!wallet) { wallet = { id: randomUUID(), userId, balance: new Prisma.Decimal(0), version: 0, createdAt: new Date(), updatedAt: new Date() }; wallets.set(userId, wallet); }
    return wallet;
  }
  const snapshot = (wallet: Wallet) => ({ wallet, reserved: reserved.get(wallet.userId) ?? new Prisma.Decimal(0) });
  const repository: WalletRepository = {
    async get(userId) { if (fail) throw new Error("Privado"); return snapshot(own(userId)); },
    async credit(userId, amount, key) {
      if (fail) throw new Error("Privado");
      const wallet = own(userId), idempotencyKey = `demo-credit:${userId}:${key}`;
      const previous = transactions.get(idempotencyKey);
      if (previous) {
        if (!previous.amount.equals(amount)) throw new HttpError(409, "Chave reutilizada com outro valor.");
        return { ...snapshot(wallet), transaction: previous, replayed: true };
      }
      const balance = wallet.balance.plus(amount);
      if (balance.greaterThan("9999999999999999.99")) throw new HttpError(409, "Limite de saldo.");
      wallet.balance = balance; wallet.version++;
      const transaction: WalletTransaction = { id: randomUUID(), walletId: wallet.id, reservationId: null, type: "CREDIT", amount, balanceAfter: balance, idempotencyKey, createdAt: new Date() };
      transactions.set(idempotencyKey, transaction);
      return { ...snapshot(wallet), transaction, replayed: false };
    },
    async transactions(userId, q) {
      const wallet = own(userId);
      const all = [...transactions.values()].filter(t => t.walletId === wallet.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
      return { transactions: all.slice((q.page - 1) * q.limit, q.page * q.limit), total: all.length };
    },
  };
  const auth: AuthRepository = {
    async findPublicById(id) { return users.get(id) ?? null; },
    async findByEmail() { throw new Error("Não utilizado"); }, async createBidder() { throw new Error("Não utilizado"); },
  };
  const demoEnv = (): NodeJS.ProcessEnv => ({ NODE_ENV: "development", ENABLE_SIMULATED_CREDITS: "true", DATABASE_URL: "postgresql://fixture:unused@localhost:5432/sistema_leiloes" });
  before(async () => {
    const app = express(); app.use(express.json());
    app.use("/api/wallet", createWalletRouter(repository, createAuthenticate(auth, () => config), userId => requireSimulatedCreditAuthorization(userId, env)));
    app.use(errorHandler);
    await new Promise<void>((resolve, reject) => { server = app.listen(0, "127.0.0.1", (e?: Error) => e ? reject(e) : resolve()); server.once("error", reject); });
    const address = server.address(); assert(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}/api/wallet`;
  });
  beforeEach(() => {
    wallets.clear(); transactions.clear(); users.clear(); reserved.clear(); fail = false; env = demoEnv();
    for (const id of [bidder, other, auctioneer]) users.set(id, { id, name: "Privado", email: "private@example.com", role: id === auctioneer ? "AUCTIONEER" : "BIDDER", createdAt: new Date() });
  });
  after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
  async function request(method: string, path = "", body?: unknown, userId: string | undefined = bidder, key?: string) {
    const headers: Record<string, string> = {};
    if (userId) headers.Authorization = `Bearer ${signAccessToken(userId, config)}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (key !== undefined) headers["Idempotency-Key"] = key;
    return fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const credit = (amount = "10.00", key = "test-1", userId = bidder) => request("POST", "/credit", { amount }, userId, key);
  it("cria carteira automaticamente uma única vez, com saldos zero", async () => {
    for (let i = 0; i < 2; i++) {
      const res = await request("GET"); assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { wallet: { totalBalance: "0.00", reservedBalance: "0.00", availableBalance: "0.00" } });
    }
    assert.equal(wallets.size, 1);
  });
  it("calcula disponível com Decimal e desconta somente o reservado informado pelo repositório", async () => {
    own(bidder).balance = new Prisma.Decimal("100.10"); reserved.set(bidder, new Prisma.Decimal("30.03"));
    assert.deepEqual((await (await request("GET")).json()).wallet, { totalBalance: "100.10", reservedBalance: "30.03", availableBalance: "70.07" });
  });
  it("exige JWT e BIDDER em todos os endpoints", async () => {
    for (const [method, path, body] of [["GET", "", undefined], ["GET", "/credit-capability", undefined], ["GET", "/transactions", undefined], ["POST", "/credit", { amount: "10.00" }]] as const) {
      assert.equal((await request(method, path, body, "")).status, 401);
      assert.equal((await request(method, path, body, auctioneer)).status, 403);
    }
    assert.equal(wallets.size, 0);
  });
  it("autoriza somente o BIDDER listado para demonstração em produção e não cria carteira ao consultar permissão", async () => {
    env = { NODE_ENV: "production", ENABLE_PRODUCTION_DEMO_CREDITS: "true", PRODUCTION_DEMO_CREDIT_USER_IDS: `${bidder},${auctioneer}`, PRODUCTION_DEMO_CREDIT_LIMIT: "1000.00" };
    const capability = await request("GET", "/credit-capability");
    assert.equal(capability.headers.get("cache-control"), "no-store");
    assert.deepEqual(await capability.json(), { enabled: true, cumulativeLimit: "1000.00" });
    assert.deepEqual(await (await request("GET", "/credit-capability", undefined, other)).json(), { enabled: false, cumulativeLimit: null });
    assert.equal(wallets.size, 0);
    assert.equal((await request("GET", "/credit-capability", undefined, auctioneer)).status, 403);
    assert.equal((await credit("10.00", "denied", auctioneer)).status, 403);
    assert.equal((await credit("10.00", "denied", other)).status, 403);
    assert.equal((await credit()).status, 201);
    assert.equal((await credit()).status, 200);
    env.ENABLE_PRODUCTION_DEMO_CREDITS = "false";
    assert.equal((await credit()).status, 403);
    assert.equal(transactions.size, 1);
  });
  it("revalida perfil e usuário do token", async () => {
    users.get(bidder)!.role = "AUCTIONEER"; assert.equal((await request("GET")).status, 403);
    users.delete(bidder); assert.equal((await request("GET")).status, 401);
    assert.equal((await fetch(base, { headers: { Authorization: "Bearer inválido" } })).status, 401);
  });
  it("credita valor simulado, registra movimento e devolve apenas dados próprios", async () => {
    const res = await credit(); assert.equal(res.status, 201); const body = await res.json();
    assert.equal(body.simulated, true); assert.equal(body.replayed, false); assert.match(body.message, /simulado/);
    assert.equal(body.wallet.totalBalance, "10.00"); assert.equal(body.transaction.amount, "10.00"); assert.equal(body.transaction.type, "CREDIT");
    assert.equal(body.transaction.walletId, undefined); assert.equal(body.transaction.idempotencyKey, undefined); assert.equal(body.transaction.simulated, true);
    assert.equal(transactions.size, 1);
  });
  it("aceita frações sem arredondamento e formatos decimais equivalentes no reenvio", async () => {
    await credit("0.1", "a"); await credit("0.2", "b");
    const res = await credit("0.10", "a"); assert.equal(res.status, 200); assert.equal((await res.json()).wallet.totalBalance, "0.30");
  });
  for (const value of [undefined, null, 10, 0, -1, "0", "0.00", "-1", "1.001", "10000000000000000", "1e3", "1,00", "NaN", "Infinity", " 1.00", "01.00", ""]) {
    it(`rejeita amount inválido ${JSON.stringify(value)}`, async () => {
      assert.equal((await request("POST", "/credit", { amount: value }, bidder, "bad")).status, 400); assert.equal(wallets.size, 0);
    });
  }
  it("rejeita campos extras, saldo e identificadores financeiros", async () => {
    for (const key of ["walletId", "userId", "balance", "balanceAfter", "idempotencyKey", "type", "simulated", "unknown"]) assert.equal((await request("POST", "/credit", { amount: "10.00", [key]: "forjado" }, bidder, "key")).status, 400);
    for (const body of [null, [], {}]) assert.equal((await request("POST", "/credit", body, bidder, "key")).status, 400);
    assert.equal(wallets.size, 0);
  });
  it("exige chave e valida formato/tamanho antes de persistir", async () => {
    for (const key of [undefined, "", "a".repeat(65), "com espaço", "a,b", "ação"]) assert.equal((await request("POST", "/credit", { amount: "1" }, bidder, key)).status, 400);
    assert.equal(wallets.size, 0);
  });
  it("reenvio da chave retorna mesma transação sem crédito duplicado", async () => {
    const first = await (await credit()).json(); const res = await credit(); assert.equal(res.status, 200);
    const second = await res.json(); assert.equal(second.transaction.id, first.transaction.id); assert.equal(second.replayed, true);
    assert.equal(second.wallet.totalBalance, "10.00"); assert.equal(transactions.size, 1); assert.equal(own(bidder).version, 1);
  });
  it("mesma chave com outro valor retorna 409 sem alterar saldo", async () => {
    await credit(); assert.equal((await credit("11.00")).status, 409); assert.equal(own(bidder).balance.toFixed(2), "10.00"); assert.equal(transactions.size, 1);
  });
  it("reenvio após outro crédito mantém transação original e saldo atual", async () => {
    const first = await (await credit("10", "a")).json(); await credit("20", "b");
    const replay = await (await credit("10", "a")).json(); assert.equal(replay.wallet.totalBalance, "30.00"); assert.equal(replay.transaction.balanceAfter, "10.00"); assert.equal(replay.transaction.id, first.transaction.id);
  });
  it("isola saldos, histórico e namespace de chave entre usuários", async () => {
    await credit("10", "same", bidder); await credit("20", "same", other);
    assert.equal((await (await request("GET")).json()).wallet.totalBalance, "10.00");
    assert.equal((await (await request("GET", "", undefined, other)).json()).wallet.totalBalance, "20.00");
    const history = await (await request("GET", "/transactions")).json(); assert.equal(history.data.length, 1); assert.equal(history.data[0].amount, "10.00");
    assert.equal((await request("GET", `?userId=${other}`)).status, 400);
    assert.equal((await request("GET", `/transactions?walletId=${own(other).id}`)).status, 400);
  });
  it("histórico cria carteira vazia e implementa paginação estável", async () => {
    const empty = await (await request("GET", "/transactions")).json(); assert.equal(empty.pagination.total, 0); assert.equal(wallets.size, 1);
    await credit("1", "a"); await credit("2", "b"); await credit("3", "c");
    const all = [...transactions.values()]; all.forEach((t, i) => t.createdAt = new Date(1000 * i));
    const first = await (await request("GET", "/transactions?page=1&limit=1")).json();
    assert.deepEqual(first.pagination, { page: 1, limit: 1, total: 3, totalPages: 3 }); assert.equal(first.data[0].amount, "3.00");
    const second = await (await request("GET", "/transactions?page=2&limit=1")).json(); assert.equal(second.data[0].amount, "2.00");
    assert.deepEqual((await (await request("GET", "/transactions?page=100")).json()).data, []);
  });
  it("valida paginação e não aceita query no crédito", async () => {
    for (const q of ["page=0", "page=1.5", "page=1000001", "limit=101", "limit=x", "page=1&page=2", "userId=x"]) assert.equal((await request("GET", `/transactions?${q}`)).status, 400);
    assert.equal((await request("POST", "/credit?userId=x", { amount: "1" }, bidder, "key")).status, 400);
  });
  it("impede overflow sem atualizar saldo ou lançar movimento", async () => {
    assert.equal((await credit("9999999999999999.99", "max")).status, 201);
    assert.equal((await credit("0.01", "overflow")).status, 409); assert.equal(transactions.size, 1);
  });
  for (const mode of [undefined, "", "production", "test", "staging", "Development"]) it(`bloqueia crédito em NODE_ENV=${mode}`, async () => {
    env.NODE_ENV = mode; assert.equal((await credit()).status, 403); assert.equal(wallets.size, 0);
    assert.equal((await request("GET")).status, 200);
  });
  it("produção continua bloqueada com flag habilitada e banco local", async () => {
    env.NODE_ENV = "production"; assert.equal((await credit()).status, 403); assert.equal(transactions.size, 0);
  });
  it("flag ausente ou não exata mantém crédito desabilitado", async () => {
    for (const flag of [undefined, "false", "1", "TRUE", " true "]) { env.ENABLE_SIMULATED_CREDITS = flag; assert.equal((await credit()).status, 403); }
    assert.equal(wallets.size, 0);
  });
  it("bloqueia banco remoto, outro banco e overrides de host", async () => {
    for (const url of [undefined, "invalid", "postgresql://fixture:unused@remote.example/sistema_leiloes", "postgresql://fixture:unused@localhost/production", "postgresql://fixture:unused@localhost/sistema_leiloes?host=remote", "postgresql://fixture:unused@localhost/sistema_leiloes?hostaddr=1.2.3.4", "mysql://localhost/sistema_leiloes"]) { env.DATABASE_URL = url; assert.equal((await credit()).status, 403); }
    assert.equal(wallets.size, 0);
  });
  it("aceita os endereços loopback explicitamente permitidos", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) assert.doesNotThrow(() => requireSimulatedCreditEnvironment({ ...demoEnv(), DATABASE_URL: `postgresql://fixture:unused@${host}/sistema_leiloes` }));
  });
  it("aceita somente schema=public opcional sem liberar overrides de conexão", async () => {
    env.DATABASE_URL = `${demoEnv().DATABASE_URL}?schema=public`;
    assert.equal((await credit()).status, 201);
    for (const suffix of ["?schema=private", "?schema=", "?schema=public&schema=public", "?schema=public&host=remote", "?schema=public&hostaddr=1.2.3.4", "?schema=public&options=anything", "?schema=public&sslmode=disable", "?schema=public#fragment"]) {
      env.DATABASE_URL = `${demoEnv().DATABASE_URL}${suffix}`;
      assert.equal((await credit("1", "blocked")).status, 403);
    }
    assert.equal(transactions.size, 1);
  });
  it("schema=public não libera produção, flag ausente, host remoto ou outro banco", () => {
    const base = { ...demoEnv(), DATABASE_URL: `${demoEnv().DATABASE_URL}?schema=public` };
    for (const change of [
      { NODE_ENV: "production" }, { ENABLE_SIMULATED_CREDITS: undefined },
      { DATABASE_URL: "postgresql://fixture:unused@remote.example/sistema_leiloes?schema=public" },
      { DATABASE_URL: "postgresql://fixture:unused@localhost/production?schema=public" },
    ]) assert.throws(() => requireSimulatedCreditEnvironment({ ...base, ...change }), (e: unknown) => e instanceof HttpError && e.status === 403);
  });
  it("diagnóstico revela somente condições booleanas e identifica o bloqueio específico", () => {
    const conditions = getSimulatedCreditDiagnostics({ ...demoEnv(), DATABASE_URL: `${demoEnv().DATABASE_URL}?host=remote` });
    assert.equal(conditions.developmentEnvironment, true);
    assert.equal(conditions.explicitlyEnabled, true);
    assert.equal(conditions.localDatabaseHost, true);
    assert.equal(conditions.demoDatabaseName, true);
    assert.equal(conditions.allowedDatabaseParameters, false);
    assert.equal(conditions.enabled, false);
    assert(Object.values(conditions).every(value => typeof value === "boolean"));
    assert(!JSON.stringify(conditions).includes("fixture"));
    assert(!JSON.stringify(conditions).includes("unused"));
    assert.equal(getSimulatedCreditDiagnostics({ ...demoEnv(), DATABASE_URL: `${demoEnv().DATABASE_URL}?schema=public` }).enabled, true);
    assert.equal(getSimulatedCreditDiagnostics({ ...demoEnv(), DATABASE_URL: "invalid" }).validDatabaseUrl, false);
  });
  it("mantém falha interna genérica", async () => {
    fail = true; const res = await credit(); assert.equal(res.status, 500); assert.deepEqual(await res.json(), { message: "Erro interno do servidor." });
  });
});
