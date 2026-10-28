import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { HttpError } from "../../errors/http-error";
import { readAuctionGeneration, requireOperationalAuction } from "../temporal/auction-generation";
import { getPrisma } from "../../lib/prisma";
import type { AuctionLifecycleRepository, PrepareOpeningAudit } from "./auction-lifecycle.types";
import { prepareOpeningAudit } from "../audit/opening-audit";

export function createAuctionLifecycleRepository(client: () => PrismaClient = getPrisma, prepareAudit: PrepareOpeningAudit = prepareOpeningAudit, options: { automated?: boolean } = {}): AuctionLifecycleRepository {
  return {
    async transition(id, operation, authorId, decide) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await client().$transaction(async tx => {
            // Compatible with vehicle/lot mutations: vehicles -> auction -> lots.
            const initialLots = await tx.lot.findMany({ where: { auctionId: id }, select: { id: true, vehicleId: true } });
            for (const vehicleId of [...new Set(initialLots.map(lot => lot.vehicleId))].sort()) {
              await tx.$queryRaw`SELECT "id" FROM "Vehicle" WHERE "id" = ${vehicleId}::uuid FOR UPDATE`;
            }
            await tx.$queryRaw`SELECT "id" FROM "Auction" WHERE "id" = ${id}::uuid FOR UPDATE`;
            const auction = await tx.auction.findUnique({ where: { id } });
            if (!auction) throw new HttpError(404, "Leilão não encontrado.");
            Object.assign(auction, await readAuctionGeneration(tx, auction.id));
            if (auction.organizerId !== authorId) throw new HttpError(403, "Somente o responsável pode agendar ou abrir este leilão.");
            requireOperationalAuction(auction);
            await tx.$queryRaw`SELECT "id" FROM "Lot" WHERE "auctionId" = ${id}::uuid ORDER BY "id" FOR UPDATE`;
            const lots = await tx.lot.findMany({ where: { auctionId: id }, orderBy: { id: "asc" } });
            if (lots.some(lot => !initialLots.some(initial => initial.id === lot.id && initial.vehicleId === lot.vehicleId)) || lots.length !== initialLots.length) {
              throw new HttpError(409, "Lotes alterados simultaneamente. Reenvie a transição.");
            }
            const stateLots = [];
            for (const lot of lots) {
              const vehicle = await tx.vehicle.findUnique({ where: { id: lot.vehicleId }, select: { ownerId: true } });
              const history = await tx.bid.findFirst({ where: { lotId: lot.id }, select: { id: true } });
              const reservation = await tx.bidReservation.findFirst({ where: { lotId: lot.id }, select: { id: true } });
              const receipt = await tx.auctionReceipt.findUnique({ where: { lotId: lot.id }, select: { id: true } });
              stateLots.push({ ...lot, vehicleOwnerId: vehicle?.ownerId ?? "", hasFinancialHistory: !!(history || reservation || receipt) });
            }
            const clock = async () => {
              const [time] = await tx.$queryRaw<{ milliseconds: bigint }[]>`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS "milliseconds"`;
              return new Date(Number(time.milliseconds));
            };
            let now = await clock();
            let decision = decide({ auction, lots: stateLots, now });
            if (decision.unchanged) return { auction, openedLots: 0, unchanged: true };
            let appendAudit: Awaited<ReturnType<PrepareOpeningAudit>> | undefined;
            if (operation === "open") {
              appendAudit = await prepareAudit(tx);
              // Audit lock may have waited; recheck the real clock before opening anything.
              now = await clock();
              decision = decide({ auction, lots: stateLots, now });
            }
            const updated = await tx.auction.update({ where: { id }, data: { status: decision.status } });
            if (decision.openLotIds.length) {
              const result = await tx.lot.updateMany({ where: { id: { in: decision.openLotIds }, auctionId: id, status: "PENDING" }, data: { status: "OPEN", version: { increment: 1 } } });
              if (result.count !== decision.openLotIds.length) throw new HttpError(409, "Lotes alterados simultaneamente. Nenhuma abertura foi aplicada.");
              await appendAudit!(updated, stateLots.filter(lot => decision.openLotIds.includes(lot.id)), options.automated ? null : authorId, now);
            }
            return { auction: updated, openedLots: decision.openLotIds.length, unchanged: false };
          }, { isolationLevel: "Serializable" });
        } catch (error: unknown) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown } } | undefined;
            const sqlState = error.meta?.code ?? adapter?.cause?.originalCode;
            if (error.code === "P2034" || (error.code === "P2010" && ["40001", "40P01"].includes(String(sqlState)))) {
              if (attempt < 2) continue;
              throw new HttpError(409, "Transição concorrente. Reenvie a requisição.");
            }
            if (["P2002", "P2003", "P2025"].includes(error.code)) throw new HttpError(409, "Conflito de integridade na transição.");
          }
          throw error;
        }
      }
      throw new HttpError(409, "Não foi possível concluir a transição.");
    },
  };
}
export const auctionLifecycleRepository = createAuctionLifecycleRepository();
