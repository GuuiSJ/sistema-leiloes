import { HttpError } from "../../errors/http-error";
import { publicAuction } from "./auction.service";
import type { AuctionLifecycleRepository, AuctionTransition, LifecycleDecision, LifecycleState } from "./auction-lifecycle.types";

export class AuctionLifecycleService {
  constructor(private readonly repository: AuctionLifecycleRepository) {}
  private decide(state: LifecycleState, operation: AuctionTransition, authorId: string): LifecycleDecision {
    const { auction, lots, now } = state;
    if (auction.organizerId !== authorId) throw new HttpError(403, "Somente o responsável pode agendar ou abrir este leilão.");
    const status = operation === "schedule" ? "SCHEDULED" : "OPEN";
    if (auction.status === status) return { status, openLotIds: [], unchanged: true };
    const source = operation === "schedule" ? "DRAFT" : "SCHEDULED";
    if (auction.status !== source) throw new HttpError(409, "Estado do leilão incompatível com esta transição.");
    if (auction.endsAt <= auction.startsAt || auction.endsAt <= now || (operation === "schedule" ? auction.startsAt <= now : auction.startsAt > now)) {
      throw new HttpError(409, operation === "schedule" ? "Agendamento exige início e término futuros e período válido." : "Abertura exige início alcançado e término ainda futuro.");
    }
    const eligible = lots.filter(lot => lot.status !== "CANCELLED");
    if (!eligible.length) throw new HttpError(409, "Leilão precisa de ao menos um lote válido não cancelado.");
    if (eligible.some(lot => lot.status !== "PENDING" || lot.winnerId !== null || lot.hasFinancialHistory || lot.vehicleOwnerId !== authorId || lot.number < 1 || !lot.startingPrice.greaterThan(0) || !lot.minimumIncrement.greaterThan(0) || lot.version < 0 || lot.version >= 2147483647)) {
      throw new HttpError(409, "Leilão possui lote incompatível, histórico financeiro ou veículo de outro proprietário.");
    }
    return { status, openLotIds: operation === "open" ? eligible.map(lot => lot.id) : [], unchanged: false };
  }
  async transition(id: string, operation: AuctionTransition, authorId: string) {
    const result = await this.repository.transition(id, operation, authorId, state => this.decide(state, operation, authorId));
    return { auction: publicAuction(result.auction), openedLots: result.openedLots, unchanged: result.unchanged };
  }
}
