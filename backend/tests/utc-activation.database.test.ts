import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { temporalPoolConfig } from "../src/config/temporal";
import { TemporalRuntime } from "../src/modules/temporal/temporal-runtime";

// Dedicated READ ONLY pools; never use/activate the application's singleton.
// Both suites are intentionally not enabled in this preparation.
function readonlyPool() {
  if (!process.env.DATABASE_URL) throw new Error("Banco de validação não configurado.");
  const config = temporalPoolConfig(process.env.DATABASE_URL, "UTC_V2");
  return new Pool({ ...config, options: config.options + " -c default_transaction_read_only=on", max: 3 });
}

describe("Pool UTC dedicado sem escrita", { skip: process.env.UTC_ACTIVATION_DATABASE_TESTS !== "1" }, () => {
  it("todas as conexoes fisicas novas e transacoes herdam UTC", async () => {
    const pool = readonlyPool();
    const connections: PoolClient[] = [];
    try {
      // Hold them simultaneously so the pool must open three distinct sessions.
      for (let index = 0; index < 3; index++) connections.push(await pool.connect());
      const pids = new Set<number>();
      for (const connection of connections) {
        await connection.query("BEGIN READ ONLY");
        try {
          const { rows } = await connection.query("SELECT current_setting('TimeZone') AS timezone, current_setting('transaction_read_only') AS readonly, pg_backend_pid() AS pid");
          assert.equal(rows[0].timezone, "UTC"); assert.equal(rows[0].readonly, "on"); pids.add(rows[0].pid);
        } finally { await connection.query("ROLLBACK"); }
      }
      assert.equal(pids.size, 3);
    } finally { connections.forEach(connection => connection.release()); await pool.end(); }
  });
  it("adapter Prisma coincide com epoch fisico, incluindo parametro Date e milissegundos", async () => {
    const pool = readonlyPool(), client = new PrismaClient({ adapter: new PrismaPg(pool), log: [], errorFormat: "minimal" });
    try {
      await client.$transaction(async tx => {
        const input = new Date("2030-01-01T15:00:00.123Z");
        const [row] = await tx.$queryRaw<{ timezone: string; observed: Date; epoch: bigint; parameter: bigint }[]>`
          WITH instant AS MATERIALIZED (SELECT date_trunc('milliseconds', clock_timestamp()) AS value)
          SELECT current_setting('TimeZone') AS timezone, value AS observed, (EXTRACT(EPOCH FROM value) * 1000)::bigint AS epoch,
            (EXTRACT(EPOCH FROM ${input}::timestamptz) * 1000)::bigint AS parameter FROM instant`;
        assert.equal(row.timezone, "UTC"); assert.equal(row.observed.getTime(), Number(row.epoch));
        assert.equal(input.getTime(), Number(row.parameter));
      });
    } finally { await client.$disconnect(); await pool.end(); }
  });
});

describe("Preflight UTC com schema migrado e client regenerado (somente leitura)", { skip: process.env.UTC_ACTIVATION_MIGRATED_DATABASE_TESTS !== "1" }, () => {
  it("confirma schema, migracao, tipos, epochs e cadeia historica sem ativar singleton", async () => {
    const pool = readonlyPool(), client = new PrismaClient({ adapter: new PrismaPg(pool), log: [], errorFormat: "minimal" });
    const runtime = new TemporalRuntime("UTC_V2");
    try { await runtime.verify(client); assert.equal(runtime.utcActive, true); }
    finally { runtime.reset(); await client.$disconnect(); await pool.end(); }
  });
});
