import type { AuditEvent } from "../../generated/prisma/client";
import { auditFormatVersion, verifyOpeningAuditChain } from "../audit/opening-audit";
import { TEMPORAL_FIELDS, TemporalEncoding, TemporalOrigin, type TemporalEvidenceCode, type TemporalInventoryEntry, type TemporalInventorySummary, type TemporalModel, type TemporalTarget } from "./temporal.types";

export interface InventoryDatabase {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
const pageSize = 500;
const legacyZone = "America/Sao_Paulo";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const integer = /^-?\d+$/;
function epoch(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !integer.test(value)) throw new Error("Epoch físico inválido no inventário.");
  return BigInt(value).toString();
}

function contextualEvidence(model: TemporalModel, field: string): TemporalEvidenceCode {
  if (field === "updatedAt") return "ORM_AUTOMATIC_NOT_ROW_PROOF";
  if ((model === "Auction" && ["startsAt", "endsAt"].includes(field)) || (model === "Lot" && field === "endsAt") || model === "Bid" || model === "AuctionReceipt") return "APPLICATION_PATH_NOT_ROW_PROOF";
  if (field === "createdAt") return "SCHEMA_DEFAULT_NOT_ROW_PROOF";
  return "NO_ROW_PROVENANCE";
}

async function signedRepresentations(db: InventoryDatabase): Promise<Map<string, string>> {
  // A named, fixed historical hypothesis, NOT the current session timezone.
  // Only a valid COMPLETE chain makes its signed representation trustworthy.
  const { rows } = await db.query(`SELECT "id", "sequence"::text AS "sequence", "action", "entityType", "entityId", "publicData", "previousHash", "currentHash",
    CASE WHEN "publicData"->'formatVersion' = '2'::jsonb
      THEN (EXTRACT(EPOCH FROM "occurredAt") * 1000)::bigint::text
      ELSE (EXTRACT(EPOCH FROM (("occurredAt" AT TIME ZONE '${legacyZone}') AT TIME ZONE 'UTC')) * 1000)::bigint::text
    END AS "canonicalEpochMs"
    FROM "AuditEvent" ORDER BY "sequence"`);
  const proven = new Map<string, string>();
  if (!rows.length) return proven;
  try {
    const chain = rows.map(row => {
      const ms = epoch(row.canonicalEpochMs);
      if (ms === null || typeof row.id !== "string" || !uuid.test(row.id) || typeof row.sequence !== "string" || !/^\d+$/.test(row.sequence)) throw new Error("Evento não suportado.");
      return { ...row, sequence: BigInt(row.sequence), authorId: null, occurredAt: new Date(Number(ms)) } as unknown as AuditEvent;
    });
    verifyOpeningAuditChain(chain);
    // The inventory's legacy evidence code must never classify a v2 event as legacy.
    for (const row of rows) if (auditFormatVersion(row.publicData as AuditEvent["publicData"]) === 1) proven.set(row.id as string, epoch(row.canonicalEpochMs)!);
  } catch { /* Unsupported/invalid history remains UNKNOWN; never repair or disclose it. */ }
  return proven;
}

export async function inventoryTemporalFields(db: InventoryDatabase, emit: (entry: TemporalInventoryEntry) => void | Promise<void> = () => {}): Promise<TemporalInventorySummary> {
  const summary: TemporalInventorySummary = { fieldDefinitions: Object.values(TEMPORAL_FIELDS).reduce((sum, fields) => sum + fields.length, 0), values: 0, nonNullValues: 0, nullValues: 0, proven: 0, partial: 0, unknown: 0, provenOrigins: 0, provenEncodings: 0 };
  await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const representations = await signedRepresentations(db);
    for (const model of Object.keys(TEMPORAL_FIELDS) as TemporalModel[]) {
      const fields = TEMPORAL_FIELDS[model];
      let cursor: string | null = null;
      for (;;) {
        // Identifiers come ONLY from the hardcoded catalogue, never CLI/client input.
        // Epoch is computed in PostgreSQL, avoiding all adapter timestamp conversion.
        const columns = fields.map(field => `(EXTRACT(EPOCH FROM "${field}") * 1000)::bigint::text AS "${field}"`).join(", ");
        const { rows } = await db.query(`SELECT "id", ${columns} FROM "${model}" WHERE ($1::uuid IS NULL OR "id" > $1::uuid) ORDER BY "id" LIMIT $2`, [cursor, pageSize]);
        if (!rows.length) break;
        for (const row of rows) {
          if (typeof row.id !== "string" || !uuid.test(row.id) || (cursor !== null && row.id <= cursor)) throw new Error("Identificador inválido no inventário.");
          for (const field of fields) {
            const storedEpochMs = epoch(row[field]);
            const entry: TemporalInventoryEntry = {
              ...({ model, field, id: row.id } as TemporalTarget), storedEpochMs,
              candidateOrigin: TemporalOrigin.UNKNOWN, candidateEncoding: TemporalEncoding.UNKNOWN,
              originStatus: "UNKNOWN", encodingStatus: "UNKNOWN", classification: storedEpochMs === null ? "NOT_APPLICABLE" : "UNKNOWN",
              sourceTimeZone: null, canonicalEpochMs: null,
              evidence: [storedEpochMs === null ? "NULL_NO_INSTANT" : contextualEvidence(model, field)],
            };
            if (storedEpochMs !== null && model === "AuditEvent") {
              const canonical = representations.get(row.id);
              if (canonical !== undefined) {
                entry.candidateEncoding = TemporalEncoding.LEGACY_ADAPTER_WALL_CLOCK;
                entry.encodingStatus = "PROVEN"; entry.classification = "PARTIAL";
                entry.sourceTimeZone = legacyZone; entry.canonicalEpochMs = canonical;
                entry.evidence = ["AUDIT_V1_SIGNED_REPRESENTATION_MATCH"];
                // Hash proves the signed instant, NOT which writer/origin produced it.
              } else entry.evidence = ["AUDIT_CHAIN_UNVERIFIED"];
            }
            summary.values++;
            if (storedEpochMs === null) summary.nullValues++;
            else { summary.nonNullValues++; if (entry.classification === "PARTIAL") summary.partial++; else if (entry.classification === "PROVEN") summary.proven++; else summary.unknown++; }
            if (entry.encodingStatus === "PROVEN") summary.provenEncodings++;
            if (entry.originStatus === "PROVEN") summary.provenOrigins++;
            await emit(entry);
          }
          cursor = row.id;
        }
        if (rows.length < pageSize) break;
      }
    }
    await db.query("COMMIT");
    return summary;
  } catch (error) { try { await db.query("ROLLBACK"); } catch { /* Preserve original failure. */ } throw error; }
}
