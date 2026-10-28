import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma, type Auction, type PrismaClient } from "../src/generated/prisma/client";
import { createScheduledOpeningProcessor, createScheduledOpeningSource } from "../src/workers/scheduled-opening";
import { createAuctionLifecycleRepository } from "../src/modules/auctions/auction-lifecycle.repository";
import { AuctionLifecycleService } from "../src/modules/auctions/auction-lifecycle.service";
import type { LifecycleLot } from "../src/modules/auctions/auction-lifecycle.types";
import { SettlementWorker } from "../src/workers/settlement-worker";
import { HttpError } from "../src/errors/http-error";

function fixture() {
  const owner = randomUUID(), auctionId = randomUUID(), start = new Date("2030-01-01T12:00:00Z");
  const auction: Auction = { id: auctionId, organizerId: owner, temporalGeneration: "UTC_V2", status: "SCHEDULED", title: "Fixture", description: null, startsAt: start, endsAt: new Date(start.getTime() + 3600000), createdAt: start, updatedAt: start };
  const lot: LifecycleLot = { id: randomUUID(), auctionId, vehicleId: randomUUID(), number: 1, status: "PENDING", endsAt: null, startingPrice: new Prisma.Decimal(100), minimumIncrement: new Prisma.Decimal(10), winnerId: null, version: 0, vehicleOwnerId: owner, hasFinancialHistory: false, createdAt: start, updatedAt: start };
  const state = { now: new Date(start.getTime() - 1000), lots: [lot], audits: [] as (string | null)[], updates: 0 };
  const tx = {
    async $queryRaw(sql: TemplateStringsArray) {
      const query = sql.join("");
      if (query.includes('"temporalGeneration"')) return [{ temporalGeneration: auction.temporalGeneration }];
      if (query.includes('clock_timestamp')) return [{ milliseconds: BigInt(state.now.getTime()) }];
      return [{ id: auctionId }];
    },
    auction: { async findUnique() { return auction; }, async update({ data }: { data: { status: "OPEN" } }) { state.updates++; Object.assign(auction, data); return auction; } },
    lot: { async findMany() { return state.lots; }, async updateMany({ data }: { data: { status: "OPEN" } }) { state.lots.forEach(l => { l.status = data.status; l.version++ }); return { count: state.lots.length }; } },
    vehicle: { async findUnique() { return { ownerId: owner }; } },
    bid: { async findFirst() { return null; } }, bidReservation: { async findFirst() { return null; } }, auctionReceipt: { async findUnique() { return null; } },
  };
  const client = { async $transaction(fn: (tx: unknown) => unknown) { return fn(tx); } } as unknown as PrismaClient;
  const repo = createAuctionLifecycleRepository(() => client, async () => async (_auction, _lots, authorId) => { state.audits.push(authorId); }, { automated: true });
  const service = new AuctionLifecycleService(repo);
  const source = { async due() { return auction.status === "SCHEDULED" && state.now >= start && state.now < auction.endsAt ? [{ id: auctionId, organizerId: owner }] : []; } };
  return { auction, lot, state, owner, service, source, start };
}
describe("Abertura agendada no worker existente, somente fixtures", () => {
  it("descoberta exige UTC_V2, SCHEDULED, início alcançado e término futuro no relógio do banco", async () => {
    let query = "", parameters: unknown[] = [];
    const client = { async $queryRaw(sql: TemplateStringsArray, ...values: unknown[]) { query = sql.join("?"); parameters = values; return []; } } as unknown as PrismaClient;
    await createScheduledOpeningSource(() => client).due(25, "cursor");
    assert.match(query, /"temporalGeneration" = 'UTC_V2'/); assert.match(query, /"status" = 'SCHEDULED'/);
    assert.match(query, /"startsAt" <= clock_timestamp\(\)/); assert.match(query, /"endsAt" > clock_timestamp\(\)/);
    assert.deepEqual(parameters, ["cursor", 25]); assert.doesNotMatch(query, /UPDATE|INSERT|DELETE/);
  });
  it("SCHEDULED permanece antes do início e vira OPEN com lotes abertos no ciclo do mesmo worker", async () => {
    const f = fixture(), opening = createScheduledOpeningProcessor(f.source, f.service);
    const closing = { async candidates() { return []; }, async settle() { throw Error("No financial operations permitted"); } };
    const worker = new SettlementWorker(closing, undefined, 60000, 25, () => true, opening);
    worker.start();
    try {
      await delay(5); assert.equal(f.auction.status, "SCHEDULED"); assert.equal(f.lot.status, "PENDING");
      f.state.now = f.start; await worker.tick();
      assert.equal(f.auction.status, "OPEN"); assert.equal(f.lot.status, "OPEN"); assert.equal(f.lot.version, 1);
      assert.deepEqual(f.state.audits, [null]); // Automated opening must not impersonate a human author.
      await worker.tick(); assert.equal(f.state.updates, 1); assert.equal(f.state.audits.length, 1);
    } finally { await worker.stop(); }
  });
  it("reutiliza validações: sem lote, LEGACY, proprietário alterado e prazo encerrado não abrem", async () => {
    for (const problem of ['no-lots', 'legacy', 'owner', 'expired'] as const) {
      const f = fixture(); f.state.now = f.start;
      if (problem === 'no-lots') f.state.lots = [];
      if (problem === 'legacy') f.auction.temporalGeneration = "LEGACY";
      if (problem === 'owner') f.auction.organizerId = randomUUID();
      if (problem === 'expired') f.state.now = f.auction.endsAt;
      // Deliberately bypass discovery filtering to exercise the transactional checks as well.
      const process = createScheduledOpeningProcessor({ async due() { return [{ id: f.auction.id, organizerId: f.owner }]; } }, f.service);
      await process(25, () => true);
      assert.equal(f.auction.status, "SCHEDULED", problem); assert.equal(f.lot.status, "PENDING"); assert.equal(f.state.updates, 0); assert.deepEqual(f.state.audits, []);
    }
  });
  it("não consulta nem abre quando UTC está indisponível ou o worker foi parado", async () => {
    let called = 0;
    const process = createScheduledOpeningProcessor({ async due() { called++; return []; } }, { async transition() { throw Error('Must not run'); } });
    await process(25, () => false); assert.equal(called, 0);
  });
  it("falha individual não impede a próxima abertura e o cursor não deixa erros monopolizarem lotes", async () => {
    const seen: string[] = [], cursors: string[] = [];
    const process = createScheduledOpeningProcessor({ async due(_limit, after) { cursors.push(after); return after ? [] : [{ id: 'bad', organizerId: 'owner' }, { id: 'good', organizerId: 'owner' }]; } }, {
      async transition(id) { seen.push(id); if (id === 'bad') throw new HttpError(409, 'fixture'); return { auction: fixture().auction, openedLots: 1, unchanged: false }; },
    });
    await process(25, () => true); assert.deepEqual(seen, ['bad', 'good']);
    await process(25, () => true); assert(cursors.includes('good')); assert.equal(seen.length, 4);
  });
  it("falha de descoberta da abertura não desativa o encerramento existente", async () => {
    let reached!: () => void; const done = new Promise<void>(resolve => { reached = resolve });
    const closing = { async candidates() { reached(); return []; }, async settle() { return {}; } };
    const worker = new SettlementWorker(closing, undefined, 60000, 25, () => true, async () => { throw Error('offline'); });
    worker.start(); await done; await worker.stop();
  });
});
