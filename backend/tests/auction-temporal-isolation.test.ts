import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { createBidRepository } from "../src/modules/bids/bid.repository";
import { createAuctionLifecycleRepository } from "../src/modules/auctions/auction-lifecycle.repository";
import { createSettlementRepository } from "../src/modules/settlement/settlement.repository";
import { createAuctionRepository } from "../src/modules/auctions/auction.repository";
import { createLotRepository } from "../src/modules/lots/lot.repository";
import { createVehicleRepository } from "../src/modules/vehicles/vehicle.repository";
import { createReceiptRepository } from "../src/modules/receipts/receipt.repository";
import { requireOperationalAuction, rejectClientGeneration } from "../src/modules/temporal/auction-generation";

const conflict = (e: unknown) => e instanceof HttpError && e.status === 409;
const auctionId = randomUUID(), lotId = randomUUID(), userId = randomUUID(), bidId = randomUUID();
const amount = new Prisma.Decimal(100);

// Unexpected access is fatal: blocked transactions cannot touch any write delegate.
function clientFor(tx: object): PrismaClient {
  return { async $transaction(fn: (tx: object) => Promise<unknown>, options: { isolationLevel: string }) {
    assert.equal(options.isolationLevel, "Serializable");
    return fn(tx);
  } } as unknown as PrismaClient;
}

