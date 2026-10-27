import { requireOperationalAuction } from "../temporal/auction-generation";
import { HttpError } from "../../errors/http-error";
import { Prisma } from "../../generated/prisma/client";
import type { BidRecord, BidRepository, BidQuery, BidState } from "./bid.types";
import { validateCreate, validateKey } from "./bid.validation";
import { bidEvents, bidExecutionQueue, type BidEventBus, type BidExecutionQueue } from "../../realtime/bid-events";
import { effectiveLotEndsAt } from "../lots/lot-deadline";

function publicBid(bid: BidRecord) {
  return { id: bid.id, lotId: bid.lotId, amount: bid.amount.toFixed(2), sequence: bid.sequence, createdAt: bid.createdAt };
}
function validateState(state: BidState, amount: Prisma.Decimal, userId: string): void {
  if (state.auction.organizerId === userId || state.vehicleOwnerId === userId) throw new HttpError(403, "Não é permitido dar lance no próprio leilão ou veículo.");
  requireOperationalAuction(state.auction);
  if (state.auction.status !== "OPEN" || state.lot.status !== "OPEN" || state.auction.startsAt > state.now || effectiveLotEndsAt(state.lot, state.auction) <= state.now || state.lot.winnerId !== null || state.hasReceipt) {
    throw new HttpError(409, "Leilão e lote devem estar abertos e dentro do período de lances.");
  }
  if (!state.lot.startingPrice.greaterThan(0) || !state.lot.minimumIncrement.greaterThan(0)) throw new HttpError(409, "Lote com configuração financeira inconsistente.");
  const minimum = state.latest ? state.latest.amount.plus(state.lot.minimumIncrement) : state.lot.startingPrice;
  if (amount.lessThan(minimum)) throw new HttpError(409, "Lance abaixo do valor inicial ou do incremento mínimo.");
}
export class BidService {
  constructor(private readonly repository: BidRepository, private readonly events: Pick<BidEventBus, "publish" | "publishExtended"> = bidEvents, private readonly queue: BidExecutionQueue = bidExecutionQueue) {}
  async place(lotId: string, userId: string, rawAmount: string, key: string) {
    const amount = new Prisma.Decimal(validateCreate({ amount: rawAmount }));
    const validatedKey = validateKey(key);
    return this.queue.run(lotId, async () => {
      // repository.place resolves only after the financial transaction commits.
      const result = await this.repository.place(lotId, userId, amount, validatedKey, state => validateState(state, amount, userId));
      const bid = publicBid(result.bid);
      if (!result.replayed) {
        try { this.events.publish({ lotId: bid.lotId, bidId: bid.id, amount: bid.amount, createdAt: bid.createdAt.toISOString(), sequence: bid.sequence }); }
        catch { console.error("Falha ao transmitir atualização pública de lance."); }
        if (result.extension) {
          try { this.events.publishExtended({ lotId: result.extension.lotId, previousEndsAt: result.extension.previousEndsAt.toISOString(), endsAt: result.extension.endsAt.toISOString(), triggerBidId: result.extension.triggerBidId }); }
          catch { console.error("Falha ao transmitir prorrogação pública de lote."); }
        }
      }
      return { bid, replayed: result.replayed };
    });
  }
  async list(lotId: string, query: BidQuery) {
    const { bids, total } = await this.repository.list(lotId, query);
    return { data: bids.map(publicBid), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
}
