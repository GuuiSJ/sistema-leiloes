import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getAuthConfig, type AuthConfig } from "../src/config/auth";
import { HttpError } from "../src/errors/http-error";
import { createAuthenticate } from "../src/middlewares/authenticate";
import { authorize } from "../src/middlewares/authorize";
import { errorHandler } from "../src/middlewares/error-handler";
import { createAuthRouter } from "../src/modules/auth/auth.routes";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import type { AuthRepository, LoginUser, PublicUser } from "../src/modules/auth/auth.types";
import productionApp from "../src/app";

function publicUser(user: LoginUser): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
}

describe("Autenticação HTTP (repositório em memória, bcrypt e JWT reais)", () => {
  const users = new Map<string, LoginUser>();
  const config: AuthConfig = { secret: randomBytes(48).toString("hex"), expiresInSeconds: 3600 };
  const password = "SenhaTeste!2026";
  const userId = randomUUID();
  let passwordHash: string;
  let server: Server;
  let base: string;
  let failDatabase = false;
  let simulatedRace = false;

  const repository: AuthRepository = {
    async findByEmail(email) {
      if (failDatabase) throw new Error("Falha interna simulada");
      return [...users.values()].find((user) => user.email === email) ?? null;
    },
    async findPublicById(id) {
      if (failDatabase) throw new Error("Falha interna simulada");
      const user = users.get(id);
      return user ? publicUser(user) : null;
    },
    async createBidder(input) {
      if (simulatedRace || [...users.values()].some((user) => user.email === input.email)) {
        throw new HttpError(409, "E-mail já cadastrado.");
      }
      const user = { ...input, id: randomUUID(), createdAt: new Date() };
      users.set(user.id, user);
      return publicUser(user);
    },
  };

  before(async () => {
    passwordHash = await bcrypt.hash(password, 12);
    const app = express();
    app.use(express.json());
    app.use("/api/auth", createAuthRouter(repository, () => config));
    app.get("/test/auctioneer", createAuthenticate(repository, () => config), authorize("AUCTIONEER"), (_req, res) => res.sendStatus(204));
    app.get("/test/no-auth", authorize("BIDDER"), (_req, res) => res.sendStatus(204));
    // Mantém a rota de saúde real, sem acessar o banco nos testes.
    app.use(productionApp);
    app.use(errorHandler);
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
      server.once("error", reject);
    });
    const address = server.address();
    assert(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    users.clear();
    failDatabase = false;
    simulatedRace = false;
    users.set(userId, { id: userId, name: "Usuário Teste", email: "teste@example.com", passwordHash, role: "BIDDER", createdAt: new Date() });
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  async function post(path: string, body: unknown) {
    return fetch(`${base}/api/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  async function me(token?: string) {
    return fetch(`${base}/api/auth/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  }

  it("cadastra BIDDER, normaliza e-mail e nome, grava bcrypt e não retorna hash", async () => {
    const response = await post("register", { name: "  Nova Pessoa  ", email: "  NOVA@EXAMPLE.COM ", password, role: "BIDDER" });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(Object.keys(body.user).sort(), ["createdAt", "email", "id", "name", "role"]);
    assert.equal(body.user.email, "nova@example.com");
    assert.equal(body.user.name, "Nova Pessoa");
    assert.equal(body.user.role, "BIDDER");
    const saved = users.get(body.user.id);
    assert(saved);
    assert(saved.passwordHash !== password);
    assert.equal(bcrypt.getRounds(saved.passwordHash), 12);
    assert(await bcrypt.compare(password, saved.passwordHash));
  });

  it("rejeita e-mail duplicado após normalização", async () => {
    const response = await post("register", { name: "Pessoa Teste", email: " TESTE@EXAMPLE.COM ", password, role: "BIDDER" });
    assert.equal(response.status, 409);
    assert.equal(users.size, 1);
  });

  it("preserva conflito de unicidade recebido após a consulta inicial", async () => {
    simulatedRace = true;
    const response = await post("register", { name: "Pessoa Teste", email: "race@example.com", password, role: "BIDDER" });
    assert.equal(response.status, 409);
  });

  it("rejeita dados inválidos, campos extras e corpos ausentes", async () => {
    const valid = { name: "Pessoa Teste", email: "nova@example.com", password, role: "BIDDER" };
    for (const input of [null, [], {}, { ...valid, name: "A" }, { ...valid, name: "A".repeat(121) }, { ...valid, email: "invalido" }, { ...valid, email: 123 }, { ...valid, password: "curta" }, { ...valid, role: "ADMIN" }, { ...valid, role: undefined }, { ...valid, passwordHash: "indevido" }]) {
      assert.equal((await post("register", input)).status, 400);
    }
    assert.equal(users.size, 1);
  });

  it("rejeita senhas com mais de 72 bytes ou byte nulo", async () => {
    for (const invalid of ["a".repeat(73), "á".repeat(37), "Senha\0Teste2026"]) {
      const response = await post("register", { name: "Pessoa Teste", email: "nova@example.com", password: invalid, role: "BIDDER" });
      assert.equal(response.status, 400);
    }
  });

  it("bloqueia cadastro público como AUCTIONEER", async () => {
    const response = await post("register", { name: "Leiloeiro Teste", email: "leiloeiro@example.com", password, role: "AUCTIONEER" });
    assert.equal(response.status, 403);
    assert.equal(users.size, 1);
  });

  it("faz login com e-mail normalizado e JWT com expiração configurada", async () => {
    const response = await post("login", { email: " TESTE@EXAMPLE.COM ", password });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.tokenType, "Bearer");
    assert.equal(body.expiresIn, 3600);
    assert.deepEqual(Object.keys(body.user).sort(), ["createdAt", "email", "id", "name", "role"]);
    const payload = jwt.verify(body.accessToken, config.secret, { algorithms: ["HS256"], issuer: "sistema-leiloes", audience: "sistema-leiloes:api" });
    assert(typeof payload !== "string");
    assert.equal(payload.sub, userId);
    assert.equal(payload.exp! - payload.iat!, config.expiresInSeconds);
    assert.equal(payload.role, undefined);
    assert.equal(payload.email, undefined);
    assert.equal(payload.passwordHash, undefined);
    assert.equal((await me(body.accessToken)).status, 200);
  });

  it("retorna o mesmo erro para senha incorreta e usuário inexistente", async () => {
    const wrong = await post("login", { email: "teste@example.com", password: "SenhaIncorreta" });
    const missing = await post("login", { email: "ausente@example.com", password });
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.deepEqual(await wrong.json(), await missing.json());
  });

  it("valida os dados de login", async () => {
    for (const body of [{}, { email: "invalido", password }, { email: "teste@example.com", password: 1 }, { email: "teste@example.com", password: "a".repeat(73) }]) {
      assert.equal((await post("login", body)).status, 400);
    }
  });

  it("retorna somente os campos permitidos em /me", async () => {
    const response = await me(signAccessToken(userId, config));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body.user).sort(), ["createdAt", "email", "id", "name", "role"]);
    assert.equal(body.user.id, userId);
  });

  it("rejeita token ausente, inválido, assinatura incorreta e cabeçalho malformado", async () => {
    assert.equal((await me()).status, 401);
    assert.equal((await me("invalido")).status, 401);
    assert.equal((await me(signAccessToken(userId, { ...config, secret: randomBytes(48).toString("hex") }))).status, 401);
    const response = await fetch(`${base}/api/auth/me`, { headers: { Authorization: "Basic indevido" } });
    assert.equal(response.status, 401);
  });

  it("rejeita tokens expirados, sem expiração, de outro emissor ou algoritmo", async () => {
    const baseOptions = { subject: userId, issuer: "sistema-leiloes", audience: "sistema-leiloes:api" };
    const tokens = [
      jwt.sign({}, config.secret, { ...baseOptions, expiresIn: -1 }),
      jwt.sign({}, config.secret, baseOptions),
      jwt.sign({}, config.secret, { ...baseOptions, issuer: "outro", expiresIn: 60 }),
      jwt.sign({}, config.secret, { ...baseOptions, algorithm: "HS384", expiresIn: 60 }),
      jwt.sign({}, config.secret, { ...baseOptions, subject: "nao-e-uuid", expiresIn: 60 }),
    ];
    for (const token of tokens) assert.equal((await me(token)).status, 401);
  });

  it("nega acesso quando o usuário do token não existe mais", async () => {
    assert.equal((await me(signAccessToken(randomUUID(), config))).status, 401);
  });

  it("autoriza pelo perfil atual do repositório e ignora o perfil do JWT", async () => {
    const forgedRole = jwt.sign({ role: "AUCTIONEER" }, config.secret, { subject: userId, issuer: "sistema-leiloes", audience: "sistema-leiloes:api", expiresIn: 60 });
    const headers = { Authorization: `Bearer ${forgedRole}` };
    assert.equal((await fetch(`${base}/test/auctioneer`, { headers })).status, 403);
    users.get(userId)!.role = "AUCTIONEER";
    assert.equal((await fetch(`${base}/test/auctioneer`, { headers })).status, 204);
    users.get(userId)!.role = "BIDDER";
    assert.equal((await fetch(`${base}/test/auctioneer`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/test/no-auth`)).status, 401);
  });

  it("mantém tratamento centralizado para JSON inválido", async () => {
    const response = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalid" });
    assert.equal(response.status, 400);
  });

  it("retorna erro genérico 500 em falha do banco, sem mascarar como credencial inválida", async () => {
    failDatabase = true;
    const login = await post("login", { email: "teste@example.com", password });
    assert.equal(login.status, 500);
    assert.deepEqual(await login.json(), { message: "Erro interno do servidor." });
    const profile = await me(signAccessToken(userId, config));
    assert.equal(profile.status, 500);
    assert.deepEqual(await profile.json(), { message: "Erro interno do servidor." });
  });

  it("preserva a rota de saúde", async () => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ok");
  });

  it("valida a configuração JWT sem modificar o arquivo .env", () => {
    const originalSecret = process.env.JWT_SECRET;
    const originalExpiration = process.env.JWT_EXPIRES_IN;
    try {
      delete process.env.JWT_SECRET;
      assert.throws(getAuthConfig);
      process.env.JWT_SECRET = "curto";
      assert.throws(getAuthConfig);
      process.env.JWT_SECRET = config.secret;
      for (const value of ["", "0", "-1", "1h", "1.5", "Infinity"]) {
        process.env.JWT_EXPIRES_IN = value;
        assert.throws(getAuthConfig);
      }
      process.env.JWT_EXPIRES_IN = "900";
      assert.equal(getAuthConfig().expiresInSeconds, 900);
      delete process.env.JWT_EXPIRES_IN;
      assert.equal(getAuthConfig().expiresInSeconds, 3600);
    } finally {
      if (originalSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalSecret;
      if (originalExpiration === undefined) delete process.env.JWT_EXPIRES_IN;
      else process.env.JWT_EXPIRES_IN = originalExpiration;
    }
  });
});
