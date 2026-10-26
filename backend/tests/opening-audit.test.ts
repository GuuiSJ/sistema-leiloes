import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AuditEvent, Prisma } from "../src/generated/prisma/client";
import { openingAuditHash, verifyOpeningAuditChain } from "../src/modules/audit/opening-audit";

describe("Formato e verificação da auditoria de abertura", () => {
  function event(): AuditEvent {
    const entry: AuditEvent = { id: randomUUID(), sequence: 1n, authorId: randomUUID(), action: "AUCTION_OPENED", entityType: "Auction", entityId: randomUUID(), occurredAt: new Date("2026-10-26T15:00:00Z"), publicData: { formatVersion: 1, status: "OPEN", lotIds: [randomUUID()] }, previousHash: null, currentHash: "" };
    entry.currentHash = openingAuditHash(entry); return entry;
  }
  it("gera SHA-256 com canonicalização de chaves e verificação sem autor privado", () => {
    const a = event(), data = a.publicData as Prisma.JsonObject;
    const b = { ...a, authorId: randomUUID(), publicData: { status: "OPEN", lotIds: data.lotIds, formatVersion: 1 } };
    assert.equal(openingAuditHash(a), openingAuditHash(b)); assert.match(a.currentHash, /^[0-9a-f]{64}$/); assert.equal(verifyOpeningAuditChain([a]), a.currentHash);
  });
  it("aceita lacunas de sequência e exige vínculo correto entre hashes", () => {
    const a = event(), b = event(); b.sequence = 5n; b.previousHash = a.currentHash; b.currentHash = openingAuditHash(b);
    assert.equal(verifyOpeningAuditChain([a, b]), b.currentHash); assert.throws(() => verifyOpeningAuditChain([b, a]));
  });
  it("rejeita alteração de dados públicos, sequência, data e raiz duplicada", () => {
    const a = event();
    for (const changed of [{ ...a, sequence: 2n }, { ...a, occurredAt: new Date(0) }, { ...a, entityId: randomUUID() }]) assert.throws(() => verifyOpeningAuditChain([changed]));
    const b = event(); b.sequence = 2n; b.currentHash = openingAuditHash(b); assert.throws(() => verifyOpeningAuditChain([a, b]));
  });
  it("rejeita dados privados e ações ou formatos desconhecidos antes de gravar", () => {
    const a = event();
    assert.throws(() => openingAuditHash({ ...a, publicData: { ...(a.publicData as Prisma.JsonObject), email: "private@example.com" } }));
    assert.throws(() => openingAuditHash({ ...a, action: "BID_PLACED" }));
    assert.throws(() => openingAuditHash({ ...a, publicData: { formatVersion: 2, status: "OPEN", lotIds: [randomUUID()] } }));
  });
});
