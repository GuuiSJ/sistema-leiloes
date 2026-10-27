import "../config/env";
import { Client } from "pg";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { auditFormatVersion, verifyOpeningAuditChain } from "../modules/audit/opening-audit";
import type { AuditEvent } from "../generated/prisma/client";

const database = "sistema_leiloes";
const root = resolve(__dirname, "../../..");
const tools = "C:/Program Files/PostgreSQL/17/bin";
class BackupError extends Error {}
function check(value: unknown, code: string): asserts value { if (!value) throw new BackupError(code); }

export function backupConnection(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new BackupError("INVALID_CONNECTION"); }
  check(["postgresql:", "postgres:"].includes(url.protocol), "INVALID_PROTOCOL");
  check(decodeURIComponent(url.pathname.slice(1)) === database, "WRONG_DATABASE");
  check(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "NOT_LOCAL_DATABASE");
  const allowed = ["schema", "sslmode", "sslcert", "sslkey", "sslrootcert"];
  check([...url.searchParams.keys()].every(key => allowed.includes(key)), "UNSUPPORTED_CONNECTION_OPTIONS");
  check(!url.searchParams.has("schema") || url.searchParams.get("schema") === "public", "WRONG_SCHEMA");
  // libpq must not inherit PGSERVICE, PGHOSTADDR, or any other routing/auth overrides.
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key) && key !== "DATABASE_URL"));
  Object.assign(env, {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432", PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "5", PGAPPNAME: "temporal-backup-readonly", PGOPTIONS: "-c default_transaction_read_only=on",
  });
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    if (url.searchParams.has(key)) env[`PG${key.toUpperCase()}`] = url.searchParams.get(key)!;
  }
  return { url: url.toString(), env };
}

async function run(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((accept, reject) => {
    const child = spawn(join(tools, binary), args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data.toString(); });
    child.stderr.on("data", data => { stderr += data.toString(); });
    child.once("error", () => reject(new BackupError("TOOL_UNAVAILABLE")));
    child.once("close", code => accept({ stdout, stderr, code }));
  });
}

async function identity(client: Client) {
  const { rows: [row] } = await client.query("SELECT current_database() AS database, current_setting('transaction_read_only') AS readonly, current_setting('server_version') AS version, current_setting('server_version_num') AS version_num");
  check(row?.database === database && row.readonly === "on", "READONLY_DATABASE_IDENTITY_FAILED");
  return row;
}
async function fingerprint(client: Client): Promise<string> {
  const { rows: [row] } = await client.query(`SELECT md5(COALESCE(string_agg(row_to_json(a)::text, '' ORDER BY "sequence"), '')) AS digest FROM "AuditEvent" a`);
  return row.digest;
}