describe("Isolamento temporal nos repositorios reais, sem banco", () => {
  for (const marker of ["LEGACY", undefined, null, "FUTURE"]) it(`falha fechada para marcador ${marker}`, () => {
    assert.throws(() => requireOperationalAuction({ temporalGeneration: marker }), conflict);
  });
  it("aceita somente UTC_V2 e rejeita marcador fornecido pelo chamador", () => {
    requireOperationalAuction({ temporalGeneration: "UTC_V2" });
    for (const temporalGeneration of ["LEGACY", "UTC_V2", undefined]) {
      assert.throws(() => rejectClientGeneration({ temporalGeneration }), e => e instanceof HttpError && e.status === 400);
    }
  });

  it("consultas historicas de lotes, lances e comprovantes nao exigem geracao nem escrevem", async () => {
    const legacyLot = { id: lotId, auctionId, auction: { temporalGeneration: "LEGACY" } };
    const bid = { id: bidId, lotId, amount, sequence: 1 };
    const receipt = { publicId: randomUUID(), lotId, winningBidId: bidId, finalAmount: amount };
    const tx = {
      auction: { async findUnique() { return { id: auctionId }; } },
      lot: {
        async findMany() { return [legacyLot]; }, async count() { return 1; },
        async findFirst() { return legacyLot; },
        async findUnique() { return { ...legacyLot, receipt }; },
      },
      bid: { async findMany() { return [bid]; }, async count() { return 1; } },
    };
    const client = { ...tx, async $transaction(fn: (tx: object) => Promise<unknown>, options: { isolationLevel: string }) {
      assert.equal(options.isolationLevel, "RepeatableRead"); return fn(tx);
    } } as unknown as PrismaClient;
    const before = JSON.stringify({ legacyLot, bid, receipt });
    const lots = createLotRepository(() => client);
    assert.equal((await lots.list(auctionId, { page: 1, limit: 10 })).total, 1);
    assert.equal((await lots.findById(auctionId, lotId))?.id, lotId);
    assert.equal((await createBidRepository(() => client).list(lotId, { page: 1, limit: 10 })).bids[0]?.id, bidId);
    assert.equal((await createReceiptRepository(() => client).find(lotId))?.receipt?.publicId, receipt.publicId);
    assert.equal(JSON.stringify({ legacyLot, bid, receipt }), before);
  });

  it("edicao transacional nao aceita prazo LEGACY nem promocao pelo callback", async () => {
    let generation = "LEGACY";
    const tx = {
      async $queryRaw() { return [{ temporalGeneration: generation }]; },
      auction: { async findUnique() { return { id: auctionId }; } },
      lot: { async findFirst() { return null; } },
    };
    const repo = createAuctionRepository(() => clientFor(tx));
    await assert.rejects(repo.mutate(auctionId, () => ({ endsAt: new Date() })), conflict);
    generation = "UTC_V2";
    await assert.rejects(repo.mutate(auctionId, () => ({ title: "Attempt", ...{ temporalGeneration: "UTC_V2" } })), e => e instanceof HttpError && e.status === 400);
  });

  for (const operation of ["create", "update", "delete"] as const) it(`lote LEGACY nao permite ${operation}, mesmo com validacao permissiva`, async () => {
    const initial = { id: lotId, auctionId, vehicleId: randomUUID() };
    const tx = {
      async $queryRaw() { return [{ temporalGeneration: "LEGACY" }]; },
      auction: { async findUnique() { return { id: auctionId }; } },
      vehicle: { async findUnique() { return { id: initial.vehicleId }; } },
      lot: { async findFirst() { return { ...initial, _count: { bids: 0, reservations: 0 }, receipt: null }; } },
      auditEvent: { async findFirst() { return null; } },
    };
    const input = { vehicleId: initial.vehicleId, number: 1, startingPrice: "100", minimumIncrement: "10" };
    await assert.rejects(createLotRepository(() => clientFor(tx)).write({ operation, auctionId, lotId, input }, () => {}), conflict);
  });

  for (const operation of ["update", "delete"] as const) it(`veiculo vinculado a LEGACY nao permite ${operation}`, async () => {
    const tx = {
      async $queryRaw() { return [{ temporalGeneration: "LEGACY" }]; },
      vehicle: { async findUnique() { return { id: randomUUID() }; } },
      lot: { async findMany() { return []; } },
      auditEvent: { async findFirst() { return null; } },
    };
    await assert.rejects(createVehicleRepository(() => clientFor(tx)).mutate(randomUUID(), () => operation === "delete" ? { operation } : { operation, data: {} }), conflict);
  });

  it("UTC_V2 continua encerrando lote sem lance e leilao, com auditoria", async () => {
    let lotStatus = "OPEN", sequence = 0n;
    const writes: string[] = [];
    const lot = () => ({ id: lotId, auctionId, status: lotStatus, winnerId: null, version: 0, endsAt: null });
    const tx = {
      async $queryRaw(sql: TemplateStringsArray) {
        const query = sql.join("");
        if (query.includes('"temporalGeneration"')) return [{ temporalGeneration: "UTC_V2" }];
        if (query.includes("clock_timestamp")) return [{ milliseconds: BigInt(Date.now()) }];
        if (query.includes("nextval")) return [{ sequence: ++sequence }];
        if (query.includes('FROM "AuditEvent"')) return [];
        return [{ id: auctionId }];
      },
      async $executeRaw(sql: TemplateStringsArray, ...values: unknown[]) {
        if (sql.join("").includes('INSERT INTO "AuditEvent"')) writes.push(String(values[3]));
      },
      auction: {
        async findUniqueOrThrow() { return { id: auctionId, status: "OPEN", endsAt: new Date(0) }; },
        async update() { writes.push("auction:CLOSED"); },
      },
      lot: {
        async findUnique() { return lot(); }, async findMany() { return [lot()]; },
        async update() { lotStatus = "UNSOLD"; writes.push("lot:UNSOLD"); },
      },
      auctionReceipt: { async findUnique() { return null; } },
      walletTransaction: { async findUnique() { return null; } },
      bid: { async findFirst() { return null; } },
      bidReservation: { async findMany() { return []; } },
      auditEvent: { async findMany() { return []; }, async create({ data }: { data: { action: string } }) { writes.push(data.action); } },
    };
    const result = await createSettlementRepository(() => clientFor(tx)).settle(auctionId, lotId);
    assert.equal(result.lot?.status, "UNSOLD");
    assert.equal(result.auction?.status, "CLOSED");
    assert.deepEqual(writes, ["lot:UNSOLD", "LOT_CLOSED", "auction:CLOSED", "AUCTION_CLOSED"]);
  });

  for (const operation of ["schedule", "open"] as const) it(`repositorio bloqueia ${operation} mesmo com callback permissivo`, async () => {
    let decided = false;
    const tx = {
      lot: { async findMany() { return []; } },
      auction: { async findUnique() { return { id: auctionId, organizerId: userId }; } },
      async $queryRaw(sql: TemplateStringsArray) { return sql.join("").includes('"temporalGeneration"') ? [{ temporalGeneration: "LEGACY" }] : [{ id: auctionId }]; },
    };
    await assert.rejects(createAuctionLifecycleRepository(() => clientFor(tx)).transition(auctionId, operation, userId, () => {
      decided = true; return { status: "OPEN", openLotIds: [lotId], unchanged: false };
    }), conflict);
    assert.equal(decided, false);
  });

  for (const generation of ["LEGACY", undefined]) for (const target of [lotId, null]) it(`liquidacao direta ${generation}/${target === null ? "terminal" : "lote"} nao acessa financas`, async () => {
    const tx = {
      auction: { async findUniqueOrThrow() { return { id: auctionId, status: "OPEN", temporalGeneration: "UTC_V2" }; } },
      async $queryRaw(sql: TemplateStringsArray) {
        assert(sql.join("").includes('FROM "Auction"'));
        return sql.join("").includes('"temporalGeneration"') ? [{ temporalGeneration: generation }] : [{ id: auctionId }];
      },
    };
    assert.deepEqual(await createSettlementRepository(() => clientFor(tx)).settle(auctionId, target), {});
  });

  for (const generation of ["LEGACY", "UTC_V2"]) for (const replay of [false, true]) it(`lance ${generation}, replay=${replay}: nenhuma duplicacao financeira`, async () => {
    const key = "original-key", walletId = randomUUID();
    const prefix = `bid:${createHash("sha256").update(userId).update("\0").update(key).digest("hex")}:`;
    const original = { id: bidId, lotId, userId, amount, sequence: 1, createdAt: new Date() };
    const writes: string[] = [];
    let validated = false;
    const tx = {
      async $queryRaw(sql: TemplateStringsArray) {
        const query = sql.join("");
        if (query.includes('"temporalGeneration"')) return [{ temporalGeneration: generation }];
        if (query.includes("clock_timestamp")) return [{ milliseconds: BigInt(Date.now()) }];
        return [{ id: auctionId }];
      },
      lot: {
        async findUnique() { return { id: lotId, auctionId, vehicleId: randomUUID(), version: 0, endsAt: null }; },
        async update() { writes.push("lot"); },
      },
      auction: { async findUnique() { return { id: auctionId, endsAt: new Date(Date.now() + 600000) }; } },
      vehicle: { async findUnique() { return { ownerId: randomUUID() }; } },
      auctionReceipt: { async findUnique() { return null; } },
      wallet: {
        async findUnique() { return { id: walletId }; },
        async findMany() { return [{ id: walletId, balance: new Prisma.Decimal(1000), version: 0 }]; },
        async update() { writes.push("wallet"); },
      },
      bid: {
        async findFirst() { return null; },
        async findUnique() { return original; },
        async create() { writes.push("bid"); return original; },
      },
      bidReservation: {
        async findMany() { return []; }, async findFirst() { return null; },
        async aggregate() { return { _sum: { amount: null } }; },
        async create() { writes.push("reservation"); return { id: randomUUID() }; },
      },
      walletTransaction: {
        async findMany() { return replay ? [{ idempotencyKey: prefix + bidId, type: "RESERVE", reservationId: randomUUID() }] : []; },
        async create() { writes.push("ledger"); },
      },
    };
    const request = createBidRepository(() => clientFor(tx)).place(lotId, userId, amount, key, () => { validated = true; });
    if (generation === "LEGACY" && !replay) await assert.rejects(request, conflict);
    else assert.equal((await request).replayed, replay);
    assert.equal(validated, generation === "UTC_V2" && !replay);
    assert.deepEqual(writes, generation === "UTC_V2" && !replay ? ["bid", "reservation", "ledger", "wallet", "lot"] : []);
  });
});
