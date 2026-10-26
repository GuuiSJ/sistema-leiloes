export interface BidCreatedEvent {
  lotId: string;
  bidId: string;
  amount: string;
  createdAt: string;
  sequence: number;
}
type Listener = (event: Readonly<BidCreatedEvent>) => void | Promise<void>;

export class BidEventBus {
  private readonly listeners = new Set<Listener>();
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  publish(event: BidCreatedEvent): void {
    // Explicit public projection; never forward a repository object or client payload.
    const payload = Object.freeze({ lotId: event.lotId, bidId: event.bidId, amount: event.amount, createdAt: event.createdAt, sequence: event.sequence });
    for (const listener of this.listeners) {
      try {
        const pending = listener(payload);
        if (pending) void Promise.resolve(pending).catch(() => console.error("Falha ao transmitir atualização pública de lance."));
      } catch { console.error("Falha ao transmitir atualização pública de lance."); }
    }
  }
}
export const bidEvents = new BidEventBus();

// Serialize each lot through commit + synchronous publication in this process.
// Different lots still run concurrently; PostgreSQL remains responsible for funds.
export class BidExecutionQueue {
  private readonly lots = new Map<string, { tail: Promise<unknown>; pending: number }>();
  async run<T>(lotId: string, operation: () => Promise<T>): Promise<T> {
    const state = this.lots.get(lotId) ?? { tail: Promise.resolve(), pending: 0 };
    if (state.pending >= 100) {
      throw new HttpError(429, "Muitos lances pendentes neste lote. Reenvie com a mesma chave.");
    }
    state.pending++;
    this.lots.set(lotId, state);
    const task = state.tail.then(operation);
    state.tail = task.catch(() => {});
    try { return await task; }
    finally {
      state.pending--;
      if (state.pending === 0 && this.lots.get(lotId) === state) this.lots.delete(lotId);
    }
  }
}
export const bidExecutionQueue = new BidExecutionQueue();
import { HttpError } from "../errors/http-error";

