import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { getPrisma, disconnectDatabase } from "../src/lib/prisma";
import { createLotRepository } from "../src/modules/lots/lot.repository";
import { LotService } from "../src/modules/lots/lot.service";
import { HttpError } from "../src/errors/http-error";
import { VehicleService } from "../src/modules/vehicles/vehicle.service";
import { createVehicleRepository } from "../src/modules/vehicles/vehicle.repository";

describe("Lotes PostgreSQL concorrentes (conexões reais)", { skip: process.env.LOT_DATABASE_TESTS !== "1" }, () => {
  after(disconnectDatabase);
  // Concurrent connections need committed fixtures. Only these random IDs are
  // cleaned up; no existing user/auction/vehicle/history is selected for deletion.
  async function fixture(check: (c: { service: LotService; ownerId: string; auctionId: string; vehicleIds: string[] }) => Promise<void>) {
    const prisma = getPrisma();
    const ownerId = randomUUID(), auctionId = randomUUID();
    const vehicleIds = [randomUUID(), randomUUID()];
    await prisma.$transaction(async tx => {
      await tx.user.create({ data: { id: ownerId, name: "Fixture concorrência", email: `${ownerId}@example.invalid`, passwordHash: "unused-test-fixture", role: "AUCTIONEER" } });
      await tx.auction.create({ data: { id: auctionId, organizerId: ownerId, title: "Fixture concorrência", startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 172800000) } });
      for (const id of vehicleIds) await tx.vehicle.create({ data: { id, ownerId, brand: "Fixture", model: "Concorrência", year: 2020 } });
    });
    try { await check({ service: new LotService(createLotRepository()), ownerId, auctionId, vehicleIds }); }
    finally {
      await prisma.$transaction(async tx => {
        await tx.lot.deleteMany({ where: { auctionId } });
        await tx.vehicle.deleteMany({ where: { id: { in: vehicleIds }, ownerId } });
        await tx.auction.delete({ where: { id: auctionId } });
        await tx.user.delete({ where: { id: ownerId } });
      });
    }
  }
  const input = (vehicleId: string, number: number) => ({ vehicleId, number, startingPrice: "100.00", minimumIncrement: "1.00" });
  it("criações simultâneas com o mesmo número produzem um sucesso e um 409", async () => {
    await fixture(async ({ service, ownerId, auctionId, vehicleIds }) => {
      const results = await Promise.allSettled(vehicleIds.map(id => service.create(auctionId, input(id, 1), ownerId)));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const failure = results.find(result => result.status === "rejected"); assert(failure && failure.status === "rejected");
      assert(failure.reason instanceof HttpError); assert.equal(failure.reason.status, 409);
      assert.equal((await service.list(auctionId, { page: 1, limit: 20 })).pagination.total, 1);
    });
  });
  it("associações simultâneas do mesmo veículo produzem um sucesso e um 409", async () => {
    await fixture(async ({ service, ownerId, auctionId, vehicleIds }) => {
      const results = await Promise.allSettled([1, 2].map(number => service.create(auctionId, input(vehicleIds[0], number), ownerId)));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const failure = results.find(result => result.status === "rejected"); assert(failure && failure.status === "rejected");
      assert(failure.reason instanceof HttpError); assert.equal(failure.reason.status, 409);
    });
  });
  it("edição concorrente com exclusão não recria lote nem retorna falha interna", async () => {
    await fixture(async ({ service, ownerId, auctionId, vehicleIds }) => {
      const lot = await service.create(auctionId, input(vehicleIds[0], 1), ownerId);
      const results = await Promise.allSettled([
        service.update(auctionId, lot.id, { number: 2 }, ownerId),
        service.delete(auctionId, lot.id, ownerId),
      ]);
      for (const result of results) if (result.status === "rejected") {
        const failure = result.reason;
        assert(failure instanceof HttpError, JSON.stringify({ name: failure?.name, code: failure?.code, metaKeys: Object.keys(failure?.meta ?? {}), sqlState: failure?.meta?.code, adapterCause: failure?.meta?.driverAdapterError?.cause?.originalCode }));
        assert([404, 409].includes(failure.status));
      }
      // If retries exhausted before the delete could complete, finish it explicitly.
      if ((await service.list(auctionId, { page: 1, limit: 20 })).pagination.total) await service.delete(auctionId, lot.id, ownerId);
      assert.equal((await service.list(auctionId, { page: 1, limit: 20 })).pagination.total, 0);
    });
  });
  it("criação concorrente com exclusão do veículo não deixa lote órfão", async () => {
    await fixture(async ({ service, ownerId, auctionId, vehicleIds }) => {
      const vehicles = new VehicleService(createVehicleRepository());
      const results = await Promise.allSettled([
        service.create(auctionId, input(vehicleIds[0], 1), ownerId),
        vehicles.delete(vehicleIds[0], ownerId),
      ]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      for (const result of results) if (result.status === "rejected") {
        assert(result.reason instanceof HttpError); assert([404, 409].includes(result.reason.status));
      }
      const page = await service.list(auctionId, { page: 1, limit: 20 });
      if (page.data.length) assert(await getPrisma().vehicle.findUnique({ where: { id: page.data[0].vehicleId } }));
      else assert.equal(await getPrisma().vehicle.findUnique({ where: { id: vehicleIds[0] } }), null);
    });
  });
});
