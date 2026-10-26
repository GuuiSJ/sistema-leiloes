import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { getPrisma, disconnectDatabase } from "../src/lib/prisma";
import { createLotRepository } from "../src/modules/lots/lot.repository";
import { LotService } from "../src/modules/lots/lot.service";
import { HttpError } from "../src/errors/http-error";

describe("Lotes PostgreSQL (fixtures com rollback)", { skip: process.env.LOT_DATABASE_TESTS !== "1" }, () => {
  after(disconnectDatabase);
  async function fixture(check: (c: {
    tx: Prisma.TransactionClient; service: LotService; ownerId: string; otherId: string;
    auctionId: string; vehicleId: string; secondVehicleId: string; foreignVehicleId: string;
  }) => Promise<void>) {
    const rollback = new Error("rollback de fixtures de lotes");
    try {
      await getPrisma().$transaction(async tx => {
        const ownerId = randomUUID(), otherId = randomUUID();
        for (const id of [ownerId, otherId]) await tx.user.create({ data: { id, name: "Fixture lote", email: `${id}@example.invalid`, passwordHash: "unused-test-fixture", role: "AUCTIONEER" } });
        const auction = await tx.auction.create({ data: { organizerId: ownerId, title: "Fixture lotes", startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 172800000) } });
        const vehicles = [];
        for (const owner of [ownerId, ownerId, otherId]) vehicles.push(await tx.vehicle.create({ data: { ownerId: owner, brand: "Fixture", model: "Lote", year: 2020 } }));
        // Use real queries in the surrounding rollback scope. Savepoints recover
        // expected constraint failures without aborting the fixture transaction.
        const scoped = {
          lot: tx.lot,
          $transaction: async (operation: (db: Prisma.TransactionClient) => Promise<unknown>) => {
            await tx.$executeRawUnsafe("SAVEPOINT lot_operation");
            try {
              const result = await operation(tx);
              await tx.$executeRawUnsafe("RELEASE SAVEPOINT lot_operation");
              return result;
            } catch (error) {
              await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT lot_operation");
              await tx.$executeRawUnsafe("RELEASE SAVEPOINT lot_operation");
              throw error;
            }
          },
        } as unknown as PrismaClient;
        await check({ tx, service: new LotService(createLotRepository(() => scoped)), ownerId, otherId, auctionId: auction.id, vehicleId: vehicles[0].id, secondVehicleId: vehicles[1].id, foreignVehicleId: vehicles[2].id });
        throw rollback;
      }, { isolationLevel: "Serializable", timeout: 20000 });
    } catch (error) { if (error !== rollback) throw error; }
  }
  const input = (vehicleId: string, number = 1) => ({ vehicleId, number, startingPrice: "9999999999999999.99", minimumIncrement: "0.01" });
  const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;

  it("cria, consulta, lista, edita e exclui sem apagar veículo ou leilão", async () => {
    await fixture(async ({ tx, service, ownerId, auctionId, vehicleId, secondVehicleId }) => {
      const lot = await service.create(auctionId, input(vehicleId, 10), ownerId);
      assert.equal(lot.status, "PENDING"); assert.equal(lot.startingPrice, "9999999999999999.99"); assert.equal(lot.minimumIncrement, "0.01");
      assert.equal("ownerId" in lot.vehicle, false);
      await service.create(auctionId, input(secondVehicleId, 2), ownerId);
      const page = await service.list(auctionId, { page: 1, limit: 1 }); assert.equal(page.data[0].number, 2); assert.equal(page.pagination.total, 2);
      const detail = await service.findById(auctionId, lot.id); assert.equal(detail.vehicle.id, vehicleId);
      const updated = await service.update(auctionId, lot.id, { number: 20, startingPrice: "0.01" }, ownerId);
      assert.equal(updated.number, 20); assert.equal(updated.startingPrice, "0.01"); assert.equal((await tx.lot.findUniqueOrThrow({ where: { id: lot.id } })).version, 1);
      await service.delete(auctionId, lot.id, ownerId);
      assert.equal(await tx.lot.findUnique({ where: { id: lot.id } }), null);
      assert(await tx.vehicle.findUnique({ where: { id: vehicleId } })); assert(await tx.auction.findUnique({ where: { id: auctionId } }));
    });
  });
  it("respeita unicidades de número e veículo na criação e troca", async () => {
    await fixture(async ({ service, ownerId, auctionId, vehicleId, secondVehicleId }) => {
      await service.create(auctionId, input(vehicleId), ownerId);
      await assert.rejects(service.create(auctionId, input(secondVehicleId), ownerId), status(409));
      await assert.rejects(service.create(auctionId, input(vehicleId, 2), ownerId), status(409));
      const second = await service.create(auctionId, input(secondVehicleId, 2), ownerId);
      await assert.rejects(service.update(auctionId, second.id, { number: 1 }, ownerId), status(409));
      await assert.rejects(service.update(auctionId, second.id, { vehicleId }, ownerId), status(409));
      assert.equal((await service.findById(auctionId, second.id)).number, 2);
    });
  });
  it("verifica dono do leilão e dos veículos antigo e novo", async () => {
    await fixture(async ({ tx, service, ownerId, otherId, auctionId, vehicleId, secondVehicleId, foreignVehicleId }) => {
      await assert.rejects(service.create(auctionId, input(vehicleId), otherId), status(403));
      await assert.rejects(service.create(auctionId, input(foreignVehicleId), ownerId), status(403));
      const lot = await service.create(auctionId, input(vehicleId), ownerId);
      await assert.rejects(service.update(auctionId, lot.id, { vehicleId: foreignVehicleId }, ownerId), status(403));
      await assert.rejects(service.delete(auctionId, lot.id, otherId), status(403));
      await tx.vehicle.update({ where: { id: vehicleId }, data: { ownerId: otherId } });
      await assert.rejects(service.update(auctionId, lot.id, { vehicleId: secondVehicleId }, ownerId), status(403));
    });
  });
  it("troca veículo do mesmo dono e mantém limites do escopo do leilão", async () => {
    await fixture(async ({ service, ownerId, auctionId, vehicleId, secondVehicleId }) => {
      const lot = await service.create(auctionId, input(vehicleId), ownerId);
      assert.equal((await service.update(auctionId, lot.id, { vehicleId: secondVehicleId }, ownerId)).vehicle.id, secondVehicleId);
      await assert.rejects(service.findById(randomUUID(), lot.id), status(404));
      await assert.rejects(service.update(randomUUID(), lot.id, { number: 2 }, ownerId), status(404));
      await assert.rejects(service.delete(randomUUID(), lot.id, ownerId), status(404));
      await assert.rejects(service.list(randomUUID(), { page: 1, limit: 20 }), status(404));
    });
  });
  it("bloqueia mutações após mudança de estado do leilão ou do lote", async () => {
    await fixture(async ({ tx, service, ownerId, auctionId, vehicleId, secondVehicleId }) => {
      const lot = await service.create(auctionId, input(vehicleId), ownerId);
      await tx.auction.update({ where: { id: auctionId }, data: { status: "SCHEDULED" } });
      await assert.rejects(service.create(auctionId, input(secondVehicleId, 2), ownerId), status(409));
      await assert.rejects(service.update(auctionId, lot.id, { number: 2 }, ownerId), status(409));
      await assert.rejects(service.delete(auctionId, lot.id, ownerId), status(409));
      await tx.auction.update({ where: { id: auctionId }, data: { status: "DRAFT", startsAt: new Date(Date.now() - 1000) } });
      await assert.rejects(service.delete(auctionId, lot.id, ownerId), status(409));
      await tx.auction.update({ where: { id: auctionId }, data: { startsAt: new Date(Date.now() + 86400000) } });
      await tx.lot.update({ where: { id: lot.id }, data: { status: "CANCELLED" } });
      await assert.rejects(service.delete(auctionId, lot.id, ownerId), status(409));
    });
  });
  it("preserva lances, reservas, recibos e dados financeiros existentes no lote", async () => {
    await fixture(async ({ tx, service, ownerId, otherId, auctionId, vehicleId }) => {
      const lot = await service.create(auctionId, input(vehicleId), ownerId);
      const bid = await tx.bid.create({ data: { userId: otherId, lotId: lot.id, amount: "100", sequence: 1 } });
      const wallet = await tx.wallet.create({ data: { userId: otherId, balance: "100" } });
      const reservation = await tx.bidReservation.create({ data: { walletId: wallet.id, userId: otherId, lotId: lot.id, bidId: bid.id, amount: "100" } });
      const transaction = await tx.walletTransaction.create({ data: { walletId: wallet.id, reservationId: reservation.id, type: "RESERVE", amount: "100", balanceAfter: "100", idempotencyKey: randomUUID() } });
      const receipt = await tx.auctionReceipt.create({ data: { lotId: lot.id, winnerId: otherId, winningBidId: bid.id, finalAmount: "100", auctionTitle: "Fixture", lotNumber: 1, vehicleBrand: "Fixture", vehicleModel: "Lote", vehicleYear: 2020 } });
      await assert.rejects(service.update(auctionId, lot.id, { number: 2 }, ownerId), status(409));
      await assert.rejects(service.delete(auctionId, lot.id, ownerId), status(409));
      assert(await tx.bid.findUnique({ where: { id: bid.id } })); assert(await tx.bidReservation.findUnique({ where: { id: reservation.id } }));
      assert(await tx.walletTransaction.findUnique({ where: { id: transaction.id } })); assert(await tx.auctionReceipt.findUnique({ where: { id: receipt.id } }));
    });
  });
  it("bloqueia alterações e exclusão diante de auditoria sem apagar seu registro", async () => {
    await fixture(async ({ tx, service, ownerId, auctionId, vehicleId }) => {
      const lot = await service.create(auctionId, input(vehicleId), ownerId);
      const audit = await tx.auditEvent.create({ data: { action: "LOT_CREATED", entityType: "Lot", entityId: lot.id, currentHash: randomUUID().replaceAll("-", "").repeat(2) } });
      await assert.rejects(service.update(auctionId, lot.id, { number: 2 }, ownerId), status(409));
      await assert.rejects(service.delete(auctionId, lot.id, ownerId), status(409));
      assert(await tx.auditEvent.findUnique({ where: { id: audit.id } }));
    });
  });
});
