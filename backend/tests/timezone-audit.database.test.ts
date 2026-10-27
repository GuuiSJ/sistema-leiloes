import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withReadonlyTimezones } from "./helpers/timezone-database";
import { verifyOpeningAuditChain } from "../src/modules/audit/opening-audit";

describe("Auditoria existente e projeções temporais (somente leitura imposta pelo banco)", { skip: process.env.POSTGRES_TIMEZONE_DATABASE_TESTS !== "1" }, () => {
  it("cadeia legada válida falha quando apenas lida em UTC", async t => withReadonlyTimezones(async (legacy, utc) => {
    const events = await legacy.auditEvent.findMany({ orderBy: { sequence: "asc" } });
    if (!events.length) { t.skip("Não existem eventos legados neste banco; o vetor sintético é coberto sem banco."); return; }
    assert(events.every(e => (e.publicData as { formatVersion?: number }).formatVersion === 1), "Caracterização requer eventos legados v1; rever após o rollout versionado.");
    const cutoff = events.at(-1)!.sequence;
    const utcEvents = await utc.auditEvent.findMany({ where: { sequence: { lte: cutoff } }, orderBy: { sequence: "asc" } });
    assert.doesNotThrow(() => verifyOpeningAuditChain(events));
    assert.throws(() => verifyOpeningAuditChain(utcEvents));
    assert.equal(utcEvents.length, events.length);
  }));
  it("reconstrói v1 em memória usando zona IANA e preserva registros/hashes físicos", async t => withReadonlyTimezones(async (legacy, utc) => {
    const events = await legacy.auditEvent.findMany({ orderBy: { sequence: "asc" } });
    if (!events.length) { t.skip("Sem eventos legados para a verificação somente leitura."); return; }
    const cutoff = events.at(-1)!.sequence;
    const fingerprint = async () => {
      const [r] = await utc.$queryRaw<{ digest: string }[]>`SELECT md5(COALESCE(string_agg(row_to_json(a)::text, '' ORDER BY "sequence"), '')) AS digest FROM "AuditEvent" a WHERE "sequence" <= ${cutoff}::bigint`;
      return r.digest;
    };
    const before = await fingerprint();
    const raw = await utc.auditEvent.findMany({ where: { sequence: { lte: cutoff } }, orderBy: { sequence: "asc" } });
    const times = await utc.$queryRaw<{ id: string; milliseconds: bigint }[]>`SELECT "id", (EXTRACT(EPOCH FROM (("occurredAt" AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC')) * 1000)::bigint AS milliseconds FROM "AuditEvent" WHERE "sequence" <= ${cutoff}::bigint`;
    const byId = new Map(times.map(e => [e.id, e.milliseconds]));
    const projected = raw.map(e => ({ ...e, occurredAt: new Date(Number(byId.get(e.id)!)) }));
    assert.equal(verifyOpeningAuditChain(projected), verifyOpeningAuditChain(events));
    assert(projected.every((e, i) => e.currentHash === raw[i].currentHash && e.previousHash === raw[i].previousHash && e.sequence === raw[i].sequence));
    assert.equal(await fingerprint(), before, "A projeção não pode alterar registros históricos.");
    if (projected.length) assert.throws(() => verifyOpeningAuditChain(projected.map((e, i) => i === 0 ? { ...e, occurredAt: new Date(e.occurredAt.getTime() + 1) } : e)));
  }));
});
