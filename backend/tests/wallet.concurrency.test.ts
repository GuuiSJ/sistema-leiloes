import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { getPrisma, disconnectDatabase } from "../src/lib/prisma";
import { createWalletRepository } from "../src/modules/wallet/wallet.repository";
import { WalletService } from "../src/modules/wallet/wallet.service";
import { requireSimulatedCreditEnvironment } from "../src/config/wallet";
import { HttpError } from "../src/errors/http-error";

describe("Carteira PostgreSQL concorrente", { skip: process.env.WALLET_DATABASE_TESTS !== "1" }, () => {
  after(disconnectDatabase);
  async function fixture(check: (service: WalletService, userId: string) => Promise<void>) {
    const userId = randomUUID(), prisma = getPrisma();
    await prisma.user.create({ data: { id: userId, name: "Fixture concorrência financeira", email: `${userId}@example.invalid`, passwordHash: "unused-test-fixture", role: "BIDDER" } });
    const demo = () => requireSimulatedCreditEnvironment({ NODE_ENV: "development", ENABLE_SIMULATED_CREDITS: "true", DATABASE_URL: "postgresql://fixture:unused@localhost/sistema_leiloes" });
    try { await check(new WalletService(createWalletRepository(), demo), userId); }
    finally {
      // Only test-owned financial fixtures are removed. Never select existing accounts.
      await prisma.$transaction(async tx => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (wallet) { await tx.walletTransaction.deleteMany({ where: { walletId: wallet.id } }); await tx.wallet.delete({ where: { id: wallet.id } }); }
        await tx.user.delete({ where: { id: userId } });
      });
    }
  }
  it("consultas simultâneas criam exatamente uma carteira", async () => {
    await fixture(async (service, userId) => {
      const wallets = await Promise.all([service.get(userId), service.get(userId)]);
      assert.equal(wallets[0].totalBalance, "0.00"); assert.equal(wallets[1].totalBalance, "0.00");
      assert.equal(await getPrisma().wallet.count({ where: { userId } }), 1);
    });
  });
  it("créditos simultâneos com chaves distintas não perdem saldo", async () => {
    await fixture(async (service, userId) => {
      await Promise.all([service.credit(userId, "0.10", "a"), service.credit(userId, "0.20", "b")]);
      assert.equal((await service.get(userId)).totalBalance, "0.30");
      const wallet = await getPrisma().wallet.findUniqueOrThrow({ where: { userId } });
      assert.equal(wallet.version, 2); assert.equal(await getPrisma().walletTransaction.count({ where: { walletId: wallet.id } }), 2);
    });
  });
  it("mesma chave simultânea credita uma única vez, inclusive na primeira carteira", async () => {
    await fixture(async (service, userId) => {
      const results = await Promise.all([service.credit(userId, "100", "same"), service.credit(userId, "100.00", "same")]);
      assert.equal(results[0].transaction.id, results[1].transaction.id);
      assert.equal(results.filter(r => !r.replayed).length, 1); assert.equal((await service.get(userId)).totalBalance, "100.00");
      const wallet = await getPrisma().wallet.findUniqueOrThrow({ where: { userId } }); assert.equal(await getPrisma().walletTransaction.count({ where: { walletId: wallet.id } }), 1);
    });
  });
  it("mesma chave simultânea com valores distintos produz um crédito e um 409", async () => {
    await fixture(async (service, userId) => {
      const results = await Promise.allSettled([service.credit(userId, "10", "same"), service.credit(userId, "20", "same")]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const rejected = results.find(r => r.status === "rejected"); assert(rejected && rejected.status === "rejected");
      assert(rejected.reason instanceof HttpError); assert.equal(rejected.reason.status, 409);
      const winner = results.find(r => r.status === "fulfilled"); assert(winner && winner.status === "fulfilled");
      assert.equal((await service.get(userId)).totalBalance, winner.value.transaction.amount);
    });
  });
});
