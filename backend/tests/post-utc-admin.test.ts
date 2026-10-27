import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { copyValue, parseBackup, physicalMicros } from "../src/scripts/verify-post-utc-admin";

const tables = ["Auction", "AuctionReceipt", "AuditEvent", "Bid", "BidReservation", "Lot", "User", "Vehicle", "Wallet", "WalletTransaction", "_prisma_migrations"];
function dump() { return tables.map(table => `COPY public."${table}" (id, description) FROM stdin;\nid-1\ttexto\\tcom\\nquebra\n\\.\n`).join("\n"); }
describe("Comparacao pos-migracao, somente fixtures sem banco", () => {
  it("distingue NULL do texto literal e decodifica COPY", () => {
    assert.equal(copyValue("\\N"), null);
    assert.equal(copyValue("\\\\N"), "\\N");
    assert.equal(copyValue("texto\\tcom\\nquebra\\\\fim"), "texto\tcom\nquebra\\fim");
  });
  it("preserva instantes fisicos e microssegundos independentemente do offset", () => {
    assert.equal(physicalMicros("2026-10-27 15:00:00.123456+00"), physicalMicros("2026-10-27 12:00:00.123456-03:00"));
    assert.notEqual(physicalMicros("2026-10-27 15:00:00.123456+00"), physicalMicros("2026-10-27 15:00:00.123457+00"));
    assert.equal(physicalMicros("2026-10-27 15:00:00+00"), physicalMicros("2026-10-27 15:00:00.000000+00"));
  });
  it("nao aceita timestamp sem offset comprovado", () => {
    assert.throws(() => physicalMicros("2026-10-27 15:00:00"));
  });
  it("le dados das onze tabelas sem executar instrucoes do dump", () => {
    const result = parseBackup("SELECT funcao_que_nao_deve_ser_executada();\n" + dump());
    assert.equal(result.size, 11);
    assert.deepEqual(result.get("User")?.rows, [["id-1", "texto\tcom\nquebra"]]);
  });
  it("rejeita tabela ausente, duplicada, desconhecida e COPY truncado", () => {
    for (const sql of ["", dump() + dump(), dump().replace('public."User"', 'public."Unknown"'), dump().slice(0, -4)]) {
      assert.throws(() => parseBackup(sql));
    }
  });
  it("rejeita linhas com campos faltantes", () => {
    assert.throws(() => parseBackup(dump().replace("id-1\t", "")));
  });
});
