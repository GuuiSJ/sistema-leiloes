import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { getPrisma, disconnectDatabase } from "../src/lib/prisma";
import { createVehicleRepository } from "../src/modules/vehicles/vehicle.repository";
import { VehicleService } from "../src/modules/vehicles/vehicle.service";
import { validateCreate } from "../src/modules/vehicles/vehicle.validation";
import { HttpError } from "../src/errors/http-error";

// Explicit opt-in. Every fixture and mutation is rolled back, including failures.
describe("Veículos PostgreSQL (transações com rollback)", { skip: process.env.VEHICLE_DATABASE_TESTS !== "1" }, () => {
  after(disconnectDatabase);
  async function fixture(check: (context: {
    tx: Prisma.TransactionClient; service: VehicleService; ownerId: string; otherId: string;
    vehicleId: string; auctionId: string;
  }) => Promise<void>) {
    const rollback = new Error("rollback de fixtures");
    try {
      await getPrisma().$transaction(async tx => {
        const ownerId = randomUUID(), otherId = randomUUID();
        for (const id of [ownerId, otherId]) await tx.user.create({ data: { id, name: "Fixture", email: `${id}@example.invalid`, passwordHash: "unused-test-fixture", role: "AUCTIONEER" } });
        // Reuse the real repository queries inside the surrounding rollback transaction.
        // Nested Prisma transactions are replaced by the existing transaction scope.
        const scoped = {
          vehicle: tx.vehicle,
          $transaction: async (operation: ((db: Prisma.TransactionClient) => Promise<unknown>) | Promise<unknown>[]) =>
            Array.isArray(operation) ? Promise.all(operation) : operation(tx),
        } as unknown as PrismaClient;
        const service = new VehicleService(createVehicleRepository(() => scoped));
        const vehicle = await service.create(validateCreate({ brand: "Fixture", model: "Teste", year: 2020, imageUrls: [] }), ownerId);
        const auction = await tx.auction.create({ data: { organizerId: ownerId, title: "Fixture", startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 172800000) } });
        await check({ tx, service, ownerId, otherId, vehicleId: vehicle.id, auctionId: auction.id });
        throw rollback;
      }, { isolationLevel: "Serializable", timeout: 15000 });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;
  const lotData = (vehicleId: string, auctionId: string) => ({ vehicleId, auctionId, number: 1, startingPrice: "100", minimumIncrement: "10" });

  it("persiste proprietário, edita, filtra, omite dados privados e exclui sem vínculos", async () => {
    await fixture(async ({ tx, service, ownerId, vehicleId }) => {
      assert.equal((await tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).ownerId, ownerId);
      const updated = await service.update(vehicleId, { brand: "Marca revisada" }, ownerId);
      assert.equal(updated.brand, "Marca revisada");
      assert.equal("ownerId" in updated, false);
      const page = await service.list({ page: 1, limit: 20, brand: "MARCA REVISADA", model: "tes", year: 2020 });
      assert(page.data.some(vehicle => vehicle.id === vehicleId));
      assert.equal("ownerId" in page.data[0], false);
      await service.delete(vehicleId, ownerId);
      assert.equal(await tx.vehicle.findUnique({ where: { id: vehicleId } }), null);
    });
  });
  it("proíbe mutações por outro leiloeiro no repositório real", async () => {
    await fixture(async ({ service, otherId, vehicleId }) => {
      await assert.rejects(service.update(vehicleId, { year: 2021 }, otherId), status(403));
      await assert.rejects(service.delete(vehicleId, otherId), status(403));
    });
  });
  it("permite edição com lote pendente futuro e bloqueia exclusão", async () => {
    await fixture(async ({ tx, service, ownerId, vehicleId, auctionId }) => {
      await tx.lot.create({ data: lotData(vehicleId, auctionId) });
      await service.update(vehicleId, { year: 2021 }, ownerId);
      await assert.rejects(service.delete(vehicleId, ownerId), status(409));
      assert.equal(await tx.lot.count({ where: { vehicleId } }), 1);
    });
  });
  it("bloqueia edição para leilão aberto ou início já alcançado", async () => {
    await fixture(async ({ tx, service, ownerId, vehicleId, auctionId }) => {
      await tx.lot.create({ data: lotData(vehicleId, auctionId) });
      await tx.auction.update({ where: { id: auctionId }, data: { status: "OPEN" } });
      await assert.rejects(service.update(vehicleId, { year: 2021 }, ownerId), status(409));
      await tx.auction.update({ where: { id: auctionId }, data: { status: "DRAFT", startsAt: new Date(Date.now() - 1000) } });
      await assert.rejects(service.update(vehicleId, { year: 2021 }, ownerId), status(409));
    });
  });
  it("bloqueia edição quando há lance mesmo em lote pendente", async () => {
    await fixture(async ({ tx, service, ownerId, otherId, vehicleId, auctionId }) => {
      const lot = await tx.lot.create({ data: lotData(vehicleId, auctionId) });
      await tx.bid.create({ data: { lotId: lot.id, userId: otherId, amount: "100", sequence: 1 } });
      await assert.rejects(service.update(vehicleId, { year: 2021 }, ownerId), status(409));
      await assert.rejects(service.delete(vehicleId, ownerId), status(409));
      assert.equal(await tx.bid.count({ where: { lotId: lot.id } }), 1);
    });
  });
  it("preserva auditoria genérica mesmo sem lote associado", async () => {
    await fixture(async ({ tx, service, ownerId, vehicleId }) => {
      const audit = await tx.auditEvent.create({ data: { action: "LOT_CREATED", entityType: "Vehicle", entityId: vehicleId, currentHash: randomUUID().replaceAll("-", "").repeat(2) } });
      await assert.rejects(service.update(vehicleId, { year: 2021 }, ownerId), status(409));
      await assert.rejects(service.delete(vehicleId, ownerId), status(409));
      assert(await tx.auditEvent.findUnique({ where: { id: audit.id } }));
    });
  });
  it("banco exige proprietário existente e impede apagar usuário proprietário", async () => {
    await fixture(async ({ tx, ownerId, auctionId }) => {
      await tx.auction.delete({ where: { id: auctionId } });
      // Savepoints let us inspect rejected statements without aborting the fixture transaction.
      await tx.$executeRawUnsafe("SAVEPOINT owner_fk");
      await assert.rejects(tx.user.delete({ where: { id: ownerId } }), (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003");
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT owner_fk");
      await assert.rejects(tx.vehicle.create({ data: { brand: "Fixture", model: "Teste", year: 2020, ownerId: randomUUID() } }), (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003");
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT owner_fk");
    });
  });
});
