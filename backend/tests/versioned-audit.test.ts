import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditEvent, Prisma } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { auditFormatVersion, loadAuditChain, openingAuditHash, prepareAuditWriter, verifyOpeningAuditChain } from "../src/modules/audit/opening-audit";

const id = "00000000-0000-4000-8000-000000000001";
const entityId = "00000000-0000-4000-8000-000000000002";
const lotId = "00000000-0000-4000-8000-000000000003";
const instant = new Date("2026-10-26T15:00:00.000Z");
const conflict = (e: unknown) => e instanceof HttpError && e.status === 409;
function fixture(version: number | null = 1): AuditEvent {
  const event: AuditEvent = {
    id, sequence: 1n, authorId: null, action: "AUCTION_OPENED", entityType: "Auction", entityId,
    occurredAt: new Date(instant), previousHash: null, currentHash: "",
    publicData: { ...(version === null ? {} : { formatVersion: version }), status: "OPEN", lotIds: [lotId] },
  };
  event.currentHash = openingAuditHash(event);
  return event;
}
const v2Data = () => ({ formatVersion: 2, status: "CLOSED" });

// Models transaction staging + an exclusive lock. It is not a PostgreSQL/SSI emulator.
function database(seed: AuditEvent[] = [], failInsert = 0) {
  const committed = structuredClone(seed);
  const queries: string[] = [];
  let sequence = seed.at(-1)?.sequence ?? 0n;
  let lockTail = Promise.resolve();
  let inserts = 0;
  async function transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let unlock: (() => void) | undefined, ownsLock = false;
    const staged: AuditEvent[] = [];
    const tx = {
      async $executeRaw(sql: TemplateStringsArray, ...values: unknown[]) {
        const query = sql.join("?"); queries.push(query);
        if (query.startsWith("LOCK TABLE")) {
          const previous = lockTail;
          lockTail = new Promise<void>(resolve => { unlock = resolve; });
          await previous; ownsLock = true; return 0;
        }
        assert(ownsLock, "Insert requires the global chain lock");
        assert(query.startsWith('INSERT INTO "AuditEvent"'));
        if (++inserts === failInsert) throw new Error("Falha simulada do INSERT de auditoria");
        assert(query.includes("to_timestamp(?::double precision / 1000.0)"));
        const [eventId, seq, authorId, action, entityType, target, epoch, json, previousHash, currentHash] = values;
        staged.push({ id: eventId, sequence: seq, authorId, action, entityType, entityId: target,
          occurredAt: new Date(Number(epoch)), publicData: JSON.parse(String(json)), previousHash, currentHash } as AuditEvent);
        return 1;
      },
      async $queryRaw(sql: TemplateStringsArray) {
        const query = sql.join("?"); queries.push(query); assert(ownsLock);
        if (query.includes("nextval")) return [{ sequence: ++sequence }];
        assert(query.includes('FROM "AuditEvent" ORDER BY "sequence"'));
        assert(query.includes("AT TIME ZONE 'America/Sao_Paulo'"));
        assert(query.includes(`"publicData"->'formatVersion' = '2'::jsonb`));
        return committed.map(({ occurredAt, ...event }) => ({ ...event, milliseconds: BigInt(occurredAt.getTime()) }));
      },
    } as unknown as Prisma.TransactionClient;
    try {
      const result = await run(tx);
      committed.push(...staged);
      return result;
    } finally { unlock?.(); }
  }
  return { committed, queries, transaction };
}

