import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../lib/prisma";
import { HttpError } from "../../errors/http-error";
import type { LotRepository } from "./lot.types";

export function createLotRepository(client: () => PrismaClient = getPrisma): LotRepository {
  return {
    async list(auctionId, query) {
      return client().$transaction(async tx => {
        if (!await tx.auction.findUnique({ where: { id: auctionId }, select: { id: true } })) throw new HttpError(404, "Leilão não encontrado.");
        const where = { auctionId };
        const lots = await tx.lot.findMany({ where, include: { vehicle: true }, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ number: "asc" }, { id: "asc" }] });
        const total = await tx.lot.count({ where });
        return { lots, total };
      }, { isolationLevel: "RepeatableRead" });
    },
    findById(auctionId, lotId) {
      return client().lot.findFirst({ where: { id: lotId, auctionId }, include: { vehicle: true } });
    },
    async write(command, validate) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await client().$transaction(async tx => {
            const initial = command.operation === "create" ? null : await tx.lot.findFirst({ where: { id: command.lotId, auctionId: command.auctionId } });
            if (command.operation !== "create" && !initial) throw new HttpError(404, "Lote não encontrado neste leilão.");
            const vehicleId = command.operation === "delete" ? initial!.vehicleId : command.input.vehicleId ?? initial!.vehicleId;
            // Same lock order as vehicle mutations: vehicles -> auction -> lot.
            // Lock old and new vehicles in UUID order during swaps.
            for (const id of [...new Set([vehicleId, ...(initial ? [initial.vehicleId] : [])])].sort()) {
              await tx.$queryRaw`SELECT "id" FROM "Vehicle" WHERE "id" = ${id}::uuid FOR UPDATE`;
            }
            await tx.$queryRaw`SELECT "id" FROM "Auction" WHERE "id" = ${command.auctionId}::uuid FOR UPDATE`;
            const auction = await tx.auction.findUnique({ where: { id: command.auctionId } });
            if (!auction) throw new HttpError(404, "Leilão não encontrado.");
            if (initial) await tx.$queryRaw`SELECT "id" FROM "Lot" WHERE "id" = ${initial.id}::uuid FOR UPDATE`;
            const lot = initial ? await tx.lot.findFirst({
              where: { id: initial.id, auctionId: command.auctionId },
              include: { _count: { select: { bids: true, reservations: true } }, receipt: { select: { id: true } } },
            }) : null;
            if (initial && !lot) throw new HttpError(404, "Lote não encontrado neste leilão.");
            if (initial && lot!.vehicleId !== initial.vehicleId) throw new HttpError(409, "Lote alterado simultaneamente. Tente novamente.");
            const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
            if (!vehicle) throw new HttpError(404, "Veículo não encontrado.");
            const currentVehicle = initial ? await tx.vehicle.findUnique({ where: { id: initial.vehicleId } }) : null;
            if (initial && !currentVehicle) throw new HttpError(409, "Veículo associado não está disponível.");
            const audit = lot ? await tx.auditEvent.findFirst({ where: { entityId: lot.id }, select: { id: true } }) : null;
            validate({ auction, lot, vehicle, currentVehicle, hasHistory: !!lot && (lot._count.bids > 0 || lot._count.reservations > 0 || lot.receipt !== null || audit !== null) });
            if (command.operation === "create") {
              return tx.lot.create({ data: { ...command.input, auctionId: command.auctionId, status: "PENDING" }, include: { vehicle: true } });
            }
            if (command.operation === "delete") return tx.lot.delete({ where: { id: command.lotId }, include: { vehicle: true } });
            return tx.lot.update({ where: { id: command.lotId }, data: { ...command.input, version: { increment: 1 } }, include: { vehicle: true } });
          }, { isolationLevel: "Serializable" });
        } catch (error: unknown) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            const adapterError = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown } } | undefined;
            const sqlState = error.meta?.code ?? adapterError?.cause?.originalCode;
            const rawConflict = error.code === "P2010" && ["40001", "40P01"].includes(String(sqlState));
            if (error.code === "P2034" || rawConflict) {
              if (attempt < 2) continue;
              throw new HttpError(409, "Lote alterado simultaneamente. Tente novamente.");
            }
            if (error.code === "P2002") throw new HttpError(409, "Número ou veículo já associado a este leilão.");
            if (error.code === "P2003" || error.code === "P2025") throw new HttpError(409, "Lote possui vínculos ou foi alterado simultaneamente.");
          }
          throw error;
        }
      }
      throw new HttpError(409, "Não foi possível concluir a operação.");
    },
  };
}
export const lotRepository = createLotRepository();
