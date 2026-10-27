import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { inventoryTemporalFields, type InventoryDatabase } from "../src/modules/temporal/temporal-inventory";
import { openingAuditHash } from "../src/modules/audit/opening-audit";
import { TEMPORAL_FIELDS, TemporalEncoding, TemporalOrigin, assertTemporalMetadata, type TemporalFieldMetadata, type TemporalInventoryEntry } from "../src/modules/temporal/temporal.types";

const id = "00000000-0000-4000-8000-000000000001", ms = "1793026800000";
function database(options: { audit?: boolean; invalidHash?: boolean; users?: number; epoch?: unknown; fail?: boolean } = {}) {
  const queries: string[] = [];
  const db: InventoryDatabase = { async query(sql, parameters = []) {
    queries.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (options.fail) throw new Error("private SQL error token password");
    if (sql.includes('"sequence"::text')) return { rows: options.audit ? [{ id, sequence: "1", action: "AUCTION_OPENED", entityType: "Auction", entityId: "00000000-0000-4000-8000-000000000002", publicData: { formatVersion: 1, status: "OPEN", lotIds: ["00000000-0000-4000-8000-000000000003"] }, previousHash: null, currentHash: options.invalidHash ? "a".repeat(64) : "03d14d0c649ff543ae7baede3ff085206d8423b68ca9588c7c6b8cff69c08b60", canonicalEpochMs: Date.parse("2026-10-26T15:00:00Z").toString() }] : [] };
    const model = (Object.keys(TEMPORAL_FIELDS) as (keyof typeof TEMPORAL_FIELDS)[]).find(name => sql.includes(`FROM "${name}"`)); assert(model);
    const records = Array.from({ length: model === "User" ? options.users ?? 1 : 1 }, (_, i) => {
      const row: Record<string, unknown> = { id: model === "User" ? `00000000-0000-4000-8000-${(i + 1).toString().padStart(12, "0")}` : id, email: "private@example.invalid", passwordHash: "private-test-value", balance: "999" };
      for (const field of TEMPORAL_FIELDS[model]) row[field] = field === "fipeConsultedAt" || (model === "Lot" && field === "endsAt") ? null : options.epoch === undefined ? ms : options.epoch;
      return row;
    });
    return { rows: records.filter(r => parameters[0] === null || String(r.id) > String(parameters[0])).slice(0, Number(parameters[1])) };
  } };
  return { db, queries };
}
describe("Inventário temporal e segurança do relatório", () => {
  it("catálogo contém exatamente os 20 campos dos dez modelos", () => {
    assert.equal(Object.keys(TEMPORAL_FIELDS).length, 10); assert.equal(Object.values(TEMPORAL_FIELDS).flat().length, 20);
    assert(TEMPORAL_FIELDS.Auction.includes("startsAt")); assert(TEMPORAL_FIELDS.Lot.includes("endsAt"));
  });
  it("percorre todos os campos com epoch físico string e classificação conservadora", async () => {
    const { db } = database(), entries: TemporalInventoryEntry[] = []; const s = await inventoryTemporalFields(db, e => { entries.push(e); });
    assert.equal(s.fieldDefinitions, 20); assert.equal(s.values, 20); assert.equal(s.nonNullValues, 18); assert.equal(s.nullValues, 2); assert.equal(s.unknown, 18); assert.equal(s.proven, 0);
    assert(entries.every(e => e.candidateOrigin === TemporalOrigin.UNKNOWN && e.candidateEncoding === TemporalEncoding.UNKNOWN)); assert(entries.filter(e => e.storedEpochMs !== null).every(e => typeof e.storedEpochMs === "string"));
  });
  it("defaults, updatedAt e caminhos atuais não são prova da origem de uma linha", async () => {
    const entries: TemporalInventoryEntry[] = []; await inventoryTemporalFields(database().db, e => { entries.push(e); });
    for (const code of ["SCHEMA_DEFAULT_NOT_ROW_PROOF", "ORM_AUTOMATIC_NOT_ROW_PROOF", "APPLICATION_PATH_NOT_ROW_PROOF"]) assert(entries.some(e => e.evidence.includes(code as never)));
    assert(entries.every(e => e.originStatus === "UNKNOWN" && e.canonicalEpochMs === null));
  });
  it("nulos não são classificados como instantes desconhecidos ou deslocados", async () => {
    const entries: TemporalInventoryEntry[] = []; await inventoryTemporalFields(database().db, e => { entries.push(e); }); const nulls = entries.filter(e => e.storedEpochMs === null);
    assert.equal(nulls.length, 2); assert(nulls.every(e => e.classification === "NOT_APPLICABLE" && e.canonicalEpochMs === null));
  });
  it("hash v1 comprova representação assinada, sem inventar origem de gravação", async () => {
    const entries: TemporalInventoryEntry[] = []; const s = await inventoryTemporalFields(database({ audit: true }).db, e => { entries.push(e); }); const audit = entries.find(e => e.model === "AuditEvent")!;
    assert.equal(audit.classification, "PARTIAL"); assert.equal(audit.encodingStatus, "PROVEN"); assert.equal(audit.originStatus, "UNKNOWN"); assert.equal(audit.candidateOrigin, "UNKNOWN"); assert.equal(audit.sourceTimeZone, "America/Sao_Paulo");
    assert.equal(audit.canonicalEpochMs, Date.parse("2026-10-26T15:00:00Z").toString()); assert.equal(s.partial, 1); assert.equal(s.provenEncodings, 1); assert.equal(s.provenOrigins, 0); assert.equal(s.proven, 0);
  });
  it("cadeia inválida permanece UNKNOWN, sem tentar reparo", async () => {
    const entries: TemporalInventoryEntry[] = []; const s = await inventoryTemporalFields(database({ audit: true, invalidHash: true }).db, e => { entries.push(e); });
    const audit = entries.find(e => e.model === "AuditEvent")!; assert.equal(audit.classification, "UNKNOWN"); assert.deepEqual(audit.evidence, ["AUDIT_CHAIN_UNVERIFIED"]); assert.equal(s.partial, 0);
  });
  it("cadeia mista preserva a prova v1 sem classificar v2 como legado", async () => {
    const original = database({ audit: true }).db;
    const v2Id = "00000000-0000-4000-8000-000000000004";
    const v2 = {
      id: v2Id, sequence: 2n, action: "AUCTION_CLOSED" as const, entityType: "Auction", entityId: id,
      occurredAt: new Date("2026-10-27T15:00:00Z"), publicData: { formatVersion: 2, status: "CLOSED" },
      previousHash: "03d14d0c649ff543ae7baede3ff085206d8423b68ca9588c7c6b8cff69c08b60",
    };
    const db: InventoryDatabase = { async query(sql, parameters) {
      const result = await original.query(sql, parameters);
      if (sql.includes('"sequence"::text')) {
        assert(sql.includes(`"publicData"->'formatVersion' = '2'::jsonb`));
        result.rows.push({ ...v2, sequence: "2", currentHash: openingAuditHash(v2), canonicalEpochMs: v2.occurredAt.getTime().toString() });
      } else if (sql.includes('FROM "AuditEvent"')) result.rows.push({ id: v2Id, occurredAt: v2.occurredAt.getTime().toString() });
      return result;
    } };
    const entries: TemporalInventoryEntry[] = [];
    await inventoryTemporalFields(db, e => { entries.push(e); });
    const audit = entries.filter(e => e.model === "AuditEvent");
    assert.equal(audit.length, 2);
    assert.equal(audit[0]?.encodingStatus, "PROVEN");
    assert.equal(audit[1]?.candidateEncoding, "UNKNOWN");
    assert(!audit[1]?.evidence.includes("AUDIT_V1_SIGNED_REPRESENTATION_MATCH"));
  });
  it("projeção explícita não publica nomes, e-mails, saldos, hashes ou dados de auditoria", async () => {
    const entries: TemporalInventoryEntry[] = []; await inventoryTemporalFields(database({ audit: true }).db, e => { entries.push(e); }); const json = JSON.stringify(entries);
    for (const forbidden of ["private@example", "passwordHash", "balance", "lotIds", "currentHash", "publicData"]) assert(!json.includes(forbidden));
    assert.deepEqual(Object.keys(entries[0]).sort(), ["model", "field", "id", "storedEpochMs", "candidateOrigin", "candidateEncoding", "originStatus", "encodingStatus", "classification", "sourceTimeZone", "canonicalEpochMs", "evidence"].sort());
  });
  it("paginação por UUID não perde nem duplica valores", async () => {
    const seen = new Set<string>(); const s = await inventoryTemporalFields(database({ users: 501 }).db, e => { const key = `${e.model}:${e.id}:${e.field}`; assert(!seen.has(key)); seen.add(key); });
    assert.equal(s.values, 1020); assert.equal(seen.size, s.values);
  });
  it("abre snapshot READ ONLY antes de ler, não executa DML e termina em COMMIT", async () => {
    const { db, queries } = database(); await inventoryTemporalFields(db); assert.equal(queries[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"); assert.equal(queries.at(-1), "COMMIT");
    assert(queries.every(sql => /^(BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY|SELECT|COMMIT)/.test(sql))); assert(queries.some(sql => sql.includes("EXTRACT(EPOCH")));
  });
  it("falha de consulta ou saída causa ROLLBACK, sem resumo bem-sucedido", async () => {
    for (const fail of [true, false]) { const { db, queries } = database({ fail }); await assert.rejects(inventoryTemporalFields(db, () => { throw new Error("output failure"); })); assert.equal(queries.at(-1), "ROLLBACK"); assert(!queries.includes("COMMIT")); }
  });
  it("não converte epochs inseguros ou infinitos silenciosamente", async () => {
    for (const invalid of [Infinity, "Infinity", 1793026800000, "1.5"]) await assert.rejects(inventoryTemporalFields(database({ epoch: invalid }).db));
  });
  it("CLI rejeita argumentos sem ecoar credenciais nem conectar", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", resolve(__dirname, "../src/scripts/inventory-temporal.ts"), "--secret=private-example-value"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgresql://private-user:private-pass@localhost/private-db" } });
    assert.equal(result.status, 1); assert.equal(result.stdout, ""); for (const value of ["private-example", "private-user", "private-pass", "postgresql://"]) assert(!result.stderr.includes(value));
  });
});
describe("Contratos dos metadados temporais (sem persistência)", () => {
  const base = (): TemporalFieldMetadata => ({ model: "Lot", field: "endsAt", id, revision: 1, encoding: TemporalEncoding.UNKNOWN, origin: TemporalOrigin.UNKNOWN, sourceTimeZone: null, storedEpochMs: 123n, canonicalEpochMs: null, evidenceCode: "NO_ROW_PROVENANCE", recordedAt: new Date() });
  it("aceita UNKNOWN e preserva o epoch físico sem fabricar um canônico", () => { assert.doesNotThrow(() => assertTemporalMetadata(base())); });
  it("UTC exige igualdade exata dos epochs", () => {
    assert.doesNotThrow(() => assertTemporalMetadata({ ...base(), encoding: TemporalEncoding.UTC_INSTANT, canonicalEpochMs: 123n })); assert.throws(() => assertTemporalMetadata({ ...base(), encoding: TemporalEncoding.UTC_INSTANT, canonicalEpochMs: 124n }));
  });
  it("legado exige zona válida e ambos os epochs", () => {
    const legacy = { ...base(), encoding: TemporalEncoding.LEGACY_ADAPTER_WALL_CLOCK, sourceTimeZone: "America/Sao_Paulo", canonicalEpochMs: 1n };
    assert.doesNotThrow(() => assertTemporalMetadata(legacy)); assert.throws(() => assertTemporalMetadata({ ...legacy, sourceTimeZone: "invalid-zone" })); assert.throws(() => assertTemporalMetadata({ ...legacy, canonicalEpochMs: null }));
  });
  it("UNKNOWN, nulos, revisões e combinações modelo/campo são estritos", () => {
    assert.doesNotThrow(() => assertTemporalMetadata({ ...base(), storedEpochMs: null }));
    for (const patch of [{ revision: 0 }, { revision: 1.5 }, { canonicalEpochMs: 1n }, { id: "invalid" }, { field: "startsAt" }, { recordedAt: new Date(NaN) }, { evidenceCode: "arbitrary-private-text" }]) assert.throws(() => assertTemporalMetadata({ ...base(), ...patch } as TemporalFieldMetadata));
  });
});
