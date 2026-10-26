export interface LotClosedEvent { lotId: string; auctionId: string; status: "SOLD" | "UNSOLD"; closedAt: string }
export interface AuctionClosedEvent { auctionId: string; status: "CLOSED"; closedAt: string }
type Listener<T> = (event: Readonly<T>) => void | Promise<void>;
export class SettlementEventBus {
  private readonly lots = new Set<Listener<LotClosedEvent>>();
  private readonly auctions = new Set<Listener<AuctionClosedEvent & { lotIds: string[] }>>();
  subscribeLot(listener: Listener<LotClosedEvent>) { this.lots.add(listener); return () => { this.lots.delete(listener); }; }
  subscribeAuction(listener: Listener<AuctionClosedEvent & { lotIds: string[] }>) { this.auctions.add(listener); return () => { this.auctions.delete(listener); }; }
  private send<T>(listeners: Set<Listener<T>>, payload: T) {
    for (const listener of listeners) {
      try { const pending = listener(Object.freeze(payload)); if (pending) void Promise.resolve(pending).catch(() => console.error("Falha ao transmitir encerramento público.")); }
      catch { console.error("Falha ao transmitir encerramento público."); }
    }
  }
  publishLot(event: LotClosedEvent) { this.send(this.lots, { lotId: event.lotId, auctionId: event.auctionId, status: event.status, closedAt: event.closedAt }); }
  publishAuction(event: AuctionClosedEvent & { lotIds: string[] }) { this.send(this.auctions, { auctionId: event.auctionId, status: event.status, closedAt: event.closedAt, lotIds: Object.freeze([...event.lotIds]) as unknown as string[] }); }
}
export const settlementEvents = new SettlementEventBus();
