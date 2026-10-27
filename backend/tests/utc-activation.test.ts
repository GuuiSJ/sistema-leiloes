import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { temporalMode, temporalPoolConfig } from "../src/config/temporal";
import { TemporalRuntime, generatedTemporalSupport } from "../src/modules/temporal/temporal-runtime";
import { createAuctionRepository } from "../src/modules/auctions/auction.repository";
import { validateCreate, validatePatch } from "../src/modules/auctions/auction.validation";
import { SettlementWorker } from "../src/workers/settlement-worker";
import type { SettlementRepository } from "../src/modules/settlement/settlement.repository";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { temporalRepresentation } from "../src/middlewares/temporal-representation";
import type { Request, Response } from "express";

function candidate(options: { present?: boolean; compatible?: boolean; applied?: boolean; active?: boolean; valid?: boolean; timezone?: string; offset?: number; parameterOffset?: number; activated?: boolean; ormError?: boolean; auditHash?: string; gate?: Promise<void> } = {}) {
  const queries: string[] = [], writes: object[] = [];
  const client = {
    async $queryRaw(sql: TemplateStringsArray) {
      const query = sql.join("?"); queries.push(query);
      if (query.includes("pg_attribute") && query.includes('AS "present"')) return [{ present: options.present ?? true, compatible: options.compatible ?? true }];
      if (query.includes('"_prisma_migrations"')) return [{ applied: options.applied ?? true }];
      if (query.includes('AS "active"')) return [{ active: options.active ?? false }];
      if (query.includes('AS "valid"')) return [{ valid: options.valid ?? true }];
      if (query.includes('AS "activated"')) return [{ activated: options.activated ?? false }];
      if (query.includes('FROM "AuditEvent" ORDER')) return options.auditHash ? [{
        id: "00000000-0000-4000-8000-000000000001", sequence: 1n, action: "AUCTION_CLOSED", entityType: "Auction",
        entityId: "00000000-0000-4000-8000-000000000002", publicData: { formatVersion: 2, status: "CLOSED" },
        milliseconds: 0n, previousHash: null, currentHash: options.auditHash,
      }] : [];
      if (query.includes("WITH instant")) {
        await options.gate;
        return [{ timezone: options.timezone ?? "UTC", observed: new Date(1000 + (options.offset ?? 0)), milliseconds: 1000n,
          parameter: BigInt(Date.parse("2030-01-01T15:00:00.123Z") + (options.parameterOffset ?? 0)) }];
      }
      throw new Error("Consulta inesperada no mock");
    },
    async $transaction(fn: (tx: object) => Promise<unknown>, settings: { isolationLevel: string }) {
      assert.equal(settings.isolationLevel, "RepeatableRead"); return fn(client);
    },
    auction: {
      async findFirst({ select }: { select: object }) {
        assert.deepEqual(select, { id: true, temporalGeneration: true });
        if (options.ormError) throw new Error("client incompatível");
        return null;
      },
      async create({ data }: { data: object }) { writes.push(data); return data; },
    },
  } as unknown as PrismaClient;
  return { client, queries, writes };
}
const input = { title: "UTC", description: null, startsAt: new Date("2030-01-01T15:00:00Z"), endsAt: new Date("2030-01-01T16:00:00Z") };
const unavailable = (e: unknown) => e instanceof HttpError && e.status === 503;

