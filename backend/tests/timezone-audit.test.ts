import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditEvent } from "../src/generated/prisma/client";
import { openingAuditHash, verifyOpeningAuditChain } from "../src/modules/audit/opening-audit";

// Frozen, synthetic v1 vector. Not copied from production, no personal data.
const legacy: AuditEvent = {
  id: "00000000-0000-4000-8000-000000000001", sequence: 1n, authorId: null,
  action: "AUCTION_OPENED", entityType: "Auction", entityId: "00000000-0000-4000-8000-000000000002",
  occurredAt: new Date("2026-10-26T15:00:00Z"),
  publicData: { formatVersion: 1, status: "OPEN", lotIds: ["00000000-0000-4000-8000-000000000003"] },
  previousHash: null, currentHash: "03d14d0c649ff543ae7baede3ff085206d8423b68ca9588c7c6b8cff69c08b60",
};
describe("Contrato temporal congelado da auditoria v1", () => {
  it("preserva o hash anterior byte a byte e sua verificação", () => {
    assert.equal(openingAuditHash(legacy), legacy.currentHash); assert.equal(verifyOpeningAuditChain([legacy]), legacy.currentHash);
  });
  it("trocar só a interpretação da data invalida o hash, sem modificar o evento", () => {
    const original = legacy.occurredAt.toISOString();
    assert.throws(() => verifyOpeningAuditChain([{ ...legacy, occurredAt: new Date("2026-10-26T18:00:00Z") }]));
    assert.equal(legacy.occurredAt.toISOString(), original); assert.equal(openingAuditHash(legacy), legacy.currentHash);
  });
  it("não confunde reconstrução legada com permissão para adulterar timestamps", () => {
    assert.throws(() => verifyOpeningAuditChain([{ ...legacy, occurredAt: new Date(legacy.occurredAt.getTime() + 1) }]));
    assert.throws(() => verifyOpeningAuditChain([{ ...legacy, previousHash: "a".repeat(64) }]));
  });
});
