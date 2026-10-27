import "../config/env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type AuditEvent } from "../generated/prisma/client";
import { backupConnection } from "./backup-temporal-preflight";
import { validateLegacyAudit } from "./verify-legacy-audit-admin";
import { TemporalRuntime, temporalMigration } from "../modules/temporal/temporal-runtime";

const expectedTables = ["Auction", "AuctionReceipt", "AuditEvent", "Bid", "BidReservation", "Lot", "User", "Vehicle", "Wallet", "WalletTransaction", "_prisma_migrations"];
const approvedHash = "61ae2a22510f88c6cd20b80154cd0192ff9a8e549a48d1cbaed95e223ea29c5f";
type TableCopy = { columns: string[]; rows: (string | null)[][] };
function requireCheck(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
const identifier = (value: string) => '"' + value.replace(/"/g, '""') + '"';

export function copyValue(value: string): string | null {
  if (value === "\\N") return null;
  return value.replace(/\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)/g, (_, escape: string) => {
    const escapes: Record<string, string> = { t: "\t", n: "\n", r: "\r", b: "\b", f: "\f", v: "\v", "\\": "\\" };
    if (escape in escapes) return escapes[escape]!;
    if (/^[0-7]+$/.test(escape)) return String.fromCharCode(parseInt(escape, 8));
    if (/^x[0-9a-fA-F]+$/.test(escape)) return String.fromCharCode(parseInt(escape.slice(1), 16));
    throw new Error("UNSUPPORTED_COPY_ESCAPE");
  });
}
export function parseBackup(sql: string): Map<string, TableCopy> {
  const tables = new Map<string, TableCopy>();
  let current: TableCopy | undefined;
  for (const line of sql.split(/\r?\n/)) {
    if (current) {
      if (line === "\\.") { current = undefined; continue; }
      const values = line.split("\t").map(copyValue);
      requireCheck(values.length === current.columns.length, "INVALID_COPY_ROW");
      current.rows.push(values);
      continue;
    }
    if (!line.startsWith("COPY ")) continue;
    const match = line.match(/^COPY public\."?([A-Za-z_][A-Za-z_0-9]*)"? \((.+)\) FROM stdin;$/);
    requireCheck(match && expectedTables.includes(match[1]!) && !tables.has(match[1]!), "UNEXPECTED_COPY_TABLE");
    const columns = match[2]!.split(", ").map(column => column.replace(/^"|"$/g, ""));
    requireCheck(columns.includes("id") && columns.every(column => /^[A-Za-z_][A-Za-z_0-9]*$/.test(column)), "INVALID_COPY_COLUMNS");
    current = { columns, rows: [] };
    tables.set(match[1]!, current);
  }
  requireCheck(!current && tables.size === expectedTables.length, "INCOMPLETE_BACKUP_DATA");
  return tables;
}
export function physicalMicros(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?([+-]\d{2}(?::?\d{2})?)$/);
  requireCheck(match, "UNSUPPORTED_TIMESTAMP");
  let offset = match[4]!;
  if (offset.length === 3) offset += ":00";
  else if (offset.length === 5) offset = offset.slice(0, 3) + ":" + offset.slice(3);
  const fraction = (match[3] ?? "").padEnd(6, "0");
  const ms = Date.parse(`${match[1]}T${match[2]}.${fraction.slice(0, 3)}${offset}`);
  requireCheck(Number.isFinite(ms), "INVALID_TIMESTAMP");
  return (BigInt(ms) * 1000n + BigInt(fraction.slice(3))).toString();
}