describe("Preparacao da ativacao UTC_V2 sem banco", () => {
  it("default e LEGACY; apenas a opcao exata UTC_V2 solicita ativacao", () => {
    assert.equal(temporalMode({}), "LEGACY"); assert.equal(temporalMode({ AUCTION_TEMPORAL_MODE: "UTC_V2" }), "UTC_V2");
    for (const value of ["UTC", "true", "utc_v2", "", " UTC_V2 "]) assert.throws(() => temporalMode({ AUCTION_TEMPORAL_MODE: value }));
  });
  it("configura UTC na abertura de cada conexao, sem alterar o modo LEGACY", () => {
    assert.equal(temporalPoolConfig("postgresql://fixture@localhost/test", "UTC_V2").options, "-c timezone=UTC");
    assert.equal(temporalPoolConfig("postgresql://fixture@localhost/test", "LEGACY").options, undefined);
    for (const key of ["options", "TimeZone", "tz", "opt%69ons"]) {
      assert.throws(() => temporalPoolConfig(`postgresql://fixture@localhost/test?${key}=private`, "UTC_V2"), e => e instanceof Error && !e.message.includes("private"));
    }
  });
  it("verifica o suporte real do client instalado sem gerar arquivos", () => {
    assert.equal(generatedTemporalSupport(), Object.keys(Prisma.AuctionScalarFieldEnum).includes("temporalGeneration"));
  });
  it("client desatualizado impede ativacao antes de consultar o banco", async () => {
    const db = candidate(), runtime = new TemporalRuntime("UTC_V2", () => false);
    await assert.rejects(runtime.verify(db.client), /PRISMA_CLIENT_DESATUALIZADO/);
    assert.equal(db.queries.length, 0); assert.equal(runtime.utcActive, false);
  });
  for (const [options, code] of [
    [{ present: false }, "SCHEMA_CLIENT_INCOMPATIVEIS"], [{ compatible: false }, "SCHEMA_CLIENT_INCOMPATIVEIS"],
    [{ applied: false }, "MIGRACAO_NAO_CONFIRMADA"], [{ active: true }, "OPERACOES_LEGACY_ATIVAS"],
    [{ valid: false }, "TIPOS_TEMPORAIS_INCOMPATIVEIS"], [{ timezone: "America/Sao_Paulo" }, "UTC_EPOCH_INCOMPATIVEL"],
    [{ offset: -10800000 }, "UTC_EPOCH_INCOMPATIVEL"], [{ parameterOffset: 10800000 }, "UTC_EPOCH_INCOMPATIVEL"],
    [{ ormError: true }, "client incompatível"], [{ auditHash: "a".repeat(64) }, "auditoria"],
  ] as const) it(`falha fechada: ${code} ${JSON.stringify(options)}`, async () => {
    const db = candidate(options), runtime = new TemporalRuntime("UTC_V2", () => true);
    await assert.rejects(runtime.verify(db.client), e => e instanceof Error && e.message.includes(code));
    assert.equal(runtime.utcActive, false); assert.equal(runtime.workerReady, false);
    assert.throws(() => runtime.creationGeneration(), unavailable); assert.equal(db.writes.length, 0);
  });
  it("LEGACY pre-migracao permanece sem UTC e sem worker", async () => {
    const runtime = new TemporalRuntime("LEGACY", () => false), db = candidate({ present: false });
    await runtime.verify(db.client);
    assert.equal(runtime.creationGeneration(), undefined); assert.equal(runtime.workerReady, false);
    assert(db.queries.every(query => !query.includes('WHERE "temporalGeneration"')));
  });
  it("proibe downgrade para LEGACY depois de eventos v2", async () => {
    const runtime = new TemporalRuntime("LEGACY", () => true);
    await assert.rejects(runtime.verify(candidate({ activated: true }).client), /RETORNO_A_LEGACY_PROIBIDO/);
  });
  it("so grava UTC_V2 explicitamente depois da verificacao completa", async () => {
    const db = candidate(), runtime = new TemporalRuntime("UTC_V2", () => true), repo = createAuctionRepository(() => db.client, runtime);
    assert.throws(() => repo.create(input, "owner"), unavailable);
    assert.equal(db.writes.length, 0);
    await runtime.verify(db.client);
    await repo.create(input, "owner");
    assert.deepEqual(db.writes[0], { ...input, organizerId: "owner", status: "DRAFT", temporalGeneration: "UTC_V2" });
    runtime.reset(); assert.throws(() => repo.create(input, "owner"), unavailable);
    assert.equal(runtime.workerReady, false);
  });
  it("criacao em LEGACY omite marcador e nunca promove dados existentes", async () => {
    const db = candidate({ present: false }), runtime = new TemporalRuntime("LEGACY", () => false);
    assert.throws(() => runtime.creationGeneration(), unavailable);
    await runtime.verify(db.client);
    await createAuctionRepository(() => db.client, runtime).create(input, "owner");
    assert(!("temporalGeneration" in db.writes[0]!));
  });
  it("nova verificacao que falha revoga a liberacao anterior", async () => {
    const runtime = new TemporalRuntime("UTC_V2", () => true);
    await runtime.verify(candidate().client); assert.equal(runtime.utcActive, true);
    await assert.rejects(runtime.verify(candidate({ applied: false }).client));
    assert.equal(runtime.utcActive, false); assert.throws(() => runtime.creationGeneration(), unavailable);
  });
  it("HTTP e repositorio rejeitam marcador do cliente, inclusive UTC_V2", () => {
    for (const temporalGeneration of ["LEGACY", "UTC_V2", null]) {
      const body = { title: "Teste", startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), temporalGeneration };
      assert.throws(() => validateCreate(body)); assert.throws(() => validatePatch(body));
      assert.throws(() => createAuctionRepository(() => candidate().client).create({ ...input, ...{ temporalGeneration } }, "owner"));
    }
  });
  it("worker nao descobre candidatos durante verificacao, falha ou depois de reset", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const runtime = new TemporalRuntime("UTC_V2", () => true), db = candidate({ gate });
    let calls = 0, processed!: () => void;
    const firstCycle = new Promise<void>(resolve => { processed = resolve; });
    const repository: SettlementRepository = { async candidates() { calls++; processed(); return []; }, async settle() { throw new Error("Nenhuma liquidacao esperada"); } };
    const worker = new SettlementWorker(repository, undefined, 60000, 25, () => runtime.workerReady);
    const verification = runtime.verify(db.client);
    try {
      worker.start(); await worker.tick(); assert.equal(calls, 0);
      release(); await verification; worker.start(); await firstCycle;
      runtime.reset(); await worker.tick(); assert.equal(calls, 1);
    } finally { release(); await worker.stop(); }
  });
  it("bootstrap valida banco antes de abrir HTTP e iniciar worker", () => {
    const source = readFileSync(resolve(__dirname, "../src/server.ts"), "utf8");
    assert(source.indexOf("await connectDatabase()") < source.indexOf("server = createServer(app)"));
    assert(source.indexOf("await connectDatabase()") < source.indexOf("settlementWorker.start()"));
  });
  it("respostas UTC explicam historico UNKNOWN sem alterar datas ou hashes", () => {
    for (const active of [false, true]) {
      let output: unknown;
      const body = { data: { startsAt: "2030-01-01T18:00:00.000Z", currentHash: "a".repeat(64) } };
      const res = { statusCode: 200, json(value: unknown) { output = value; return this; } } as unknown as Response;
      temporalRepresentation(() => active)({} as Request, res, () => {});
      res.json(body);
      assert.deepEqual((output as typeof body).data, body.data);
      if (active) assert.deepEqual((output as { temporal: object }).temporal, {
        representation: "STORED_UTC_INSTANT", legacyCanonicalMeaning: "UNKNOWN", historicalNormalization: "NONE",
      });
      else assert.deepEqual(output, body);
    }
  });
});
