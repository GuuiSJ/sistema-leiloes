import type { Auction, AuctionStatus } from "../../generated/prisma/client";

export type AuctionView = Omit<Auction, "organizerId">;
export type AuctionInput = Pick<Auction, "title" | "description" | "startsAt" | "endsAt">;
export type AuctionPatch = Partial<AuctionInput>;
export interface AuctionQuery {
  page: number;
  limit: number;
  status?: AuctionStatus;
}
export interface AuctionPage {
  data: AuctionView[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
export interface AuctionMutationState {
  auction: Auction;
  hasIncompatibleOperations: boolean;
}
export type AuctionMutation = (state: AuctionMutationState) => AuctionPatch & { status?: "CANCELLED" };

export interface AuctionRepository {
  create(input: AuctionInput, organizerId: string): Promise<Auction>;
  list(query: AuctionQuery): Promise<{ auctions: Auction[]; total: number }>;
  findById(id: string): Promise<Auction | null>;
  // A leitura, a decisão e a gravação devem compartilhar a mesma transação.
  mutate(id: string, decide: AuctionMutation): Promise<Auction>;
}
