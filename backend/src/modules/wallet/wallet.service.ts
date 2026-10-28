import { Prisma, type WalletTransaction } from "../../generated/prisma/client";
import { requireSimulatedCreditAuthorization } from "../../config/wallet";
import { HttpError } from "../../errors/http-error";
import type { WalletQuery, WalletRepository, WalletSnapshot } from "./wallet.types";
import { validateCredit, validateKey } from "./wallet.validation";

function balanceView({ wallet, reserved }: WalletSnapshot) {
  return { totalBalance: wallet.balance.toFixed(2), reservedBalance: reserved.toFixed(2), availableBalance: wallet.balance.minus(reserved).toFixed(2) };
}
function transactionView(t: WalletTransaction) {
  return { id: t.id, type: t.type, amount: t.amount.toFixed(2), balanceAfter: t.balanceAfter.toFixed(2), createdAt: t.createdAt, simulated: t.type === "CREDIT" && t.idempotencyKey.startsWith("demo-credit:") };
}
export class WalletService {
  constructor(private readonly repository: WalletRepository, private readonly requireDemo: (userId?: string) => string | void = requireSimulatedCreditAuthorization) {}
  capability(userId: string) {
    try { const limit = this.requireDemo(userId); return { enabled: true, cumulativeLimit: limit ?? null }; }
    catch (error) { if (error instanceof HttpError && error.status === 403) return { enabled: false, cumulativeLimit: null }; throw error; }
  }
  async get(userId: string) { return balanceView(await this.repository.get(userId)); }
  async credit(userId: string, amount: string, key: string) {
    const limit = this.requireDemo(userId);
    const result = await this.repository.credit(userId, new Prisma.Decimal(validateCredit({ amount })), validateKey(key), limit ? new Prisma.Decimal(limit) : undefined);
    return { wallet: balanceView(result), transaction: transactionView(result.transaction), replayed: result.replayed, simulated: true, message: "Crédito simulado de demonstração, sem depósito ou valor monetário real." };
  }
  async transactions(userId: string, query: WalletQuery) {
    const { transactions, total } = await this.repository.transactions(userId, query);
    return { data: transactions.map(transactionView), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
}
