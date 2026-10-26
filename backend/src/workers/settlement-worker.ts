import type { SettlementRepository } from "../modules/settlement/settlement.repository";
import { SettlementService } from "../modules/settlement/settlement.service";
import { HttpError } from "../errors/http-error";

export class SettlementWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = true;
  private cursor = "";
  constructor(private readonly repository: SettlementRepository, private readonly service = new SettlementService(repository), private readonly intervalMs = 1000, private readonly batchSize = 25) {}
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    void this.tick();
  }
  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = this.cycle();
    try { await this.running; } finally { this.running = undefined; }
  }
  private async cycle(): Promise<void> {
    try {
      let candidates = await this.repository.candidates(this.batchSize, this.cursor);
      if (!candidates.length && this.cursor) { this.cursor = ""; candidates = await this.repository.candidates(this.batchSize, this.cursor); }
      // Advance even on failures, so inconsistent entries cannot starve later batches.
      for (const candidate of candidates) {
        if (this.stopped) break;
        try { await this.service.process(candidate.auctionId, candidate.lotId); }
        catch (error) { console.error("Encerramento não aplicado; verificar consistência e disponibilidade.", { code: error instanceof HttpError && error.status === 409 ? "SETTLEMENT_INCONSISTENT" : "SETTLEMENT_FAILED", auctionId: candidate.auctionId, lotId: candidate.lotId }); }
        this.cursor = `${candidate.auctionId}:${candidate.lotId ?? ""}`;
      }
    } catch { console.error("Falha ao consultar candidatos ao encerramento."); }
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
