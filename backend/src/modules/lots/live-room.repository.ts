import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../lib/prisma";
import { HttpError } from "../../errors/http-error";
import { temporalRuntime } from "../temporal/temporal-runtime";
import { effectiveLotEndsAt } from "./lot-deadline";

async function serverNow(tx: Prisma.TransactionClient) {
  const [clock] = await tx.$queryRaw<{ milliseconds: bigint }[]>`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS "milliseconds"`;
  return new Date(Number(clock!.milliseconds));
}
export function createLiveRoomRepository(client: () => PrismaClient = getPrisma, utcActive = () => temporalRuntime.utcActive) {
  return {
    async clock(lotId: string) {
      return client().$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const lot = await tx.lot.findUnique({ where: { id: lotId }, include: { auction: true } });
        if (!lot) throw new HttpError(404, "Lote não encontrado.");
        return { lotId, auctionId: lot.auctionId, lotStatus: lot.status, auctionStatus: lot.auction.status,
          endsAt: effectiveLotEndsAt(lot, lot.auction), checkedAt: await serverNow(tx),
          trusted: utcActive() && lot.auction.temporalGeneration === "UTC_V2" };
      }, { isolationLevel: "RepeatableRead" });
    },
    async position(lotId: string, userId: string) {
      return client().$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const lot = await tx.lot.findUnique({ where: { id: lotId }, select: { status: true, winnerId: true } });
        if (!lot) throw new HttpError(404, "Lote não encontrado.");
        const own = await tx.bid.findFirst({ where: { lotId, userId }, orderBy: { sequence: "desc" }, select: { id: true } });
        const latest = await tx.bid.findFirst({ where: { lotId }, orderBy: { sequence: "desc" }, select: { id: true } });
        const status = !own ? "NONE" : lot.status === "SOLD" ? (lot.winnerId === userId ? "WON" : "NOT_WON")
          : ["UNSOLD", "CANCELLED"].includes(lot.status) ? "CLOSED" : lot.status !== "OPEN" ? "RECORDED"
          : own.id === latest?.id ? "LEADING" : "OUTBID";
        return { lotId, lotStatus: lot.status, status, latestBidId: latest?.id ?? null, checkedAt: await serverNow(tx) };
      }, { isolationLevel: "RepeatableRead" });
    },
    async results(userId: string, page: number, limit: number, auctionId?: string) {
      return client().$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        if (auctionId) {
          const auction = await tx.auction.findUnique({ where: { id: auctionId }, select: { organizerId: true } });
          if (!auction) throw new HttpError(404, "Leilão não encontrado.");
          if (auction.organizerId !== userId) throw new HttpError(403, "Somente o responsável pode consultar estes resultados.");
        }
        const where: Prisma.LotWhereInput = { status: { in: ["SOLD", "UNSOLD"] }, auction: { organizerId: userId }, ...(auctionId ? { auctionId } : {}) };
        const lots = await tx.lot.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          include: { auction: { select: { title: true } }, vehicle: { select: { brand: true, model: true, year: true } }, receipt: { select: { finalAmount: true, winningBidId: true, publicId: true } } } });
        const total = await tx.lot.count({ where });
        return { data: lots.map(lot => ({ lotId: lot.id, auctionId: lot.auctionId, auctionTitle: lot.auction.title, number: lot.number, status: lot.status, vehicle: lot.vehicle,
          finalAmount: lot.status === "SOLD" ? lot.receipt?.finalAmount.toFixed(2) ?? null : null,
          winningBidId: lot.status === "SOLD" ? lot.receipt?.winningBidId ?? null : null,
          receiptPublicId: lot.status === "SOLD" ? lot.receipt?.publicId ?? null : null })),
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
      }, { isolationLevel: "RepeatableRead" });
    },
  };
}
