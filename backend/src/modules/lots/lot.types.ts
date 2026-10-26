import type { Auction, Lot, Vehicle } from "../../generated/prisma/client";

export interface LotInput { vehicleId: string; number: number; startingPrice: string; minimumIncrement: string }
// Increment is fixed after creation in this stage.
export type LotPatch = Partial<Omit<LotInput, "minimumIncrement">>;
export interface LotQuery { page: number; limit: number }
export type LotRecord = Lot & { vehicle: Vehicle };
export type LotCommand =
  | { operation: "create"; auctionId: string; input: LotInput }
  | { operation: "update"; auctionId: string; lotId: string; input: LotPatch }
  | { operation: "delete"; auctionId: string; lotId: string };
export interface LotWriteState {
  auction: Auction;
  lot: Lot | null;
  currentVehicle: Vehicle | null;
  vehicle: Vehicle;
  hasHistory: boolean;
}
export interface LotRepository {
  list(auctionId: string, query: LotQuery): Promise<{ lots: LotRecord[]; total: number }>;
  findById(auctionId: string, lotId: string): Promise<LotRecord | null>;
  // State validation and write execute within a single transaction.
  write(command: LotCommand, validate: (state: LotWriteState) => void): Promise<LotRecord>;
}
