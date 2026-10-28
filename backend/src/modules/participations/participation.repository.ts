import { getPrisma } from "../../lib/prisma";
import type { PrismaClient } from "../../generated/prisma/client";
import { effectiveLotEndsAt } from "../lots/lot-deadline";

export function createParticipationRepository(client: () => PrismaClient = getPrisma) {
  return {
    async list(userId: string, page: number, limit: number) {
      return client().$transaction(async tx => {
        const where = { bids: { some: { userId } } };
        const lots = await tx.lot.findMany({ where, skip: (page - 1) * limit, take: limit,
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          include: {
            auction: { select: { id: true, title: true, endsAt: true } },
            vehicle: { select: { brand: true, model: true, year: true, version: true } },
            bids: { where: { userId }, orderBy: { sequence: "desc" }, take: 1 },
            _count: { select: { bids: { where: { userId } } } },
            receipt: true,
          },
        });
        const total = await tx.lot.count({ where });
        const data = lots.map(lot => {
          const bid = lot.bids[0]!;
          const won = lot.status === "SOLD" && lot.winnerId === userId;
          return {
            auction: { id: lot.auction.id, title: lot.auction.title },
            lot: { id: lot.id, number: lot.number, status: lot.status, endsAt: effectiveLotEndsAt(lot, lot.auction) },
            vehicle: lot.vehicle,
            myBid: { id: bid.id, amount: bid.amount.toFixed(2), createdAt: bid.createdAt },
            bidCount: lot._count.bids,
            outcome: lot.status === "SOLD" ? (won ? "WON" : "NOT_WON") : lot.status === "CANCELLED" ? "CANCELLED" : lot.status === "UNSOLD" ? "UNSOLD" : "IN_PROGRESS",
            finalAmount: lot.receipt?.finalAmount.toFixed(2) ?? null,
            receiptPublicId: won ? lot.receipt?.publicId ?? null : null,
          };
        });
        return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
      }, { isolationLevel: "RepeatableRead" });
    },
  };
}
export type ParticipationRepository = ReturnType<typeof createParticipationRepository>;
