import "../../src/config/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import type { Prisma } from "../../src/generated/prisma/client";

export type TestTimezone = "UTC" | "America/Sao_Paulo";

// Dedicated connections: SELECT only, enforced by PostgreSQL itself. No SET/ALTER,
// application singleton, changes to .env, production writes or migrations.
export async function withReadonlyTimezones(check: (legacy: PrismaClient, utc: PrismaClient) => Promise<void>) {
  const clients = (["America/Sao_Paulo", "UTC"] as const).map(timezone => new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, options: `-c timezone=${timezone} -c default_transaction_read_only=on` }),
    log: [], errorFormat: "minimal",
  }));
  try { await check(clients[0]!, clients[1]!); }
  finally { await Promise.all(clients.map(client => client.$disconnect())); }
}

// Control only the SQL clock for exact boundaries; the actual production services,
// locks, Decimal operations, writes and commits still execute on isolated PostgreSQL tables.
export function withTestClock(client: PrismaClient, clock: { now: Date }): PrismaClient {
  return { $transaction: (operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => client.$transaction(tx => operation(new Proxy(tx, {
    get(target, property) {
      if (property === "$queryRaw") return (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join("").includes("EXTRACT(EPOCH FROM clock_timestamp())")) return Promise.resolve([{ milliseconds: BigInt(clock.now.getTime()) }]);
        return tx.$queryRaw(strings, ...values);
      };
      return Reflect.get(target, property);
    },
  })), options) } as unknown as PrismaClient;
}
