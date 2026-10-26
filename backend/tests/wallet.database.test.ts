import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { getPrisma, disconnectDatabase } from "../src/lib/prisma";
import { createWalletRepository } from "../src/modules/wallet/wallet.repository";
import { WalletService } from "../src/modules/wallet/wallet.service";
import { requireSimulatedCreditEnvironment } from "../src/config/wallet";
import { HttpError } from "../src/errors/http-error";

describe("Carteira PostgreSQL (fixtures com rollback)", { skip: process.env.WALLET_DATABASE_TESTS !== "1" }, () => {
  after(disconnectDatabase);
  const demo = () => requireSimulatedCreditEnvironment({ NODE_ENV: "development", ENABLE_SIMULATED_CREDITS: "true", DATABASE_URL: "postgresql://fixture:unused@localhost/sistema_leiloes" });
  async function fixture(check: (c: { tx: Prisma.TransactionClient; service: WalletService; userId: string; otherId: string; control: { failMovement: boolean } }) => Promise<void>) {
    const rollback = new Error("rollback de fixtures financeiras");
    try {
      await getPrisma().$transaction(async tx => {
        const userId = randomUUID(), otherId = randomUUID(), control = { failMovement: false };
        for (const id of [userId, otherId]) await tx.user.create({ data: { id, name: "Fixture carteira", email: `${id}@example.invalid`, passwordHash: "unused-test-fixture", role: "BIDDER" } });
        const scoped = { $transaction: async (operation: (db: Prisma.TransactionClient) => Promise<unknown>) => {
          await tx.$executeRawUnsafe("SAVEPOINT wallet_operation");
          try {
            const ledger = new Proxy(tx.walletTransaction, { get(target, property) {
              if (property === "create" && control.failMovement) return async () => { throw new Error("Falha simulada na gravação do movimento"); };
              return Reflect.get(target, property);
            } });
            const wrapped = new Proxy(tx, { get(target, property) { return property === "walletTransaction" ? ledger : Reflect.get(target, property); } });
            const result = await operation(wrapped);
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT wallet_operation"); return result;
          } catch (error) {
            await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT wallet_operation");
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT wallet_operation"); throw error;
          }
        } } as unknown as PrismaClient;
        await check({ tx, service: new WalletService(createWalletRepository(() => scoped), demo), userId, otherId, control });
        throw rollback;
      }, { isolationLevel: "Serializable", timeout: 20000 });
    } catch (error) { if (error !== rollback) throw error; }
  }
  const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;
  it("cria uma única carteira zerada e retorna somente os próprios saldos", async () => {
    await fixture(async ({ tx, service, userId }) => {
      assert.deepEqual(await service.get(userId), { totalBalance: "0.00", reservedBalance: "0.00", availableBalance: "0.00" });
      await service.get(userId); assert.equal(await tx.wallet.count({ where: { userId } }), 1);
    });
  });
  it("persiste saldo e movimento CREDIT de forma exata e idempotente", async () => {
    await fixture(async ({ tx, service, userId }) => {
      const first = await service.credit(userId, "0.10", "first"); await service.credit(userId, "0.20", "second");
      const replay = await service.credit(userId, "0.1", "first");
      assert.equal(replay.replayed, true); assert.equal(replay.transaction.id, first.transaction.id);
      assert.equal(replay.wallet.totalBalance, "0.30"); assert.equal(replay.transaction.balanceAfter, "0.10");
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } }); assert.equal(wallet.version, 2);
      assert.equal(await tx.walletTransaction.count({ where: { walletId: wallet.id } }), 2);
      await assert.rejects(service.credit(userId, "0.11", "first"), status(409));
      assert.equal((await service.get(userId)).totalBalance, "0.30");
    });
  });
  it("isola usuários e permite a mesma chave textual em carteiras diferentes", async () => {
    await fixture(async ({ service, userId, otherId }) => {
      await service.credit(userId, "10", "same"); await service.credit(otherId, "20", "same");
      assert.equal((await service.get(userId)).totalBalance, "10.00"); assert.equal((await service.get(otherId)).totalBalance, "20.00");
      const history = await service.transactions(userId, { page: 1, limit: 20 });
      assert.equal(history.data.length, 1); assert.equal(history.data[0].amount, "10.00");
      assert.equal("walletId" in history.data[0], false); assert.equal("idempotencyKey" in history.data[0], false);
    });
  });
  it("histórico paginado tem contagem e ordenação estáveis", async () => {
    await fixture(async ({ tx, service, userId }) => {
      const first = await service.credit(userId, "1", "a"), second = await service.credit(userId, "2", "b");
      await tx.walletTransaction.update({ where: { id: first.transaction.id }, data: { createdAt: new Date("2020-01-01T00:00:00Z") } });
      await tx.walletTransaction.update({ where: { id: second.transaction.id }, data: { createdAt: new Date("2020-01-02T00:00:00Z") } });
      const page = await service.transactions(userId, { page: 1, limit: 1 });
      assert.deepEqual(page.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 }); assert.equal(page.data[0].amount, "2.00");
      assert.equal((await service.transactions(userId, { page: 2, limit: 1 })).data[0].amount, "1.00");
    });
  });
  it("falha ao registrar movimento reverte saldo e versão", async () => {
    await fixture(async ({ tx, service, userId, control }) => {
      await service.get(userId); control.failMovement = true;
      await assert.rejects(service.credit(userId, "100", "rollback"), /Falha simulada/);
      control.failMovement = false;
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      assert.equal(wallet.balance.toFixed(2), "0.00"); assert.equal(wallet.version, 0);
      assert.equal(await tx.walletTransaction.count({ where: { walletId: wallet.id } }), 0);
      assert.equal((await service.credit(userId, "100", "rollback")).wallet.totalBalance, "100.00");
    });
  });
  it("saldo máximo não sofre overflow nem gera movimento extra", async () => {
    await fixture(async ({ tx, service, userId }) => {
      await service.credit(userId, "9999999999999999.99", "max");
      await assert.rejects(service.credit(userId, "0.01", "overflow"), status(409));
      assert.equal((await service.get(userId)).totalBalance, "9999999999999999.99");
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } }); assert.equal(await tx.walletTransaction.count({ where: { walletId: wallet.id } }), 1);
    });
  });
  it("consulta usa somente reservas ACTIVE, sem criar reservas pela API", async () => {
    await fixture(async ({ tx, service, userId, otherId }) => {
      await service.credit(userId, "100", "funds"); const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      await tx.user.update({ where: { id: otherId }, data: { role: "AUCTIONEER" } });
      const auction = await tx.auction.create({ data: { organizerId: otherId, title: "Fixture reservas", startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 172800000) } });
      let number = 0;
      for (const state of ["ACTIVE", "RELEASED", "CAPTURED"] as const) {
        const vehicle = await tx.vehicle.create({ data: { ownerId: otherId, brand: "Fixture", model: "Reserva", year: 2020 } });
        const lot = await tx.lot.create({ data: { vehicleId: vehicle.id, auctionId: auction.id, number: ++number, startingPrice: "1", minimumIncrement: "1" } });
        const bid = await tx.bid.create({ data: { lotId: lot.id, userId, amount: "10.20", sequence: 1 } });
        await tx.bidReservation.create({ data: { walletId: wallet.id, userId, lotId: lot.id, bidId: bid.id, amount: "10.20", status: state } });
      }
      assert.deepEqual(await service.get(userId), { totalBalance: "100.00", reservedBalance: "10.20", availableBalance: "89.80" });
    });
  });
  it("bloqueia saldo inconsistente sem registrar novo crédito", async () => {
    await fixture(async ({ tx, service, userId }) => {
      await service.get(userId); await tx.wallet.update({ where: { userId }, data: { balance: "-1" } });
      await assert.rejects(service.get(userId), status(409)); await assert.rejects(service.credit(userId, "10", "repair"), status(409));
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } }); assert.equal(await tx.walletTransaction.count({ where: { walletId: wallet.id } }), 0);
    });
  });
});
