import type { AuctionStatus, LotStatus, Vehicle } from "../../generated/prisma/client";

export type VehicleInput = Pick<Vehicle, "brand" | "model" | "year" | "version" | "description" | "imageUrls" | "fipeCode" | "fipeBrandCode" | "fipeModelCode" | "fipeYearCode" | "fipeReferenceMonth"> & { fipeReferencePrice: string | null };
export type VehiclePatch = Partial<VehicleInput>;
export interface VehicleQuery { page: number; limit: number; brand?: string; model?: string; year?: number }
export interface VehicleLotState {
  status: LotStatus;
  winnerId: string | null;
  auction: { status: AuctionStatus; startsAt: Date; endsAt: Date };
  hasHistory: boolean;
}
export interface VehicleMutationState {
  vehicle: Vehicle;
  lots: VehicleLotState[];
  hasAuditHistory: boolean;
}
export type VehicleMutation = (state: VehicleMutationState) =>
  { operation: "update"; data: VehiclePatch } | { operation: "delete" };
export interface VehicleRepository {
  create(input: VehicleInput, ownerId: string): Promise<Vehicle>;
  list(query: VehicleQuery): Promise<{ vehicles: Vehicle[]; total: number }>;
  findById(id: string): Promise<Vehicle | null>;
  // Ownership, dependency checks and writes must share the same transaction.
  mutate(id: string, decide: VehicleMutation): Promise<Vehicle>;
}