describe("Auditoria SHA-256 versionada sem PostgreSQL", () => {
  it("congela v1 explicito e sem versao sem alterar a serializacao original", () => {
    assert.equal(fixture(1).currentHash, "03d14d0c649ff543ae7baede3ff085206d8423b68ca9588c7c6b8cff69c08b60");
    assert.equal(fixture(null).currentHash, "c8ec893ceb0d4b2088d8ef6037359efade6f1bd9e2b6a633a2137963359b908c");
    assert.equal(auditFormatVersion({ status: "OPEN" }), 1);
  });
  it("congela v2 com dominio e timestamp UTC canonicos, independente do offset de entrada", () => {
    const event = fixture(2);
    assert.equal(event.currentHash, "31731cb6fc215951d76254e3b216f73fc26c1329c17867f0918f7160641e9d86");
    assert.equal(openingAuditHash({ ...event, occurredAt: new Date("2026-10-26T12:00:00-03:00") }), event.currentHash);
    assert.notEqual(event.currentHash, fixture(1).currentHash);
  });
  for (const version of [0, 3, -1, "2", null, undefined]) it(`rejeita versao explicita ${String(version)}`, () => {
    assert.throws(() => auditFormatVersion({ formatVersion: version } as unknown as Prisma.JsonObject), conflict);
  });
  it("aceita cadeia mista com lacunas, sem reescrever registros v1", () => {
    const a = fixture(null), before = structuredClone(a);
    const b = { ...fixture(2), sequence: 7n, previousHash: a.currentHash };
    b.currentHash = openingAuditHash(b);
    assert.equal(verifyOpeningAuditChain([a, b]), b.currentHash);
    assert.deepEqual(a, before);
  });
  it("rejeita v1 depois de v2 mesmo com hashes recalculados validos", () => {
    const a = fixture(2), b = { ...fixture(1), sequence: 2n, previousHash: a.currentHash };
    b.currentHash = openingAuditHash(b);
    assert.throws(() => verifyOpeningAuditChain([a, b]), conflict);
  });
  it("detecta adulteracao de timestamp, dados, sequencia, versao e encadeamento", () => {
    const event = fixture(2);
    for (const changed of [
      { ...event, occurredAt: new Date(instant.getTime() + 1) },
      { ...event, occurredAt: new Date(NaN) },
      { ...event, sequence: 2n }, { ...event, previousHash: "a".repeat(64) },
      { ...event, publicData: { formatVersion: 1, status: "OPEN", lotIds: [lotId] } },
      { ...event, publicData: { formatVersion: 2, status: "OPEN", lotIds: [entityId] } },
    ]) assert.throws(() => verifyOpeningAuditChain([changed]), conflict);
  });
  it("nunca tenta outro offset para validar v1", () => {
    const event = fixture(1);
    assert.throws(() => verifyOpeningAuditChain([{ ...event, occurredAt: new Date("2026-10-26T18:00:00Z") }]), conflict);
  });
  it("verifica todos os tipos existentes nas duas versoes com whitelist estrita", () => {
    for (const formatVersion of [1, 2]) for (const [action, entityType, data] of [
      ["AUCTION_OPENED", "Auction", { status: "OPEN", lotIds: [lotId] }],
      ["LOT_OPENED", "Lot", { status: "OPEN", auctionId: entityId, number: 1 }],
      ["LOT_CLOSED", "Lot", { status: "UNSOLD", auctionId: entityId }],
      ["FUNDS_DEBITED", "Lot", { status: "SOLD", auctionId: entityId }],
      ["RECEIPT_ISSUED", "Lot", { status: "SOLD", auctionId: entityId }],
      ["AUCTION_CLOSED", "Auction", { status: "CLOSED" }],
    ] satisfies [AuditEvent["action"], string, Prisma.JsonObject][]) {
      const event = { ...fixture(), action, entityType, publicData: { ...data, formatVersion } };
      assert.match(openingAuditHash(event), /^[0-9a-f]{64}$/);
      for (const key of ["email", "walletId", "balance", "amount", "authorId", "token"]) {
        assert.throws(() => openingAuditHash({ ...event, publicData: { ...event.publicData, [key]: "private" } }), conflict);
      }
    }
  });
  it("loader usa somente epochs projetados e nao a data convertida pelo adapter", async () => {
    const event = fixture();
    const tx = { async $queryRaw() { return [{ ...event, occurredAt: new Date(0), milliseconds: BigInt(instant.getTime()) }]; } } as unknown as Prisma.TransactionClient;
    assert.equal(verifyOpeningAuditChain(await loadAuditChain(tx)), event.currentHash);
    assert.equal(event.occurredAt.toISOString(), instant.toISOString());
  });
  it("primeiro append v2 aponta para ultimo hash v1 e preserva o prefixo historico", async () => {
    const original = fixture(1), db = database([original]);
    await db.transaction(async tx => {
      const append = await prepareAuditWriter(tx);
      await append("AUCTION_CLOSED", "Auction", entityId, v2Data(), null, instant);
    });
    assert.deepEqual(db.committed[0], original);
    assert.equal(db.committed[1]?.previousHash, original.currentHash);
    assert.equal(db.committed[1]?.occurredAt.toISOString(), instant.toISOString());
    assert.equal(verifyOpeningAuditChain(db.committed), db.committed[1]?.currentHash);
    assert(db.queries.every(sql => !/UPDATE|DELETE/.test(sql)));
  });
  for (const seed of [[], [fixture(1)], [fixture(2)]]) it(`writer nao grava v1 com prefixo ${seed.length ? auditFormatVersion(seed[0]!.publicData) : "vazio"}`, async () => {
    const db = database(seed);
    await assert.rejects(db.transaction(async tx => {
      const append = await prepareAuditWriter(tx);
      await append("AUCTION_CLOSED", "Auction", entityId, { formatVersion: 1, status: "CLOSED" }, null, instant);
    }), conflict);
    assert.deepEqual(db.committed, seed);
    assert(!db.queries.some(sql => sql.includes("INSERT") || sql.includes("nextval")));
  });
  it("serializa appends concorrentes na mesma transacao sem bifurcar a cadeia", async () => {
    const db = database();
    await db.transaction(async tx => {
      const append = await prepareAuditWriter(tx);
      await Promise.all(Array.from({ length: 4 }, () => append("AUCTION_CLOSED", "Auction", entityId, v2Data(), null, instant)));
    });
    assert.equal(db.committed.length, 4);
    assert.equal(db.committed.filter(e => e.previousHash === null).length, 1);
    assert(verifyOpeningAuditChain(db.committed));
  });
  it("duas transacoes solicitam lock antes da leitura e continuam uma unica cadeia", async () => {
    const db = database([fixture(1)]);
    await Promise.all(Array.from({ length: 2 }, () => db.transaction(async tx => {
      const append = await prepareAuditWriter(tx);
      await append("AUCTION_CLOSED", "Auction", entityId, v2Data(), null, instant);
    })));
    assert.equal(db.committed.length, 3);
    assert(verifyOpeningAuditChain(db.committed));
    assert.equal(db.queries.filter(sql => sql.startsWith("LOCK TABLE")).length, 2);
  });
  it("rollback descarta appends e permite lacuna de sequencia no proximo commit", async () => {
    const seed = fixture(1), db = database([seed]);
    await assert.rejects(db.transaction(async tx => {
      const append = await prepareAuditWriter(tx);
      await append("AUCTION_CLOSED", "Auction", entityId, v2Data(), null, instant);
      throw new Error("rollback simulado da operacao financeira");
    }));
    assert.deepEqual(db.committed, [seed]);
    await db.transaction(async tx => {
      const append = await prepareAuditWriter(tx);
      await append("AUCTION_CLOSED", "Auction", entityId, v2Data(), null, instant);
    });
    assert.equal(db.committed[1]?.sequence, 3n);
    assert(verifyOpeningAuditChain(db.committed));
  });
  it("cadeia adulterada impede qualquer append antes de alocar sequencia", async () => {
    const db = database([{ ...fixture(), currentHash: "a".repeat(64) }]);
    await assert.rejects(db.transaction(tx => prepareAuditWriter(tx)), conflict);
    assert(!db.queries.some(sql => sql.includes("nextval") || sql.includes("INSERT")));
  });
  it("falha no INSERT aborta a fila e reverte tambem o append anterior", async () => {
    const original = fixture(1), db = database([original], 2);
    await assert.rejects(db.transaction(async tx => {
      const append = await prepareAuditWriter(tx);
      await append("AUCTION_CLOSED", "Auction", entityId, v2Data(), null, instant);
      const results = await Promise.allSettled([
        append("AUCTION_CLOSED", "Auction", entityId, v2Data(), null, instant),
        append("AUCTION_CLOSED", "Auction", entityId, v2Data(), null, instant),
      ]);
      assert(results.every(result => result.status === "rejected"));
      throw new Error("rollback");
    }));
    assert.deepEqual(db.committed, [original]);
    assert.equal(db.queries.filter(sql => sql.startsWith("INSERT")).length, 2);
  });
  it("captura os dados e a data antes de aguardar a fila", async () => {
    const db = database();
    await db.transaction(async tx => {
      const append = await prepareAuditWriter(tx), data = v2Data(), date = new Date(instant);
      const pending = append("AUCTION_CLOSED", "Auction", entityId, data, null, date);
      data.status = "TAMPERED"; date.setTime(0);
      await pending;
    });
    assert.deepEqual(db.committed[0]?.publicData, v2Data());
    assert.equal(db.committed[0]?.occurredAt.toISOString(), instant.toISOString());
  });
});
