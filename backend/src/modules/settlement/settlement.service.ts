import type { SettlementRepository } from "./settlement.repository";
import { settlementEvents, type SettlementEventBus } from "../../realtime/settlement-events";

export class SettlementService {
  constructor(private readonly repository: SettlementRepository, private readonly events: SettlementEventBus = settlementEvents) {}
  async process(auctionId: string, lotId: string | null): Promise<void> {
    const result = await this.repository.settle(auctionId, lotId);
    // Repository resolves after commit; delivery failures cannot affect committed money.
    if (result.lot) this.events.publishLot(result.lot);
    if (result.auction) this.events.publishAuction(result.auction);
  }
}
