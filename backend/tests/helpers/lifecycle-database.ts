import "../../src/config/env";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";

// Definitive audit events must never be inserted/deleted in the user's public chain by tests.
// Each scenario gets private prefixed tables reconstructed from existing migrations.
// The application role can CREATE tables in public but cannot CREATE database schemas.
export async function withLifecycleDatabase(check: (client: PrismaClient) => Promise<void>): Promise<void> {
  const prefix = `lc_${randomUUID().replaceAll("-", "")}_`;
  if (!/^lc_[0-9a-f]{32}_$/.test(prefix)) throw new Error("Prefixo de teste inválido.");
  const tables = ["User", "Auction", "Vehicle", "Lot", "Bid", "Wallet", "WalletTransaction", "BidReservation", "AuctionReceipt", "AuditEvent"];
  const enums = ["UserRole", "AuctionStatus", "LotStatus", "WalletTransactionType", "BidReservationStatus", "AuditAction"];
  // Rewrite table/enum identifiers and their constraint/index names, never column names.
  // The same adapter also rewrites raw locking queries and serial-sequence lookups.
  const rewrite = (sql: string) => sql.replace(/"([A-Za-z0-9_]+)"/g, (quoted, name: string) => {
    if ([...tables, ...enums].includes(name)) return `"${prefix}${name}"`;
    // Keep identifiers under PostgreSQL's 63-byte limit; avoid truncated index collisions.
    if (tables.some(entity => name.startsWith(`${entity}_`))) return `"${prefix}i_${createHash("sha256").update(name).digest("hex").slice(0, 20)}"`;
    return quoted;
  });
  function scoped<T extends object>(target: T): T {
    return new Proxy(target, { get(object, property) {
      const value = Reflect.get(object, property);
      if ((property === "queryRaw" || property === "executeRaw") && typeof value === "function") return (query: { sql: string }) => value.call(object, { ...query, sql: rewrite(query.sql) });
      if (property === "startTransaction" && typeof value === "function") return async (...args: unknown[]) => scoped(await value.apply(object, args));
      return typeof value === "function" ? value.bind(object) : value;
    } });
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000 });
  let client: PrismaClient | undefined;
  try {
    for (const migration of ["20261024111646_init_modelagem", "20261026120000_vehicle_owner"]) {
      await pool.query(rewrite(await readFile(resolve(__dirname, "../../prisma/migrations", migration, "migration.sql"), "utf8")));
    }
    const factory = new PrismaPg(pool);
    client = new PrismaClient({ adapter: { adapterName: factory.adapterName, provider: factory.provider, connect: async () => scoped(await factory.connect()) }, log: [], errorFormat: "minimal" });
    await check(client);
  } finally {
    await client?.$disconnect();
    // CASCADE reaches only these private tables/enums; all test FKs use the same prefix.
    try {
      await pool.query(`DROP TABLE IF EXISTS ${tables.map(table => `"${prefix}${table}"`).join(",")} CASCADE`);
      await pool.query(`DROP TYPE IF EXISTS ${enums.map(type => `"${prefix}${type}"`).join(",")} CASCADE`);
    } finally { await pool.end(); }
  }
}

export async function seedLifecycle(client: PrismaClient, options: { future?: boolean; lots?: number } = {}) {
  const ownerId = randomUUID(), otherId = randomUUID(), bidderId = randomUUID();
  for (const id of [ownerId, otherId, bidderId]) await client.user.create({ data: { id, name: "Fixture abertura", email: `${id}@example.invalid`, passwordHash: "unused-test-fixture", role: id === bidderId ? "BIDDER" : "AUCTIONEER" } });
  const auction = await client.auction.create({ data: { organizerId: ownerId, title: "Fixture abertura", startsAt: new Date(Date.now() + (options.future === false ? -86400000 : 86400000)), endsAt: new Date(Date.now() + 172800000) } });
  const lotIds: string[] = [];
  for (let i = 0; i < (options.lots ?? 2); i++) {
    const vehicle = await client.vehicle.create({ data: { ownerId, brand: "Fixture", model: "Abertura", year: 2020 } });
    const lot = await client.lot.create({ data: { auctionId: auction.id, vehicleId: vehicle.id, number: i + 1, startingPrice: "100", minimumIncrement: "10" } });
    lotIds.push(lot.id);
  }
  return { ownerId, otherId, bidderId, auctionId: auction.id, lotIds };
}
