import type { Auction, Lot, Prisma } from "../../generated/prisma/client";

export type AuctionTransition = "schedule" | "open";
export type LifecycleLot = Lot & { vehicleOwnerId: string; hasFinancialHistory: boolean };
export interface LifecycleState { auction: Auction; lots: LifecycleLot[]; now: Date }
export interface LifecycleDecision { status: "SCHEDULED" | "OPEN"; openLotIds: string[]; unchanged: boolean }
export interface AuctionLifecycleRepository {
  transition(id: string, operation: AuctionTransition, authorId: string, decide: (state: LifecycleState) => LifecycleDecision): Promise<{ auction: Auction; openedLots: number; unchanged: boolean }>;
}
// Audit preparation must lock/validate the global chain before the transition clock is read.
export type PrepareOpeningAudit = (tx: Prisma.TransactionClient) => Promise<
  (auction: Auction, lots: LifecycleLot[], authorId: string | null, occurredAt: Date) => Promise<void>
>;
