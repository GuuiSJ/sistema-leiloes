import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../lib/prisma";
import { HttpError } from "../../errors/http-error";
import type { VehicleRepository } from "./vehicle.types";

export function createVehicleRepository(client: () => PrismaClient = getPrisma): VehicleRepository {
  return {
    create(input, ownerId) {
      // Cadastro manual: nunca atestar consulta externa a partir de dados do cliente.
      return client().vehicle.create({ data: { ...input, ownerId, fipeConsultedAt: null } });
    },
    async list(query) {
      const where: Prisma.VehicleWhereInput = {};
      if (query.brand) where.brand = { contains: query.brand, mode: "insensitive" };
      if (query.model) where.model = { contains: query.model, mode: "insensitive" };
      if (query.year) where.year = query.year;
      const prisma = client();
      const [vehicles, total] = await prisma.$transaction([
        prisma.vehicle.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
        prisma.vehicle.count({ where }),
      ], { isolationLevel: "RepeatableRead" });
      return { vehicles, total };
    },
    findById(id) { return client().vehicle.findUnique({ where: { id } }); },
    async mutate(id, decide) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await client().$transaction(async tx => {
            // Row locks protect dependency checks from concurrent FK inserts.
            await tx.$queryRaw`SELECT "id" FROM "Vehicle" WHERE "id" = ${id}::uuid FOR UPDATE`;
            const vehicle = await tx.vehicle.findUnique({ where: { id } });
            if (!vehicle) throw new HttpError(404, "Veículo não encontrado.");
            await tx.$queryRaw`
              SELECT a."id" FROM "Auction" a
              WHERE EXISTS (SELECT 1 FROM "Lot" l WHERE l."auctionId" = a."id" AND l."vehicleId" = ${id}::uuid)
              ORDER BY a."id" FOR UPDATE`;
            await tx.$queryRaw`SELECT "id" FROM "Lot" WHERE "vehicleId" = ${id}::uuid ORDER BY "id" FOR UPDATE`;
            const lots = await tx.lot.findMany({
              where: { vehicleId: id },
              select: {
                id: true, status: true, winnerId: true,
                auction: { select: { status: true, startsAt: true, endsAt: true } },
                _count: { select: { bids: true, reservations: true } },
                receipt: { select: { id: true } },
              },
            });
            // AuditEvent is a generic reference without FK; never delete its history.
            const audit = await tx.auditEvent.findFirst({
              where: { entityId: { in: [id, ...lots.map(lot => lot.id)] } },
              select: { id: true },
            });
            const decision = decide({
              vehicle,
              lots: lots.map(lot => ({
                status: lot.status, winnerId: lot.winnerId, auction: lot.auction,
                hasHistory: lot._count.bids > 0 || lot._count.reservations > 0 || lot.receipt !== null,
              })),
              hasAuditHistory: audit !== null,
            });
            if (decision.operation === "delete") return tx.vehicle.delete({ where: { id } });
            // A manually revised FIPE reference still does not attest an external consultation.
            return tx.vehicle.update({ where: { id }, data: { ...decision.data, fipeConsultedAt: null } });
          }, { isolationLevel: "Serializable" });
        } catch (error: unknown) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            // Raw locking queries can report PostgreSQL serialization/deadlock codes via P2010.
            const adapterError = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown } } | undefined;
            const sqlState = error.meta?.code ?? adapterError?.cause?.originalCode;
            const rawConflict = error.code === "P2010" && ["40001", "40P01"].includes(String(sqlState));
            if (error.code === "P2034" || rawConflict) {
              if (attempt < 2) continue;
              throw new HttpError(409, "Veículo alterado simultaneamente. Tente novamente.");
            }
            if (error.code === "P2003") throw new HttpError(409, "Veículo possui vínculos que impedem a operação.");
          }
          throw error;
        }
      }
      throw new HttpError(409, "Não foi possível concluir a alteração.");
    },
  };
}

export const vehicleRepository = createVehicleRepository();
