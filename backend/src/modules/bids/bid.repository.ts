import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { HttpError } from "../../errors/http-error";
import { getPrisma } from "../../lib/prisma";
import type { BidRepository } from "./bid.types";
import { effectiveLotEndsAt, extendedDeadline } from "../lots/lot-deadline";

function inconsistent(): never { throw new HttpError(409, "Estado financeiro inconsistente. Lance não registrado."); }

export function createBidRepository(client: () => PrismaClient = getPrisma): BidRepository {
  return {
    async list(lotId, query) {
      return client().$transaction(async tx => {
        if (!await tx.lot.findUnique({ where: { id: lotId }, select: { id: true } })) throw new HttpError(404, "Lote não encontrado.");
        const bids = await tx.bid.findMany({ where: { lotId }, select: { id: true, lotId: true, amount: true, sequence: true, createdAt: true }, orderBy: { sequence: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit });
        return { bids, total: await tx.bid.count({ where: { lotId } }) };
      }, { isolationLevel: "RepeatableRead" });
    },
    async place(lotId, userId, amount, key, validate) {
      // The immutable ledger key binds request + original bid even when a reservation is reused.
      const requestHash = createHash("sha256").update(userId).update("\0").update(key).digest("hex");
      const requestPrefix = `bid:${requestHash}:`;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await client().$transaction(async tx => {
            const initial = await tx.lot.findUnique({ where: { id: lotId }, select: { auctionId: true } });
            if (!initial) throw new HttpError(404, "Lote não encontrado.");
            // Compatible lock order: auction -> lot -> involved wallets sorted by UUID.
            await tx.$queryRaw`SELECT "id" FROM "Auction" WHERE "id" = ${initial.auctionId}::uuid FOR UPDATE`;
            await tx.$queryRaw`SELECT "id" FROM "Lot" WHERE "id" = ${lotId}::uuid FOR UPDATE`;
            const lot = await tx.lot.findUnique({ where: { id: lotId } });
            if (!lot) throw new HttpError(404, "Lote não encontrado.");
            if (lot.auctionId !== initial.auctionId) throw new HttpError(409, "Lote alterado simultaneamente. Reenvie a requisição.");
            const auction = await tx.auction.findUnique({ where: { id: lot.auctionId } });
            const vehicle = await tx.vehicle.findUnique({ where: { id: lot.vehicleId }, select: { ownerId: true } });
            const receipt = await tx.auctionReceipt.findUnique({ where: { lotId }, select: { id: true } });
            if (!auction || !vehicle) inconsistent();
            const bidderWallet = await tx.wallet.findUnique({ where: { userId } });
            if (!bidderWallet) throw new HttpError(409, "Saldo disponível insuficiente. Consulte e credite sua carteira antes de dar lance.");
            const latest = await tx.bid.findFirst({ where: { lotId }, orderBy: { sequence: "desc" } });
            const reservations = await tx.bidReservation.findMany({ where: { lotId } });
            const active = reservations.filter(r => r.status === "ACTIVE");
            const leaderReservation = active[0];
            const walletIds = [...new Set([bidderWallet.id, ...active.map(r => r.walletId)])].sort();
            for (const id of walletIds) await tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "id" = ${id}::uuid FOR UPDATE`;
            const wallets = await tx.wallet.findMany({ where: { id: { in: walletIds } } });
            const own = wallets.find(w => w.id === bidderWallet.id);
            if (!own) inconsistent();

            // Every accepted bid increments this wallet's version, including self-raises.
            // Its lock + Serializable retry serialize identical keys even across different lots.
            const prior = await tx.walletTransaction.findMany({ where: { walletId: own.id, idempotencyKey: { startsWith: requestPrefix } }, take: 2 });
            if (prior.length > 1) inconsistent();
            if (prior[0]) {
              const record = prior[0];
              const originalId = record.idempotencyKey.slice(requestPrefix.length);
              if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(originalId)) inconsistent();
              const bid = await tx.bid.findUnique({ where: { id: originalId } });
              if (!bid || bid.userId !== userId || bid.lotId !== lotId || !bid.amount.equals(amount) || record.type !== "RESERVE" || !record.reservationId) {
                throw new HttpError(409, "Chave de idempotência já utilizada com outro valor ou lote.");
              }
              return { bid, replayed: true };
            }
            // Use the actual database clock after all blocking locks, rather than transaction start.
            // Epoch avoids driver-specific timezone conversion of raw timestamptz values.
            // Number is used only for Date milliseconds, never for financial values.
            const [clock] = await tx.$queryRaw<{ milliseconds: bigint }[]>`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS "milliseconds"`;
            const now = new Date(Number(clock.milliseconds));
            validate({ lot, auction, vehicleOwnerId: vehicle.ownerId, latest, hasReceipt: receipt !== null, now });
            if (active.length > 1 || reservations.some(r => r.status === "CAPTURED")) inconsistent();
            if (latest) {
              if (!leaderReservation || leaderReservation.bidId !== latest.id || leaderReservation.userId !== latest.userId || !leaderReservation.amount.equals(latest.amount) || !latest.amount.greaterThan(0) || latest.sequence < 1) inconsistent();
              const highest = await tx.bid.aggregate({ where: { lotId }, _max: { amount: true } });
              if (!highest._max.amount?.equals(latest.amount)) inconsistent();
            } else if (active.length) inconsistent();
            if ((latest?.sequence ?? 0) >= 2147483647 || lot.version >= 2147483647) inconsistent();

            const totals = new Map<string, Prisma.Decimal>();
            for (const wallet of wallets) {
              const invalid = await tx.bidReservation.findFirst({ where: { walletId: wallet.id, status: "ACTIVE", amount: { lte: 0 } }, select: { id: true } });
              const sum = await tx.bidReservation.aggregate({ where: { walletId: wallet.id, status: "ACTIVE" }, _sum: { amount: true } });
              const reserved = sum._sum.amount ?? new Prisma.Decimal(0);
              if (invalid || wallet.balance.isNegative() || reserved.isNegative() || reserved.greaterThan(wallet.balance) || wallet.version >= 2147483647) inconsistent();
              totals.set(wallet.id, reserved);
            }
            const position = reservations.find(r => r.walletId === own.id);
            const held = position?.status === "ACTIVE" ? position.amount : new Prisma.Decimal(0);
            const delta = amount.minus(held);
            if (!delta.greaterThan(0)) inconsistent();
            if (own.balance.minus(totals.get(own.id)!).lessThan(delta)) throw new HttpError(409, "Saldo disponível insuficiente para este lance.");
            const bid = await tx.bid.create({ data: { id: randomUUID(), userId, lotId, amount, sequence: (latest?.sequence ?? 0) + 1, createdAt: now } });

            if (leaderReservation && leaderReservation.walletId !== own.id) {
              const previousWallet = wallets.find(w => w.id === leaderReservation.walletId);
              if (!previousWallet) inconsistent();
              await tx.bidReservation.update({ where: { id: leaderReservation.id }, data: { status: "RELEASED" } });
              await tx.walletTransaction.create({ data: {
                walletId: previousWallet.id, reservationId: leaderReservation.id, type: "RELEASE", amount: leaderReservation.amount,
                balanceAfter: previousWallet.balance, idempotencyKey: `bid-release:${leaderReservation.bidId}:${bid.id}`,
              } });
              await tx.wallet.update({ where: { id: previousWallet.id }, data: { version: { increment: 1 } } });
            }
            const reservation = position
              ? await tx.bidReservation.update({ where: { id: position.id }, data: { bidId: bid.id, amount, status: "ACTIVE" } })
              : await tx.bidReservation.create({ data: { walletId: own.id, userId, lotId, bidId: bid.id, amount, status: "ACTIVE" } });
            await tx.walletTransaction.create({ data: { walletId: own.id, reservationId: reservation.id, type: "RESERVE", amount: delta, balanceAfter: own.balance, idempotencyKey: `${requestPrefix}${bid.id}` } });
            await tx.wallet.update({ where: { id: own.id }, data: { version: { increment: 1 } } });
            const previousEndsAt = effectiveLotEndsAt(lot, auction);
            const endsAt = extendedDeadline(previousEndsAt, now);
            await tx.lot.update({ where: { id: lotId }, data: { version: { increment: 1 }, ...(endsAt ? { endsAt } : {}) } });
            return { bid, replayed: false, ...(endsAt ? { extension: { lotId, previousEndsAt, endsAt, triggerBidId: bid.id } } : {}) };
          }, { isolationLevel: "Serializable" });
        } catch (error: unknown) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown } } | undefined;
            const sqlState = error.meta?.code ?? adapter?.cause?.originalCode;
            if (error.code === "P2034" || (error.code === "P2010" && ["40001", "40P01"].includes(String(sqlState)))) {
              if (attempt < 2) continue;
              throw new HttpError(409, "Conflito entre lances. Reenvie com a mesma chave de idempotência.");
            }
            if (["P2002", "P2003", "P2025"].includes(error.code)) throw new HttpError(409, "Conflito de integridade ao registrar lance.");
          }
          throw error;
        }
      }
      throw new HttpError(409, "Não foi possível registrar o lance.");
    },
  };
}
export const bidRepository = createBidRepository();
