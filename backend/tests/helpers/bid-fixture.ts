import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../src/generated/prisma/client";
import { getPrisma } from "../../src/lib/prisma";
import { createBidRepository } from "../../src/modules/bids/bid.repository";
import { BidService } from "../../src/modules/bids/bid.service";
import { createWalletRepository } from "../../src/modules/wallet/wallet.repository";
import { WalletService } from "../../src/modules/wallet/wallet.service";

export async function seedBidFixture(tx: Prisma.TransactionClient) {
  const ownerId = randomUUID(), bidders = [randomUUID(), randomUUID()];
  for (const id of [ownerId, ...bidders]) await tx.user.create({ data: { id, name: "Fixture lance", email: `${id}@example.invalid`, passwordHash: "unused-test-fixture", role: id === ownerId ? "AUCTIONEER" : "BIDDER" } });
  const auctionIds: string[] = [], lotIds: string[] = [], vehicleIds: string[] = [], walletIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const auction = await tx.auction.create({ data: { organizerId: ownerId, title: "Fixture lances", status: "OPEN", startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000) } });
    const vehicle = await tx.vehicle.create({ data: { ownerId, brand: "Fixture", model: "Lance", year: 2020 } });
    const lot = await tx.lot.create({ data: { vehicleId: vehicle.id, auctionId: auction.id, number: 1, startingPrice: "100", minimumIncrement: "10", status: "OPEN" } });
    auctionIds.push(auction.id); lotIds.push(lot.id); vehicleIds.push(vehicle.id);
    const wallet = await tx.wallet.create({ data: { userId: bidders[i], balance: "500" } }); walletIds.push(wallet.id);
    await tx.walletTransaction.create({ data: { walletId: wallet.id, type: "CREDIT", amount: "500", balanceAfter: "500", idempotencyKey: `fixture-credit:${randomUUID()}` } });
  }
  return { ownerId, bidders, auctionIds, lotIds, vehicleIds, walletIds };
}
export type BidFixtureIds = Awaited<ReturnType<typeof seedBidFixture>>;

export async function withBidRollback(check: (c: BidFixtureIds & { tx: Prisma.TransactionClient; service: BidService; wallets: WalletService; control: { failLedger: boolean } }) => Promise<void>) {
  const rollback = new Error("rollback de fixtures de lances");
  try {
    await getPrisma().$transaction(async tx => {
      const ids = await seedBidFixture(tx), control = { failLedger: false };
      const scoped = {
        $transaction: async (operation: (db: Prisma.TransactionClient) => Promise<unknown>) => {
          await tx.$executeRawUnsafe("SAVEPOINT bid_operation");
          try {
            const ledger = new Proxy(tx.walletTransaction, { get(target, property) {
              if (property === "create" && control.failLedger) return async () => { throw new Error("Falha simulada no histórico financeiro"); };
              return Reflect.get(target, property);
            } });
            const wrapped = new Proxy(tx, { get(target, property) { return property === "walletTransaction" ? ledger : Reflect.get(target, property); } });
            const result = await operation(wrapped);
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT bid_operation"); return result;
          } catch (error) {
            await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT bid_operation");
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT bid_operation"); throw error;
          }
        },
      } as unknown as PrismaClient;
      await check({ ...ids, tx, control, service: new BidService(createBidRepository(() => scoped)), wallets: new WalletService(createWalletRepository(() => scoped), () => {}) });
      throw rollback;
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch (error) { if (error !== rollback) throw error; }
}

export async function withCommittedBidFixture(check: (c: BidFixtureIds & { service: BidService; wallets: WalletService }) => Promise<void>) {
  const prisma = getPrisma(), ids = await prisma.$transaction(seedBidFixture);
  try { await check({ ...ids, service: new BidService(createBidRepository()), wallets: new WalletService(createWalletRepository(), () => {}) }); }
  finally {
    // Only financial fixtures belonging to the newly generated accounts are cleaned up.
    await prisma.$transaction(async tx => {
      await tx.walletTransaction.deleteMany({ where: { walletId: { in: ids.walletIds } } });
      await tx.bidReservation.deleteMany({ where: { walletId: { in: ids.walletIds } } });
      await tx.bid.deleteMany({ where: { lotId: { in: ids.lotIds } } });
      await tx.lot.deleteMany({ where: { id: { in: ids.lotIds } } });
      await tx.vehicle.deleteMany({ where: { id: { in: ids.vehicleIds }, ownerId: ids.ownerId } });
      await tx.auction.deleteMany({ where: { id: { in: ids.auctionIds }, organizerId: ids.ownerId } });
      await tx.wallet.deleteMany({ where: { id: { in: ids.walletIds } } });
      await tx.user.deleteMany({ where: { id: { in: [ids.ownerId, ...ids.bidders] } } });
    });
  }
}
