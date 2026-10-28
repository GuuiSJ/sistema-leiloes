import type { Prisma, Wallet, WalletTransaction } from "../../generated/prisma/client";

export interface WalletQuery { page: number; limit: number }
export interface WalletSnapshot { wallet: Wallet; reserved: Prisma.Decimal }
export interface WalletCreditResult extends WalletSnapshot { transaction: WalletTransaction; replayed: boolean }
export interface WalletRepository {
  get(userId: string): Promise<WalletSnapshot>;
  credit(userId: string, amount: Prisma.Decimal, key: string, cumulativeLimit?: Prisma.Decimal): Promise<WalletCreditResult>;
  transactions(userId: string, query: WalletQuery): Promise<{ transactions: WalletTransaction[]; total: number }>;
}
