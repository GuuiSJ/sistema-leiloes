import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma, type Auction, type PrismaClient } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { AuctionService } from "../src/modules/auctions/auction.service";
import { AuctionLifecycleService } from "../src/modules/auctions/auction-lifecycle.service";
import type { AuctionRepository } from "../src/modules/auctions/auction.types";
import type { LifecycleLot } from "../src/modules/auctions/auction-lifecycle.types";
import { BidService } from "../src/modules/bids/bid.service";
import { BidEventBus, BidExecutionQueue } from "../src/realtime/bid-events";
import { createSettlementRepository } from "../src/modules/settlement/settlement.repository";

const conflict = (e: unknown) => e instanceof HttpError && e.status === 409;
type PreparedAuction = Auction & { temporalGeneration: "LEGACY" | "UTC_V2" };
function fixture(status: Auction["status"] = "DRAFT"): PreparedAuction {
  const now = Date.now();
  return { id: randomUUID(), organizerId: randomUUID(), title: "Fixture temporal", description: null, status, startsAt: new Date(now + 60000), endsAt: new Date(now + 240000), createdAt: new Date(now), updatedAt: new Date(now), temporalGeneration: "LEGACY" };
}
function repository(auction: Auction): AuctionRepository {
  return {
    async findById(id) { return id === auction.id ? auction : null; },
    async list() { return { auctions: [auction], total: 1 }; },
    async create() { throw new Error("Escrita inesperada na consulta."); },
    async mutate(_id, decide) { return { ...auction, ...decide({ auction, hasIncompatibleOperations: false }) }; },
  };
}

describe("Consulta histórica não depende da geração temporal", () => {
  for (const status of ["DRAFT", "SCHEDULED", "OPEN", "CLOSED", "CANCELLED"] as const) it(`LEGACY ${status} permanece consultável sem mutação`, async () => {
    const auction = fixture(status), before = JSON.stringify(auction), service = new AuctionService(repository(auction));
    const detail = await service.findById(auction.id), page = await service.list({ page: 1, limit: 20 });
    assert.equal(detail.id, auction.id); assert.equal(detail.status, status); assert.equal(page.data[0].id, auction.id); assert.equal(JSON.stringify(auction), before);
    assert(!("organizerId" in detail));
  });
});

describe("Aceitação: isolamento operacional LEGACY (sem banco)", () => {
  for (const operation of ["schedule", "open"] as const) it(`bloqueia ${operation} antes da transição ou auditoria`, async () => {
    const auction = fixture(operation === "schedule" ? "DRAFT" : "SCHEDULED");
    const now = operation === "schedule" ? new Date() : auction.startsAt;
    const lots: LifecycleLot[] = [{ id: randomUUID(), auctionId: auction.id, vehicleId: randomUUID(), number: 1, startingPrice: new Prisma.Decimal(100), minimumIncrement: new Prisma.Decimal(10), status: "PENDING", winnerId: null, endsAt: null, version: 0, createdAt: now, updatedAt: now, vehicleOwnerId: auction.organizerId, hasFinancialHistory: false }];
    let changes = 0;
    const service = new AuctionLifecycleService({ async transition(_id, _op, _user, decide) { const decision = decide({ auction, lots, now }); changes++; return { auction: { ...auction, status: decision.status }, openedLots: decision.openLotIds.length, unchanged: decision.unchanged }; } });
    await assert.rejects(service.transition(auction.id, operation, auction.organizerId), conflict); assert.equal(changes, 0);
  });
  it("bloqueia alteração de prazo mesmo em DRAFT futuro e pelo proprietário", async () => {
    const auction = fixture(), service = new AuctionService(repository(auction));
    await assert.rejects(service.update(auction.id, { endsAt: new Date(auction.endsAt.getTime() + 60000) }, auction.organizerId), conflict);
  });
  it("bloqueia lance antes de reservar, prorrogar ou publicar", async () => {
    const auction = fixture("OPEN"); auction.startsAt = new Date(Date.now() - 60000);
    const now = new Date(), lotId = randomUUID(); let writes = 0, events = 0;
    const bus = new BidEventBus(); bus.subscribe(() => { events++; }); bus.subscribeExtensions(() => { events++; });
    const service = new BidService({
      async list() { return { bids: [], total: 0 }; },
      async place(_id, userId, amount, _key, validate) {
        validate({ auction, now, latest: null, hasReceipt: false, vehicleOwnerId: auction.organizerId, lot: { id: lotId, auctionId: auction.id, vehicleId: randomUUID(), number: 1, startingPrice: new Prisma.Decimal(100), minimumIncrement: new Prisma.Decimal(10), status: "OPEN", winnerId: null, endsAt: null, version: 0, createdAt: now, updatedAt: now } });
        writes++; return { replayed: false, bid: { id: randomUUID(), lotId, amount, sequence: 1, createdAt: now } };
      },
    }, bus, new BidExecutionQueue());
    await assert.rejects(service.place(lotId, randomUUID(), "100", "legacy-first"), conflict); assert.equal(writes, 0); assert.equal(events, 0);
  });
  it("liquidação ignora LEGACY antes do relógio, lote, carteira ou auditoria", async () => {
    const auction = fixture("OPEN"); let reachedFinancialPath = false;
    const client = { async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      return fn({ auction: { async findUniqueOrThrow() { return auction; } }, async $queryRaw(strings: TemplateStringsArray) {
        if (strings.join("").includes('FROM "Auction"')) return [{ id: auction.id, temporalGeneration: auction.temporalGeneration }];
        reachedFinancialPath = true; throw new Error("Caminho financeiro não deve ser alcançado.");
      } });
    } } as unknown as PrismaClient;
    assert.deepEqual(await createSettlementRepository(() => client).settle(auction.id, randomUUID()), {}); assert.equal(reachedFinancialPath, false);
  });
  it("descoberta do worker restringe AMBOS os ramos a UTC_V2", async () => {
    const client = { async $queryRaw(strings: TemplateStringsArray, ...parameters: unknown[]) {
      const branches = strings.join("?").split("UNION ALL"); assert.equal(branches.length, 2);
      for (const branch of branches) assert.match(branch, /a\."temporalGeneration"\s*=\s*(?:'UTC_V2'|\?)/);
      if (strings.join("").includes('"temporalGeneration" = ')) assert(strings.join("").includes("'UTC_V2'") || parameters.includes("UTC_V2"));
      return [];
    } } as unknown as PrismaClient;
    assert.deepEqual(await createSettlementRepository(() => client).candidates(25), []);
  });
});
