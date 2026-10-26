import type { Auction, Bid, Lot, Prisma } from "../../generated/prisma/client";

export interface BidQuery { page: number; limit: number }
export type BidRecord = Pick<Bid, "id" | "lotId" | "amount" | "sequence" | "createdAt">;
export interface BidState {
  lot: Lot;
  auction: Auction;
  vehicleOwnerId: string;
  latest: Bid | null;
  hasReceipt: boolean;
  now: Date;
}
export interface BidRepository {
  place(lotId: string, userId: string, amount: Prisma.Decimal, key: string, validate: (state: BidState) => void): Promise<{ bid: BidRecord; replayed: boolean }>;
  list(lotId: string, query: BidQuery): Promise<{ bids: BidRecord[]; total: number }>;
}
