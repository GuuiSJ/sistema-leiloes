import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type Wallet } from "../../generated/prisma/client";
import { getPrisma } from "../../lib/prisma";
import { HttpError } from "../../errors/http-error";
import type { WalletRepository } from "./wallet.types";

const maxBalance = new Prisma.Decimal("9999999999999999.99");

async function ownWallet(tx: Prisma.TransactionClient, userId: string): Promise<Wallet> {
  // PostgreSQL handles concurrent first requests without overwriting any balance.
  await tx.$executeRaw`
    INSERT INTO "Wallet" ("id", "userId", "balance", "version", "createdAt", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${userId}::uuid, 0, 0, NOW(), NOW())
    ON CONFLICT ("userId") DO NOTHING`;
  await tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new HttpError(404, "Carteira não encontrada.");
  return wallet;
}
async function snapshot(tx: Prisma.TransactionClient, wallet: Wallet) {
  const sum = await tx.bidReservation.aggregate({ where: { walletId: wallet.id, status: "ACTIVE" }, _sum: { amount: true } });
  const reserved = sum._sum.amount ?? new Prisma.Decimal(0);
  if (wallet.balance.isNegative() || reserved.isNegative() || reserved.greaterThan(wallet.balance)) {
    throw new HttpError(409, "Carteira com saldos inconsistentes. Operação indisponível.");
  }
  return { wallet, reserved };
}

export function createWalletRepository(client: () => PrismaClient = getPrisma): WalletRepository {
  async function transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await client().$transaction(operation, { isolationLevel: "Serializable" }); }
      catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown } } | undefined;
          const code = error.meta?.code ?? adapter?.cause?.originalCode;
          if (error.code === "P2034" || (error.code === "P2010" && ["40001", "40P01"].includes(String(code)))) {
            if (attempt < 2) continue;
            throw new HttpError(409, "Carteira alterada simultaneamente. Reenvie com a mesma chave de idempotência.");
          }
          if (error.code === "P2002") throw new HttpError(409, "Chave de idempotência ou carteira em conflito.");
          if (error.code === "P2003" || (error.code === "P2010" && String(code) === "23503")) throw new HttpError(401, "Usuário autenticado não está mais disponível.");
        }
        throw error;
      }
    }
    throw new HttpError(409, "Não foi possível concluir a operação financeira.");
  }
  return {
    get(userId) { return transaction(async tx => snapshot(tx, await ownWallet(tx, userId))); },
    credit(userId, amount, key, cumulativeLimit) {
      return transaction(async tx => {
        const wallet = await ownWallet(tx, userId);
        // Key is scoped by authenticated user and operation; <= 113 characters.
        const idempotencyKey = `demo-credit:${userId}:${key}`;
        const previous = await tx.walletTransaction.findUnique({ where: { idempotencyKey } });
        if (previous) {
          if (previous.walletId !== wallet.id || previous.type !== "CREDIT" || previous.reservationId !== null || !previous.amount.equals(amount)) throw new HttpError(409, "Chave de idempotência já utilizada com outro valor ou operação.");
          return { ...await snapshot(tx, wallet), transaction: previous, replayed: true };
        }
        await snapshot(tx, wallet);
        if (cumulativeLimit) {
          const credited = await tx.walletTransaction.aggregate({
            where: { walletId: wallet.id, type: "CREDIT", idempotencyKey: { startsWith: "demo-credit:" } },
            _sum: { amount: true },
          });
          if ((credited._sum.amount ?? new Prisma.Decimal(0)).plus(amount).greaterThan(cumulativeLimit)) {
            throw new HttpError(409, "Crédito excede o limite acumulado de demonstração desta conta.");
          }
        }
        const balance = wallet.balance.plus(amount);
        if (balance.greaterThan(maxBalance)) throw new HttpError(409, "Crédito excede o limite de saldo da carteira.");
        const updated = await tx.wallet.update({ where: { id: wallet.id }, data: { balance, version: { increment: 1 } } });
        const movement = await tx.walletTransaction.create({ data: { walletId: wallet.id, type: "CREDIT", amount, balanceAfter: balance, idempotencyKey } });
        return { ...await snapshot(tx, updated), transaction: movement, replayed: false };
      });
    },
    transactions(userId, query) {
      return transaction(async tx => {
        const wallet = await ownWallet(tx, userId);
        const where = { walletId: wallet.id };
        const transactions = await tx.walletTransaction.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        const total = await tx.walletTransaction.count({ where });
        return { transactions, total };
      });
    },
  };
}
export const walletRepository = createWalletRepository();
