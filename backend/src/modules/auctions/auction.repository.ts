import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { HttpError } from "../../errors/http-error";
import { readAuctionGeneration, requireOperationalAuction, rejectClientGeneration } from "../temporal/auction-generation";
import { getPrisma } from "../../lib/prisma";
import type { AuctionRepository } from "./auction.types";
import { temporalRuntime, type TemporalRuntime } from "../temporal/temporal-runtime";

export function createAuctionRepository(client: () => PrismaClient = getPrisma, runtime: Pick<TemporalRuntime, "creationGeneration"> = temporalRuntime): AuctionRepository {
  return {
    create(input, organizerId) {
      rejectClientGeneration(input);
      const generation = runtime.creationGeneration();
      // Transitional spread compiles with the old client; startup rejects UTC until regeneration.
      const data = { ...input, organizerId, status: "DRAFT" as const, ...(generation ? { temporalGeneration: generation } : {}) };
      return client().auction.create({ data });
    },
    async list(query) {
      const where: Prisma.AuctionWhereInput = query.status ? { status: query.status } : {};
      const [auctions, total] = await client().$transaction([
        client().auction.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        client().auction.count({ where }),
      ], { isolationLevel: "RepeatableRead" });
      return { auctions, total };
    },
    findById(id) {
      return client().auction.findUnique({ where: { id } });
    },
    async mutate(id, decide) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await client().$transaction(async (tx) => {
            // Serializa edições/cancelamentos deste leilão sem adicionar colunas.
            await tx.$queryRaw`SELECT "id" FROM "Auction" WHERE "id" = ${id}::uuid FOR UPDATE`;
            const auction = await tx.auction.findUnique({ where: { id } });
            if (!auction) throw new HttpError(404, "Leilão não encontrado.");
            Object.assign(auction, await readAuctionGeneration(tx, auction.id));
  
            // Conservador: não cancelar qualquer histórico de lance/reserva/arrematação.
            const incompatibleLot = await tx.lot.findFirst({
              where: {
                auctionId: id,
                OR: [
                  { bids: { some: {} } },
                  { reservations: { some: {} } },
                  { receipt: { isNot: null } },
                  { status: { notIn: ["PENDING", "CANCELLED"] } },
                ],
              },
              select: { id: true },
            });
            const data = decide({ auction, hasIncompatibleOperations: incompatibleLot !== null });
            rejectClientGeneration(data);
            requireOperationalAuction(auction);
            return tx.auction.update({ where: { id }, data });
          }, { isolationLevel: "Serializable" });
        } catch (error: unknown) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
            if (attempt < 2) continue;
            throw new HttpError(409, "Leilão alterado simultaneamente. Tente novamente.");
          }
          throw error;
        }
      }
      throw new HttpError(409, "Não foi possível concluir a alteração.");
    },
  };
}
export const auctionRepository = createAuctionRepository();
