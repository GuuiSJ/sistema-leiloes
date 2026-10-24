import { Prisma } from "../../generated/prisma/client";
import { HttpError } from "../../errors/http-error";
import { getPrisma } from "../../lib/prisma";
import type { AuctionRepository } from "./auction.types";

export const auctionRepository: AuctionRepository = {
  create(input, organizerId) {
    return getPrisma().auction.create({ data: { ...input, organizerId, status: "DRAFT" } });
  },
  async list(query) {
    const where: Prisma.AuctionWhereInput = query.status ? { status: query.status } : {};
    const [auctions, total] = await getPrisma().$transaction([
      getPrisma().auction.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      getPrisma().auction.count({ where }),
    ], { isolationLevel: "RepeatableRead" });
    return { auctions, total };
  },
  findById(id) {
    return getPrisma().auction.findUnique({ where: { id } });
  },
  async mutate(id, decide) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await getPrisma().$transaction(async (tx) => {
          // Serializa edições/cancelamentos deste leilão sem adicionar colunas.
          await tx.$queryRaw`SELECT "id" FROM "Auction" WHERE "id" = ${id}::uuid FOR UPDATE`;
          const auction = await tx.auction.findUnique({ where: { id } });
          if (!auction) throw new HttpError(404, "Leilão não encontrado.");

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