export async function backupTemporalPreflight() {
  check((await readFile(join(root, ".gitignore"), "utf8")).split(/\r?\n/).includes("/backups/"), "BACKUP_DIRECTORY_NOT_IGNORED");
  const connection = backupConnection(process.env.DATABASE_URL ?? "");
  const client = new Client({ connectionString: connection.url, connectionTimeoutMillis: 5000,
    options: "-c default_transaction_read_only=on", application_name: "temporal-preflight-readonly" });
  const dumpTool = await run("pg_dump.exe", ["--version"], connection.env);
  const restoreTool = await run("pg_restore.exe", ["--version"], connection.env);
  check(dumpTool.code === 0 && restoreTool.code === 0, "POSTGRES_TOOLS_UNAVAILABLE");
  await client.connect();
  try {
    const server = await identity(client);
    check(Math.floor(Number(server.version_num) / 10000) === 17, "BACKUP_TOOL_SERVER_MAJOR_MISMATCH");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migrationDirectory = join(root, "backend/prisma/migrations");
    const localMigrations = (await readdir(migrationDirectory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    const { rows: migrationRows } = await client.query(`SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at`);
    const migrations = await Promise.all(migrationRows.map(async row => {
      let matchesLocal = false;
      if (localMigrations.includes(row.migration_name)) {
        const sql = await readFile(join(migrationDirectory, row.migration_name, "migration.sql"), "utf8");
        const lf = sql.replace(/\r\n/g, "\n");
        matchesLocal = [sql, lf, lf.replace(/\n/g, "\r\n")].some(text => createHash("sha256").update(text).digest("hex") === row.checksum);
      }
      return { name: row.migration_name, finished: row.finished, rolledBack: row.rolled_back, steps: row.applied_steps_count, matchesLocal };
    }));
    const pendingMigrations = localMigrations.filter(name => !migrations.some(row => row.name === name && row.finished && !row.rolledBack));
    const { rows: [column] } = await client.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Auction' AND column_name='temporalGeneration') AS present`);
    const { rows: auctions } = await client.query(column.present
      ? `SELECT status, "temporalGeneration" AS generation, count(*)::integer AS count FROM "Auction" GROUP BY status, "temporalGeneration" ORDER BY status, "temporalGeneration"`
      : `SELECT status, 'NOT_YET_MARKED' AS generation, count(*)::integer AS count FROM "Auction" GROUP BY status ORDER BY status`);
    const { rows: [reservations] } = await client.query(`SELECT count(*)::integer AS active FROM "BidReservation" WHERE status='ACTIVE'`);
    const { rows: sessions } = await client.query(`SELECT backend_type, state, count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY backend_type, state ORDER BY backend_type, state`);
    const { rows: audits } = await client.query(`SELECT "id", "sequence", "action", "entityType", "entityId", "publicData", "previousHash", "currentHash",
      (EXTRACT(EPOCH FROM (("occurredAt" AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC')) * 1000)::bigint AS milliseconds FROM "AuditEvent" ORDER BY "sequence"`);
    let auditValid = false, exclusivelyV1 = false;
    try {
      exclusivelyV1 = audits.every(row => auditFormatVersion(row.publicData) === 1);
      if (exclusivelyV1) {
        verifyOpeningAuditChain(audits.map(row => ({ ...row, authorId: null, occurredAt: new Date(Number(row.milliseconds)) })) as AuditEvent[]);
        auditValid = true;
      }
    } catch { /* A failed chain blocks the migration, not the preservation backup. */ }
    const before = await fingerprint(client);
    const { rows: tables } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
    const { rows: [exported] } = await client.query("SELECT pg_export_snapshot() AS snapshot");
    check(typeof exported.snapshot === "string" && /^[0-9A-Fa-f-]+$/.test(exported.snapshot), "INVALID_SNAPSHOT");
    const directory = join(root, "backups");
    await mkdir(directory, { recursive: true });
    const base = `sistema_leiloes_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
    const partial = join(directory, base + ".dump.partial"), archive = join(directory, base + ".dump");
    // No password/URI in argv. Explicit database + a validated, sanitized libpq environment.
    await identity(client);
    const dump = await run("pg_dump.exe", ["--dbname", database, "--format=custom", "--create", "--no-password", "--lock-wait-timeout=10s", `--snapshot=${exported.snapshot}`, "--file", partial], connection.env);
    check(dump.code === 0, "PG_DUMP_FAILED_PARTIAL_NOT_VERIFIED");
    check((await stat(partial)).size > 0, "EMPTY_ARCHIVE");
    const restoreEnv = Object.fromEntries(Object.entries(connection.env).filter(([key]) => !/^PG/i.test(key)));
    const listing = await run("pg_restore.exe", ["--list", partial], restoreEnv);
    check(listing.code === 0 && /dbname:\s+sistema_leiloes\s/.test(listing.stdout), "ARCHIVE_LISTING_FAILED");
    check(tables.every(row => listing.stdout.includes(`TABLE DATA public ${row.tablename} `)), "ARCHIVE_MISSING_TABLE_DATA");
    // Read/decompress every archive entry, writing SQL only to Windows' null device.
    // No --dbname/--clean: this never connects to or restores into a database.
    const decoded = await run("pg_restore.exe", ["--file=NUL", partial], restoreEnv);
    check(decoded.code === 0, "ARCHIVE_FULL_DECODE_FAILED");
    await client.query("COMMIT");
    await identity(client);
    const auditUnchanged = before === await fingerprint(client);
    await rename(partial, archive);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    const checksum = hash.digest("hex");
    await writeFile(archive + ".sha256", `${checksum}  ${base}.dump\n`, { flag: "wx" });
    const report = {
      capturedAtUtc: new Date().toISOString(), database, readOnlyInspection: true, postgresVersion: server.version,
      tools: { pgDump: dumpTool.stdout.trim(), pgRestore: restoreTool.stdout.trim() },
      migrations, pendingMigrations, temporalColumnPresent: column.present, auctions,
      unmarkedRowsWillDefaultTo: column.present ? null : "LEGACY_AFTER_MIGRATION_ONLY",
      openAuctions: auctions.filter(row => row.status === "OPEN").reduce((sum, row) => sum + row.count, 0),
      activeReservations: reservations.active, otherDatabaseSessions: sessions,
      processInspection: { externalWindowsInspectionRequired: true, workersProvenStopped: false },
      audit: { events: audits.length, exclusivelyV1, valid: auditValid, historicalZone: "America/Sao_Paulo", physicalFingerprintUnchanged: auditUnchanged },
      backup: { path: archive, bytes: (await stat(archive)).size, sha256: checksum, sharedInspectionSnapshot: true,
        listVerified: true, allPublicTablesInToc: true, publicTables: tables.length, fullDecodeToNullVerified: true,
        dumpWarnings: dump.stderr.trim().length > 0, listWarnings: listing.stderr.trim().length > 0, decodeWarnings: decoded.stderr.trim().length > 0,
        restoreRehearsalPerformed: false, clusterRolesIncluded: false },
    };
    await writeFile(join(directory, base + ".report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  } finally { await client.end(); }
}

if (require.main === module) void backupTemporalPreflight().catch(error => {
  // Never print driver/subprocess errors, SQL, argv env, URLs, or audit payloads.
  console.error(JSON.stringify({ complete: false, code: error instanceof BackupError ? error.message : "PREFLIGHT_OR_BACKUP_FAILED", action: "STOP_NO_MIGRATION" }));
  process.exitCode = 1;
});
