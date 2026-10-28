import type { PrismaClient } from "../generated/prisma/client";
import { getPrisma } from "../lib/prisma";
import { HttpError } from "../errors/http-error";
import { AuctionLifecycleService } from "../modules/auctions/auction-lifecycle.service";
import { createAuctionLifecycleRepository } from "../modules/auctions/auction-lifecycle.repository";
import { temporalRuntime } from "../modules/temporal/temporal-runtime";

export interface ScheduledOpeningSource {
  due(limit: number, after: string): Promise<{ id: string; organizerId: string }[]>;
}
export function createScheduledOpeningSource(client: () => PrismaClient = getPrisma): ScheduledOpeningSource {
  return { due: (limit, after) => client().$queryRaw<{ id: string; organizerId: string }[]>`
    SELECT "id", "organizerId" FROM "Auction"
    WHERE "temporalGeneration" = 'UTC_V2' AND "status" = 'SCHEDULED'
      AND "startsAt" <= clock_timestamp() AND "endsAt" > clock_timestamp()
      AND "id"::text > ${after}
    ORDER BY "id"::text LIMIT ${limit}` };
}
// One processing step in the existing worker, not another timer or scheduler.
export function createScheduledOpeningProcessor(
  source: ScheduledOpeningSource = createScheduledOpeningSource(),
  service: Pick<AuctionLifecycleService, "transition"> = new AuctionLifecycleService(createAuctionLifecycleRepository(getPrisma, undefined, { automated: true })),
) {
  let cursor = "";
  return async (limit: number, active: () => boolean = () => temporalRuntime.workerReady) => {
    if (!active()) return;
    let candidates = await source.due(limit, cursor);
    if (!candidates.length && cursor) { cursor = ""; candidates = await source.due(limit, cursor); }
    for (const candidate of candidates) {
      if (!active()) break;
      try {
        // Reuses ownership, generation, dates, lot/history checks, locks and audit.
        const result = await service.transition(candidate.id, "open", candidate.organizerId);
        if (!result.unchanged) console.log("Leilão aberto automaticamente.", { auctionId: candidate.id, openedLots: result.openedLots });
      } catch (error) {
        console.error("Abertura automática não aplicada.", { auctionId: candidate.id, code: error instanceof HttpError && error.status === 409 ? "OPENING_BLOCKED" : "OPENING_FAILED" });
      }
      cursor = candidate.id;
    }
  };
}
