import { HttpError } from "../../errors/http-error";
import { publicVehicle } from "../vehicles/vehicle.service";
import type { LotInput, LotPatch, LotQuery, LotRecord, LotRepository, LotWriteState } from "./lot.types";

function publicLot(lot: LotRecord) {
  return {
    id: lot.id, auctionId: lot.auctionId, vehicleId: lot.vehicleId,
    number: lot.number, startingPrice: lot.startingPrice.toFixed(2),
    minimumIncrement: lot.minimumIncrement.toFixed(2), status: lot.status,
    createdAt: lot.createdAt, updatedAt: lot.updatedAt, vehicle: publicVehicle(lot.vehicle),
  };
}
export class LotService {
  constructor(private readonly repository: LotRepository, private readonly now: () => Date = () => new Date()) {}
  private validate(state: LotWriteState, userId: string): void {
    if (state.auction.organizerId !== userId) throw new HttpError(403, "Somente o responsável pelo leilão pode gerenciar seus lotes.");
    if (state.vehicle.ownerId !== userId || (state.currentVehicle && state.currentVehicle.ownerId !== userId)) {
      throw new HttpError(403, "O veículo deve pertencer ao responsável pelo leilão.");
    }
    const now = this.now();
    if (state.auction.status !== "DRAFT" || state.auction.startsAt <= now || state.auction.endsAt <= now) {
      throw new HttpError(409, "Somente leilões DRAFT ainda não iniciados permitem gerenciar lotes.");
    }
    if (state.lot && (state.lot.status !== "PENDING" || state.lot.winnerId !== null || state.hasHistory)) {
      throw new HttpError(409, "Lote possui estado ou histórico incompatível com alteração ou exclusão.");
    }
  }
  async create(auctionId: string, input: LotInput, userId: string) {
    return publicLot(await this.repository.write({ operation: "create", auctionId, input }, state => this.validate(state, userId)));
  }
  async list(auctionId: string, query: LotQuery) {
    const { lots, total } = await this.repository.list(auctionId, query);
    return { data: lots.map(publicLot), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
  async findById(auctionId: string, lotId: string) {
    const lot = await this.repository.findById(auctionId, lotId);
    if (!lot) throw new HttpError(404, "Lote não encontrado neste leilão.");
    return publicLot(lot);
  }
  async update(auctionId: string, lotId: string, input: LotPatch, userId: string) {
    return publicLot(await this.repository.write({ operation: "update", auctionId, lotId, input }, state => this.validate(state, userId)));
  }
  async delete(auctionId: string, lotId: string, userId: string): Promise<void> {
    await this.repository.write({ operation: "delete", auctionId, lotId }, state => this.validate(state, userId));
  }
}
