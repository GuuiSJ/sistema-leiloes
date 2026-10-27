import "../config/env";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import type { AuditEvent } from "../generated/prisma/client";
import { auditFormatVersion, verifyOpeningAuditChain } from "../modules/audit/opening-audit";
import { backupConnection } from "./backup-temporal-preflight";

export function validateLegacyAudit(rows: AuditEvent[]): void {
  if (rows.length !== 14 || rows.some(row => auditFormatVersion(row.publicData) !== 1)) {
    throw new Error("EXPECTED_14_LEGACY_EVENTS");
  }
  verifyOpeningAuditChain(rows);
}

async function main() {
  // Password comes only from the wrapper's anonymous stdin pipe, never argv or .env.
  const input = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/, "")) as { password?: unknown };
  if (typeof input.password !== "string" || !input.password) throw new Error("ADMIN_PASSWORD_REQUIRED");
  const url = new URL(backupConnection(process.env.DATABASE_URL ?? "").url);
  url.username = "postgres";
  url.password = input.password;
  input.password = undefined;
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000,
    application_name: "legacy-audit-admin-readonly", options: "-c default_transaction_read_only=on" });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: [identity] } = await client.query(`SELECT current_database() AS database, session_user AS role,
      current_setting('transaction_read_only') AS readonly`);
    if (identity?.database !== "sistema_leiloes" || identity.role !== "postgres" || identity.readonly !== "on") throw new Error("INVALID_READONLY_IDENTITY");
    const { rows: [state] } = await client.query(`SELECT
      (SELECT rolcanlogin FROM pg_roles WHERE rolname='leiloes_app') AS app_login,
      (SELECT count(*)::integer FROM pg_stat_activity WHERE usename='leiloes_app') AS app_sessions,
      (SELECT count(*)::integer FROM "Auction" WHERE status='OPEN') AS open,
      (SELECT count(*)::integer FROM "BidReservation" WHERE status='ACTIVE') AS active,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Auction' AND column_name='temporalGeneration') AS temporal_column,
      EXISTS(SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20261028000000_auction_temporal_generation' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS temporal_applied`);
    if (state.app_login !== false || state.app_sessions !== 0 || state.open !== 0 || state.active !== 0 || state.temporal_column || state.temporal_applied) throw new Error("PRE_MIGRATION_STATE_CHANGED");
    const { rows } = await client.query(`SELECT "id", "sequence", "action", "entityType", "entityId", "publicData", "previousHash", "currentHash",
      (EXTRACT(EPOCH FROM (("occurredAt" AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC')) * 1000)::bigint AS milliseconds
      FROM "AuditEvent" ORDER BY "sequence"`);
    validateLegacyAudit(rows.map(row => ({ ...row, authorId: null, occurredAt: new Date(Number(row.milliseconds)) })));
    await client.query("COMMIT");
    console.log(JSON.stringify({ complete: true, database: "sistema_leiloes", readOnly: true,
      events: 14, version: 1, chainValid: true, appLogin: false, appSessions: 0,
      open: 0, active: 0, temporalMigrationApplied: false }));
  } finally { await client.end(); }
}

if (require.main === module) void main().catch(() => {
  console.error(JSON.stringify({ complete: false, message: "Validação administrativa não concluída. Verifique autenticação, estado pré-migração e cadeia. Nenhuma alteração foi solicitada." }));
  process.exitCode = 1;
});
