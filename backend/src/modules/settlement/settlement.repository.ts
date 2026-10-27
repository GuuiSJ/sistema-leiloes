import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { readAuctionGeneration, isOperationalAuction } from "../temporal/auction-generation";
import { getPrisma } from "../../lib/prisma";
import { HttpError } from "../../errors/http-error";
import { effectiveLotEndsAt } from "../lots/lot-deadline";
import { prepareAuditWriter } from "../audit/opening-audit";

export interface SettlementResult {
  lot?: { lotId: string; auctionId: string; status: "SOLD" | "UNSOLD"; closedAt: string };
  auction?: { auctionId: string; lotIds: string[]; status: "CLOSED"; closedAt: string };
}
export interface SettlementRepository {
  candidates(limit: number, after?: string): Promise<{ auctionId: string; lotId: string | null }[]>;
  settle(auctionId: string, lotId: string | null): Promise<SettlementResult>;
}
function inconsistent(): never { throw new HttpError(409, "Encerramento bloqueado por inconsistência financeira ou de resultado."); }
const terminal = ["SOLD", "UNSOLD", "CANCELLED"] as const;

export function createSettlementRepository(client: () => PrismaClient = getPrisma): SettlementRepository {
  return {
    async candidates(limit, after = "") {
      // Read-only discovery intentionally includes future OPEN lots. The current adapter
      // normalizes timestamptz offsets: raw SQL date comparisons can disagree with the
      // dates used by bids. Check eligibility using the SAME ORM dates + DB epoch clock
      // inside the transaction, without rewriting legacy dates or changing global timezone.
      return client().$queryRaw<{ auctionId: string; lotId: string | null }[]>`
        SELECT * FROM (SELECT a."id" AS "auctionId", l."id" AS "lotId"
        FROM "Auction" a JOIN "Lot" l ON l."auctionId" = a."id"
        WHERE a."temporalGeneration" = 'UTC_V2' AND a."status" = 'OPEN' AND l."status" = 'OPEN'
        UNION ALL
        SELECT a."id" AS "auctionId", NULL::uuid AS "lotId" FROM "Auction" a
        WHERE a."temporalGeneration" = 'UTC_V2' AND a."status" = 'OPEN'
          AND EXISTS (SELECT 1 FROM "Lot" l WHERE l."auctionId" = a."id")
          AND NOT EXISTS (SELECT 1 FROM "Lot" l WHERE l."auctionId" = a."id" AND l."status" NOT IN ('SOLD','UNSOLD','CANCELLED'))
        ) candidates WHERE ("auctionId"::text || ':' || COALESCE("lotId"::text, '')) > ${after}
        ORDER BY "auctionId"::text || ':' || COALESCE("lotId"::text, '') LIMIT ${limit}`;
    },
    async settle(auctionId, lotId) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await client().$transaction(async tx => {
            const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Auction" WHERE "id" = ${auctionId}::uuid FOR UPDATE SKIP LOCKED`;
            if (!locked.length) return {};
            const auction = await tx.auction.findUniqueOrThrow({ where: { id: auctionId } });
            Object.assign(auction, await readAuctionGeneration(tx, auction.id));
            if (!isOperationalAuction(auction)) return {};
            if (auction.status !== "OPEN") return {};
            let result: SettlementResult = {};
            let append: Awaited<ReturnType<typeof prepareAuditWriter>> | undefined;
            const clock = async () => {
              const [time] = await tx.$queryRaw<{ milliseconds: bigint }[]>`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS "milliseconds"`;
              return new Date(Number(time.milliseconds));
            };
            let now = await clock();
            if (lotId) {
              await tx.$queryRaw`SELECT "id" FROM "Lot" WHERE "id" = ${lotId}::uuid FOR UPDATE`;
              const lot = await tx.lot.findUnique({ where: { id: lotId } });
              if (!lot || lot.auctionId !== auctionId) inconsistent();
              if (lot.status === "OPEN") {
                now = await clock();
                if (effectiveLotEndsAt(lot, auction) > now) return {};
                if (lot.winnerId !== null || lot.version >= 2147483647) inconsistent();
                const receipt = await tx.auctionReceipt.findUnique({ where: { lotId } });
                const debit = await tx.walletTransaction.findUnique({ where: { idempotencyKey: `settlement:${lotId}` } });
                const latest = await tx.bid.findFirst({ where: { lotId }, orderBy: { sequence: "desc" } });
                const reservations = await tx.bidReservation.findMany({ where: { lotId } });
                const active = reservations.filter(r => r.status === "ACTIVE");
                if (receipt || debit || reservations.some(r => r.status === "CAPTURED")) inconsistent();
                if (!latest && reservations.length) inconsistent();
                let status: "SOLD" | "UNSOLD" = "UNSOLD";
                if (latest) {
                  const held = active[0];
                  const highest = await tx.bid.aggregate({ where: { lotId }, _max: { amount: true } });
                  if (active.length !== 1 || !held || held.bidId !== latest.id || held.userId !== latest.userId || !held.amount.equals(latest.amount) || !latest.amount.greaterThan(0) || latest.sequence < 1 || !highest._max.amount?.equals(latest.amount)) inconsistent();
                  await tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "id" = ${held.walletId}::uuid FOR UPDATE`;
                  const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: held.walletId } });
                  const invalid = await tx.bidReservation.findFirst({ where: { walletId: wallet.id, status: "ACTIVE", amount: { lte: 0 } } });
                  const totals = await tx.bidReservation.aggregate({ where: { walletId: wallet.id, status: "ACTIVE" }, _sum: { amount: true } });
                  const reserved = totals._sum.amount ?? new Prisma.Decimal(0);
                  const balance = wallet.balance.minus(latest.amount);
                  if (wallet.userId !== latest.userId || invalid || wallet.balance.isNegative() || reserved.greaterThan(wallet.balance) || balance.isNegative() || balance.lessThan(reserved.minus(held.amount)) || wallet.version >= 2147483647) inconsistent();
                  const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: lot.vehicleId } });
                  // Acquire global audit lock last. Any audit failure rolls back the complete capture.
                  append = await prepareAuditWriter(tx);
                  now = await clock();
                  await tx.wallet.update({ where: { id: wallet.id }, data: { balance, version: { increment: 1 } } });
                  await tx.bidReservation.update({ where: { id: held.id }, data: { status: "CAPTURED" } });
                  await tx.walletTransaction.create({ data: { walletId: wallet.id, reservationId: held.id, type: "DEBIT", amount: latest.amount, balanceAfter: balance, idempotencyKey: `settlement:${lotId}`, createdAt: now } });
                  await tx.auctionReceipt.create({ data: { lotId, winnerId: latest.userId, winningBidId: latest.id, finalAmount: latest.amount, issuedAt: now, auctionTitle: auction.title, lotNumber: lot.number, vehicleBrand: vehicle.brand, vehicleModel: vehicle.model, vehicleYear: vehicle.year, vehicleVersion: vehicle.version } });
                  status = "SOLD";
                } else {
                  append = await prepareAuditWriter(tx); now = await clock();
                }
                await tx.lot.update({ where: { id: lotId }, data: { status, winnerId: latest?.userId ?? null, version: { increment: 1 } } });
                const data = { formatVersion: 2, auctionId, status };
                await append("LOT_CLOSED", "Lot", lotId, data, null, now);
                if (latest) {
                  await append("FUNDS_DEBITED", "Lot", lotId, data, null, now);
                  await append("RECEIPT_ISSUED", "Lot", lotId, data, null, now);
                }
                result.lot = { lotId, auctionId, status, closedAt: now.toISOString() };
              } else if (!terminal.includes(lot.status as typeof terminal[number])) return {};
            }
            const lots = await tx.lot.findMany({ where: { auctionId }, orderBy: { id: "asc" } });
            // Revalidate terminal outcomes, including after restart. Never repair partial data.
            for (const lot of lots.filter(l => terminal.includes(l.status as typeof terminal[number]))) {
              const receipt = await tx.auctionReceipt.findUnique({ where: { lotId: lot.id } });
              const debit = await tx.walletTransaction.findUnique({ where: { idempotencyKey: `settlement:${lot.id}` } });
              const reservations = await tx.bidReservation.findMany({ where: { lotId: lot.id } });
              const latest = await tx.bid.findFirst({ where: { lotId: lot.id }, orderBy: { sequence: "desc" } });
              if (reservations.some(r => r.status === "ACTIVE")) inconsistent();
              if (lot.status === "SOLD") {
                const captured = reservations.filter(r => r.status === "CAPTURED");
                const held = captured[0];
                if (!latest || !receipt || !debit || captured.length !== 1 || !held || held.bidId !== latest.id || held.userId !== latest.userId || !held.amount.equals(latest.amount) || receipt.winningBidId !== latest.id || receipt.winnerId !== lot.winnerId || lot.winnerId !== latest.userId || !receipt.finalAmount.equals(latest.amount) || debit.type !== "DEBIT" || debit.walletId !== held.walletId || debit.reservationId !== held.id || !debit.amount.equals(latest.amount)) inconsistent();
              } else if (lot.winnerId || receipt || debit || latest || reservations.length) inconsistent();
            }
            if (lots.length && lots.every(l => terminal.includes(l.status as typeof terminal[number]))) {
              append ??= await prepareAuditWriter(tx); now = await clock();
              await tx.auction.update({ where: { id: auctionId }, data: { status: "CLOSED" } });
              await append("AUCTION_CLOSED", "Auction", auctionId, { formatVersion: 2, status: "CLOSED" }, null, now);
              result.auction = { auctionId, lotIds: lots.map(l => l.id), status: "CLOSED", closedAt: now.toISOString() };
            }
            return result;
          }, { isolationLevel: "Serializable", timeout: 15000 });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown } } | undefined;
            const code = error.meta?.code ?? adapter?.cause?.originalCode;
            if ((error.code === "P2034" || (error.code === "P2010" && ["40001", "40P01"].includes(String(code)))) && attempt < 2) continue;
          }
          throw error;
        }
      }
      throw new HttpError(409, "Conflito ao encerrar lote.");
    },
  };
}