async function main() {
  const input = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/, "")) as { password?: unknown };
  requireCheck(typeof input.password === "string" && input.password.length > 0, "PASSWORD_REQUIRED");
  const url = new URL(backupConnection(process.env.DATABASE_URL ?? "").url);
  url.username = "postgres"; url.password = input.password; input.password = undefined;
  const archive = resolve(__dirname, "../../../backups/sistema_leiloes_pre_utc.dump");
  requireCheck(createHash("sha256").update(readFileSync(archive)).digest("hex") === approvedHash, "BACKUP_CHANGED");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key) && key !== "DATABASE_URL"));
  const restored = spawnSync("C:/Program Files/PostgreSQL/17/bin/pg_restore.exe", ["--data-only", "--file=-", archive],
    { env, windowsHide: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  requireCheck(!restored.error && restored.status === 0, "BACKUP_DECODE_FAILED");
  // SQL is parsed as data only; never sent to the database, written to disk, or printed.
  const baseline = parseBackup(restored.stdout);
  const client = new Client({ connectionString: url.toString(), options: "-c timezone=UTC -c default_transaction_read_only=on",
    application_name: "post-utc-admin-readonly", connectionTimeoutMillis: 5000 });
  let prisma: PrismaClient | undefined;
  const runtime = new TemporalRuntime("UTC_V2");
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: [identity] } = await client.query(`SELECT current_database() AS database,session_user AS role,current_setting('transaction_read_only') AS readonly`);
    requireCheck(identity?.database === "sistema_leiloes" && identity.role === "postgres" && identity.readonly === "on", "INVALID_IDENTITY");
    const { rows: [state] } = await client.query(`SELECT
      (SELECT rolcanlogin FROM pg_roles WHERE rolname='leiloes_app') AS login,
      (SELECT count(*)::integer FROM pg_stat_activity WHERE usename='leiloes_app') AS sessions,
      (SELECT count(*)::integer FROM "Auction") AS auctions,
      (SELECT count(*)::integer FROM "Auction" WHERE "temporalGeneration"='LEGACY') AS legacy,
      (SELECT count(*)::integer FROM "Auction" WHERE status='OPEN') AS open,
      (SELECT count(*)::integer FROM "BidReservation" WHERE status='ACTIVE') AS active`);
    requireCheck(state.login === false && state.sessions === 0 && state.auctions === 9 && state.legacy === 9 && state.open === 0 && state.active === 0, "UNEXPECTED_SAFETY_STATE");
    const { rows: migrationRows } = await client.query(`SELECT migration_name,finished_at,rolled_back_at,checksum FROM "_prisma_migrations" WHERE migration_name=$1`, [temporalMigration]);
    const applied = migrationRows.filter(row => row.finished_at && !row.rolled_back_at);
    requireCheck(applied.length === 1 && migrationRows.every(row => row.finished_at || row.rolled_back_at), "MIGRATION_NOT_COMPLETED");
    const migrationSql = readFileSync(resolve(__dirname, "../../..", "backend/prisma/migrations", temporalMigration, "migration.sql"), "utf8");
    const lf = migrationSql.replace(/\r\n/g, "\n");
    requireCheck([migrationSql, lf, lf.replace(/\n/g, "\r\n")].some(sql => createHash("sha256").update(sql).digest("hex") === applied[0]!.checksum), "MIGRATION_CHECKSUM_MISMATCH");
    const { rows: types } = await client.query(`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'`);
    let records = 0;
    for (const [table, copy] of baseline) {
      const { rows: actual } = await client.query(`SELECT ${copy.columns.map(column => `${identifier(column)}::text AS ${identifier(column)}`).join(",")} FROM public.${identifier(table)}`);
      const originals = new Map(copy.rows.map(values => [values[copy.columns.indexOf("id")], values]));
      const newRows = actual.filter(row => !originals.has(row.id));
      requireCheck(table === "_prisma_migrations" ? newRows.length === 1 && newRows[0]!.migration_name === temporalMigration : newRows.length === 0, "UNEXPECTED_NEW_RECORDS");
      requireCheck(actual.length === copy.rows.length + newRows.length, "MISSING_RECORDS");
      for (const row of actual) {
        const original = originals.get(row.id);
        if (!original) continue;
        copy.columns.forEach((column, index) => {
          const before = original[index], after = row[column];
          const type = types.find(type => type.table_name === table && type.column_name === column)?.data_type;
          requireCheck(before === null || after === null ? before === after : type === "timestamp with time zone"
            ? physicalMicros(before!) === physicalMicros(after) : before === after, "HISTORICAL_DATA_CHANGED");
        });
        records++;
      }
    }
    const { rows: auditRows } = await client.query(`SELECT "id","sequence","action","entityType","entityId","publicData","previousHash","currentHash",
      (EXTRACT(EPOCH FROM (("occurredAt" AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC'))*1000)::bigint AS milliseconds FROM "AuditEvent" ORDER BY "sequence"`);
    validateLegacyAudit(auditRows.map(row => ({ ...row, authorId: null, occurredAt: new Date(Number(row.milliseconds)) })) as AuditEvent[]);
    // Separate, dedicated pool: UTC + READ ONLY on every physical connection.
    // Run the production preflight against a local runtime, never the app singleton/server.
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(),
      options: "-c timezone=UTC -c default_transaction_read_only=on", connectionTimeoutMillis: 5000, max: 2 }), log: [], errorFormat: "minimal" });
    await runtime.verify(prisma);
    const { rows: [last] } = await client.query(`SELECT rolcanlogin AS login,(SELECT count(*)::integer FROM pg_stat_activity WHERE usename='leiloes_app') AS sessions FROM pg_roles WHERE rolname='leiloes_app'`);
    requireCheck(last?.login === false && last.sessions === 0, "BARRIER_CHANGED");
    await client.query("COMMIT");
    console.log(JSON.stringify({ complete: true, database: "sistema_leiloes", readOnly: true, migrationApplied: true,
      migrationChecksumValid: true, legacyAuctions: 9, historicalEvents: 14, chainValid: true, storedHashesUnchanged: true,
      historicalRowsCompared: records, timestampsUnchanged: true, financialRecordsUnchanged: true,
      backupMatched: true, administrativePreflightPassed: true, appLogin: false, appSessions: 0,
      applicationActivated: false, restorePerformed: false }));
  } finally { runtime.reset(); await prisma?.$disconnect(); await client.end(); }
}
if (require.main === module) void main().catch(error => {
  const safe = ["BACKUP_CHANGED", "BACKUP_DECODE_FAILED", "UNEXPECTED_SAFETY_STATE", "MIGRATION_NOT_COMPLETED", "MIGRATION_CHECKSUM_MISMATCH", "UNEXPECTED_NEW_RECORDS", "MISSING_RECORDS", "HISTORICAL_DATA_CHANGED", "BARRIER_CHANGED"];
  console.error(JSON.stringify({ complete: false, code: error instanceof Error && safe.includes(error.message) ? error.message : "POST_MIGRATION_CHECK_FAILED",
    action: "STOP_KEEP_APP_BLOCKED" }));
  process.exitCode = 1;
});
