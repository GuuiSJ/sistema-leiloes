import assert from "node:assert/strict";
import { it } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type WalletTransaction } from "../src/generated/prisma/client";
import { requireSimulatedCreditAuthorization } from "../src/config/wallet";
import { createWalletRepository } from "../src/modules/wallet/wallet.repository";
import { WalletService } from "../src/modules/wallet/wallet.service";
import { HttpError } from "../src/errors/http-error";

const userId = randomUUID();
const env = { NODE_ENV: "production", ENABLE_PRODUCTION_DEMO_CREDITS: "true", PRODUCTION_DEMO_CREDIT_USER_IDS: userId, PRODUCTION_DEMO_CREDIT_LIMIT: "100.00" };
it("produção exige habilitação específica e ID explícito, sem depender da flag local", () => {
  assert.equal(requireSimulatedCreditAuthorization(userId, env), "100.00");
  assert.equal(requireSimulatedCreditAuthorization(userId, { ...env, ENABLE_SIMULATED_CREDITS: "false" }), "100.00");
});
for (const [name, change] of Object.entries({
  "flag ausente": { ENABLE_PRODUCTION_DEMO_CREDITS: undefined },
  "somente flag local": { ENABLE_PRODUCTION_DEMO_CREDITS: "false", ENABLE_SIMULATED_CREDITS: "true" },
  "lista ausente": { PRODUCTION_DEMO_CREDIT_USER_IDS: undefined },
  "lista inválida": { PRODUCTION_DEMO_CREDIT_USER_IDS: `${userId},*` },
  "limite ausente": { PRODUCTION_DEMO_CREDIT_LIMIT: undefined },
  "limite zero": { PRODUCTION_DEMO_CREDIT_LIMIT: "0.00" },
  "limite negativo": { PRODUCTION_DEMO_CREDIT_LIMIT: "-1.00" },
  "limite impreciso": { PRODUCTION_DEMO_CREDIT_LIMIT: "1e3" },
  "limite excedido": { PRODUCTION_DEMO_CREDIT_LIMIT: "10000000000000000.00" },
})) it(`bloqueia configuração: ${name}`, () => {
  assert.throws(() => requireSimulatedCreditAuthorization(userId, { ...env, ...change }), e => e instanceof HttpError && e.status === 403);
});
it("bloqueia ID diferente, ausente e ambiente não autorizado", () => {
  for (const id of [randomUUID(), undefined]) assert.throws(() => requireSimulatedCreditAuthorization(id, env));
  assert.throws(() => requireSimulatedCreditAuthorization(userId, { ...env, NODE_ENV: "test" }));
});

// Exercise the real repository transaction against a fake Prisma adapter: no database connection.
function fixture(credited = "90.00", balance = "0.00") {
  let wallet = { id: randomUUID(), userId, balance: new Prisma.Decimal(balance), version: 0, createdAt: new Date(), updatedAt: new Date() };
  const movements = new Map<string, WalletTransaction>();
  let aggregates = 0, writes = 0;
  const tx = {
    async $executeRaw() {}, async $queryRaw() {},
    wallet: { async findUnique() { return wallet; }, async update({ data }: { data: { balance: Prisma.Decimal } }) { writes++; wallet = { ...wallet, balance: data.balance }; return wallet; } },
    bidReservation: { async aggregate() { return { _sum: { amount: null } }; } },
    walletTransaction: {
      async findUnique({ where }: { where: { idempotencyKey: string } }) { return movements.get(where.idempotencyKey) ?? null; },
      async aggregate({ where }: { where: { walletId: string; type: string; idempotencyKey: { startsWith: string } } }) {
        aggregates++; assert.equal(where.walletId, wallet.id); assert.equal(where.type, "CREDIT"); assert.equal(where.idempotencyKey.startsWith, "demo-credit:");
        return { _sum: { amount: [...movements.values()].reduce((sum, m) => sum.plus(m.amount), new Prisma.Decimal(credited)) } };
      },
      async create({ data }: { data: Omit<WalletTransaction, "id" | "createdAt" | "reservationId"> }) {
        const movement = { ...data, id: randomUUID(), reservationId: null, createdAt: new Date() }; movements.set(data.idempotencyKey, movement); return movement;
      },
    },
  };
  const client = { async $transaction<T>(operation: (t: unknown) => Promise<T>, options: { isolationLevel: string }) { assert.equal(options.isolationLevel, "Serializable"); return operation(tx); } } as unknown as PrismaClient;
  const repository = createWalletRepository(() => client);
  return { repository, service: new WalletService(repository, id => requireSimulatedCreditAuthorization(id, env)), counts: () => ({ writes, aggregates, movements: movements.size }) };
}
it("permite exatamente o teto; replay não soma novamente nem revalida o teto", async () => {
  const f = fixture();
  assert.equal((await f.service.credit(userId, "10.00", "operation")).replayed, false);
  assert.equal((await f.service.credit(userId, "10.00", "operation")).replayed, true);
  assert.deepEqual(f.counts(), { writes: 1, aggregates: 1, movements: 1 });
  await assert.rejects(f.service.credit(userId, "0.01", "other"), e => e instanceof HttpError && e.status === 409);
  assert.equal(f.counts().writes, 1);
});
it("saldo gasto não reinicia limite acumulado; excedente não escreve", async () => {
  const f = fixture("100.00", "0.00");
  await assert.rejects(f.service.credit(userId, "0.01", "operation"), /limite acumulado/);
  assert.equal(f.counts().writes, 0); assert.equal(f.counts().movements, 0);
});
it("mesma chave com outro valor mantém conflito e não duplica", async () => {
  const f = fixture("0.00");
  await f.service.credit(userId, "10.00", "operation");
  await assert.rejects(f.service.credit(userId, "11.00", "operation"), /idempotência/);
  assert.equal(f.counts().writes, 1);
});
it("serviço bloqueia não autorizado e valores inválidos antes da persistência", async () => {
  const f = fixture("0.00");
  await assert.rejects(f.service.credit(randomUUID(), "10.00", "operation"), e => e instanceof HttpError && e.status === 403);
  for (const amount of ["0", "-1", "1e3", "1.001"]) await assert.rejects(f.service.credit(userId, amount, "operation"));
  assert.equal(f.counts().writes, 0);
});
