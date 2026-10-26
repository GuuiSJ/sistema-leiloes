import { HttpError } from "../../errors/http-error";
import type { Vehicle } from "../../generated/prisma/client";
import type { VehicleInput, VehiclePatch, VehicleQuery, VehicleRepository } from "./vehicle.types";

export function publicVehicle(v: Vehicle) {
  return {
    id: v.id, brand: v.brand, model: v.model, year: v.year, version: v.version,
    description: v.description, imageUrls: v.imageUrls,
    fipeCode: v.fipeCode, fipeBrandCode: v.fipeBrandCode, fipeModelCode: v.fipeModelCode,
    fipeYearCode: v.fipeYearCode, fipeReferenceMonth: v.fipeReferenceMonth,
    fipeReferencePrice: v.fipeReferencePrice?.toFixed(2) ?? null,
    fipeConsultedAt: v.fipeConsultedAt, fipeReferencePriceVerified: false,
    createdAt: v.createdAt, updatedAt: v.updatedAt,
  };
}
export class VehicleService {
  constructor(private readonly repository: VehicleRepository, private readonly now: () => Date = () => new Date()) {}
  async create(input: VehicleInput, ownerId: string) { return publicVehicle(await this.repository.create(input, ownerId)); }
  async list(query: VehicleQuery) {
    const { vehicles, total } = await this.repository.list(query);
    return { data: vehicles.map(publicVehicle), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
  async findById(id: string) {
    const vehicle = await this.repository.findById(id);
    if (!vehicle) throw new HttpError(404, "Veículo não encontrado.");
    return publicVehicle(vehicle);
  }
  private requireOwner(vehicle: Vehicle, userId: string): void {
    if (!vehicle.ownerId || vehicle.ownerId !== userId) throw new HttpError(403, "Somente o proprietário pode alterar este veículo.");
  }
  async update(id: string, patch: VehiclePatch, userId: string) {
    return publicVehicle(await this.repository.mutate(id, ({ vehicle, lots, hasAuditHistory }) => {
      this.requireOwner(vehicle, userId);
      const now = this.now();
      if (hasAuditHistory || lots.some(lot =>
        lot.status !== "PENDING" || lot.winnerId !== null || lot.hasHistory ||
        !["DRAFT", "SCHEDULED"].includes(lot.auction.status) ||
        lot.auction.startsAt <= now || lot.auction.endsAt <= now
      )) throw new HttpError(409, "Veículo possui lotes ou histórico incompatíveis com edição.");
      return { operation: "update", data: patch };
    }));
  }
  async delete(id: string, userId: string): Promise<void> {
    await this.repository.mutate(id, ({ vehicle, lots, hasAuditHistory }) => {
      this.requireOwner(vehicle, userId);
      if (lots.length || hasAuditHistory) throw new HttpError(409, "Veículo possui lotes ou histórico que impedem a exclusão.");
      return { operation: "delete" };
    });
  }
}
