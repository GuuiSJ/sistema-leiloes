import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { withLifecycleDatabase } from "./helpers/lifecycle-database";
import { seedBidFixture } from "./helpers/bid-fixture";
import { BidService } from "../src/modules/bids/bid.service";
import { createBidRepository } from "../src/modules/bids/bid.repository";
import { createSettlementRepository } from "../src/modules/settlement/settlement.repository";
import { SettlementService } from "../src/modules/settlement/settlement.service";
import { SettlementEventBus, type LotClosedEvent } from "../src/realtime/settlement-events";
import { verifyOpeningAuditChain, prepareOpeningAudit } from "../src/modules/audit/opening-audit";
import { createWalletRepository } from "../src/modules/wallet/wallet.repository";
import { WalletService } from "../src/modules/wallet/wallet.service";
import { LotService } from "../src/modules/lots/lot.service";
import { createLotRepository } from "../src/modules/lots/lot.repository";
import { ReceiptService } from "../src/modules/receipts/receipt.service";
import { createReceiptRepository } from "../src/modules/receipts/receipt.repository";
import { HttpError } from "../src/errors/http-error";
import { SettlementWorker } from "../src/workers/settlement-worker";

describe("Encerramento PostgreSQL isolado", { skip: process.env.SETTLEMENT_DATABASE_TESTS !== "1" }, () => {
  async function fixture(check: (c: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
    await withLifecycleDatabase(async client => { await check(await setup(client)); });
  }
  async function setup(client: PrismaClient) {
    const ids = await client.$transaction(seedBidFixture);
    const bids = new BidService(createBidRepository(() => client));
    const repository = createSettlementRepository(() => client), events = new SettlementEventBus(), notifications: LotClosedEvent[] = [];
    events.subscribeLot(event => { notifications.push(event); });
    const service = new SettlementService(repository, events);
    const expire = async (index = 0) => { await client.auction.update({ where: { id: ids.auctionIds[index] }, data: { endsAt: new Date(Date.now() - 1000) } }); };
    return { ...ids, client, bids, repository, service, events, notifications, expire };
  }
  it("vende, captura uma vez, emite comprovante e mantém disponível", async () => fixture(async c => {
    const bid = await c.bids.place(c.lotIds[0], c.bidders[0], "100", "first"); await c.expire();
    const before = await new WalletService(createWalletRepository(() => c.client)).get(c.bidders[0]);
    await c.service.process(c.auctionIds[0], c.lotIds[0]);
    const lot = await c.client.lot.findUniqueOrThrow({ where: { id: c.lotIds[0] } }); assert.equal(lot.status, "SOLD"); assert.equal(lot.winnerId, c.bidders[0]);
    const receipt = await c.client.auctionReceipt.findUniqueOrThrow({ where: { lotId: lot.id } }); assert.equal(receipt.winningBidId, bid.bid.id); assert.equal(receipt.finalAmount.toFixed(2), "100.00");
    const after = await new WalletService(createWalletRepository(() => c.client)).get(c.bidders[0]); assert.equal(before.availableBalance, after.availableBalance); assert.equal(after.totalBalance, "400.00"); assert.equal(after.reservedBalance, "0.00");
    assert.equal((await c.client.bidReservation.findFirstOrThrow()).status, "CAPTURED");
    assert.equal(await c.client.walletTransaction.count({ where: { type: "RELEASE" } }), 0);
    assert.equal((await c.client.walletTransaction.findUniqueOrThrow({ where: { idempotencyKey: `settlement:${lot.id}` } })).balanceAfter.toFixed(2), "400.00");
    await c.service.process(c.auctionIds[0], lot.id); assert.equal(c.notifications.length, 1); assert.equal(await c.client.auctionReceipt.count(), 1); assert.equal(await c.client.walletTransaction.count({ where: { type: "DEBIT" } }), 1);
    assert.equal((await c.client.auction.findUniqueOrThrow({ where: { id: c.auctionIds[0] } })).status, "CLOSED");
  }));
  it("sem lances fica UNSOLD, sem débito ou comprovante", async () => fixture(async c => {
    await c.expire(); await c.service.process(c.auctionIds[0], c.lotIds[0]);
    assert.equal((await c.client.lot.findUniqueOrThrow({ where: { id: c.lotIds[0] } })).status, "UNSOLD"); assert.equal(await c.client.auctionReceipt.count(), 0); assert.equal(await c.client.walletTransaction.count({ where: { type: "DEBIT" } }), 0);
    const chain = await c.client.auditEvent.findMany({ orderBy: { sequence: "asc" } }); assert.deepEqual(chain.map(e => e.action), ["LOT_CLOSED", "AUCTION_CLOSED"]); assert(verifyOpeningAuditChain(chain));
  }));
  it("não encerra antes do prazo e respeita prorrogação após prazo-base", async () => fixture(async c => {
    await c.service.process(c.auctionIds[0], c.lotIds[0]); assert.equal(c.notifications.length, 0);
    await c.client.lot.update({ where: { id: c.lotIds[0] }, data: { endsAt: new Date(Date.now() + 60000) } }); await c.expire();
    await c.service.process(c.auctionIds[0], c.lotIds[0]); assert.equal(c.notifications.length, 0);
    await c.bids.place(c.lotIds[0], c.bidders[0], "100", "extended");
    await c.client.lot.update({ where: { id: c.lotIds[0] }, data: { endsAt: new Date(Date.now() - 1) } }); await c.service.process(c.auctionIds[0], c.lotIds[0]); assert.equal(c.notifications.length, 1);
  }));
  it("preserva reserva de outro lote e histórico de participantes superados", async () => fixture(async c => {
    await c.bids.place(c.lotIds[0], c.bidders[1], "100", "previous"); await c.bids.place(c.lotIds[0], c.bidders[0], "110", "winner"); await c.bids.place(c.lotIds[1], c.bidders[0], "100", "other");
    const held = await c.client.bidReservation.findFirstOrThrow({ where: { lotId: c.lotIds[1] } }); await c.expire(); await c.service.process(c.auctionIds[0], c.lotIds[0]);
    assert.deepEqual(await c.client.bidReservation.findUniqueOrThrow({ where: { id: held.id } }), held);
    assert.equal((await c.client.bidReservation.findFirstOrThrow({ where: { lotId: c.lotIds[0], userId: c.bidders[1] } })).status, "RELEASED");
    assert.deepEqual(await new WalletService(createWalletRepository(() => c.client)).get(c.bidders[0]), { totalBalance: "390.00", reservedBalance: "100.00", availableBalance: "290.00" });
  }));
  it("dois workers e nova instância nunca debitam duas vezes", async () => fixture(async c => {
    await c.bids.place(c.lotIds[0], c.bidders[0], "100", "first"); await c.expire();
    await Promise.all([c.service.process(c.auctionIds[0], c.lotIds[0]), new SettlementService(createSettlementRepository(() => c.client), c.events).process(c.auctionIds[0], c.lotIds[0])]);
    await new SettlementService(createSettlementRepository(() => c.client), c.events).process(c.auctionIds[0], c.lotIds[0]);
    assert.equal(await c.client.walletTransaction.count({ where: { type: "DEBIT" } }), 1); assert.equal(await c.client.auctionReceipt.count(), 1); assert.equal(c.notifications.length, 1);
  }));
  it("dois lotes na mesma carteira liquidam sem perder atualização", async () => fixture(async c => {
    for (const id of c.lotIds) await c.bids.place(id, c.bidders[0], "100", `first-${id}`); await c.expire(0); await c.expire(1);
    await Promise.all(c.lotIds.map((id, i) => c.service.process(c.auctionIds[i], id)));
    assert.equal((await c.client.wallet.findUniqueOrThrow({ where: { id: c.walletIds[0] } })).balance.toFixed(2), "300.00"); assert.equal(await c.client.walletTransaction.count({ where: { type: "DEBIT" } }), 2);
  }));
  it("corrida com lance vencido rejeita lance e encerra sem vencedor", async () => fixture(async c => {
    await c.expire(); const results = await Promise.allSettled([c.bids.place(c.lotIds[0], c.bidders[0], "100", "expired"), c.service.process(c.auctionIds[0], c.lotIds[0])]);
    assert.equal(results[0].status, "rejected"); assert.equal(await c.client.bid.count(), 0); assert.equal((await c.client.lot.findUniqueOrThrow({ where: { id: c.lotIds[0] } })).status, "UNSOLD");
  }));
  it("lance válido bloqueado antes do worker vence e preserva a prorrogação", async () => fixture(async c => {
    await c.client.auction.update({ where: { id: c.auctionIds[0] }, data: { endsAt: new Date(Date.now() + 60000) } });
    let release!: () => void, reached!: () => void; const gate = new Promise<void>(r => release = r), boundary = new Promise<void>(r => reached = r);
    const scoped = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opts: object) => c.client.$transaction(async tx => { const result = await fn(tx); reached(); await gate; return result; }, opts) } as unknown as PrismaClient;
    const pending = new BidService(createBidRepository(() => scoped)).place(c.lotIds[0], c.bidders[0], "100", "race");
    try { await boundary; await c.service.process(c.auctionIds[0], c.lotIds[0]); assert.equal(c.notifications.length, 0); } finally { release(); }
    await pending; await c.service.process(c.auctionIds[0], c.lotIds[0]); assert.equal((await c.client.lot.findUniqueOrThrow({ where: { id: c.lotIds[0] } })).status, "OPEN");
  }));
  it("rollback tardio desfaz débito, captura, resultado, comprovante e auditoria", async () => fixture(async c => {
    await c.bids.place(c.lotIds[0], c.bidders[0], "100", "first"); await c.expire();
    const scoped = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opts: object) => c.client.$transaction(async tx => { await fn(tx); throw new Error("rollback de teste"); }, opts) } as unknown as PrismaClient;
    await assert.rejects(new SettlementService(createSettlementRepository(() => scoped), c.events).process(c.auctionIds[0], c.lotIds[0]));
    assert.equal(await c.client.auctionReceipt.count(), 0); assert.equal(await c.client.auditEvent.count(), 0); assert.equal(await c.client.walletTransaction.count({ where: { type: "DEBIT" } }), 0); assert.equal((await c.client.bidReservation.findFirstOrThrow()).status, "ACTIVE"); assert.equal((await c.client.wallet.findUniqueOrThrow({ where: { id: c.walletIds[0] } })).balance.toFixed(2), "500.00"); assert.equal(c.notifications.length, 0);
    await c.service.process(c.auctionIds[0], c.lotIds[0]); assert.equal(c.notifications.length, 1);
  }));
  for (const corruption of ["balance", "reservation", "duplicate-active", "preexisting-debit"] as const) it(`bloqueia inconsistência ${corruption} sem reparação`, async () => fixture(async c => {
    await c.bids.place(c.lotIds[0], c.bidders[0], "100", "first"); await c.expire();
    if (corruption === "balance") await c.client.wallet.update({ where: { id: c.walletIds[0] }, data: { balance: "50" } });
    if (corruption === "reservation") await c.client.bidReservation.updateMany({ data: { amount: "99" } });
    if (corruption === "duplicate-active") { const bid = await c.client.bid.create({ data: { lotId: c.lotIds[0], userId: c.bidders[1], amount: "90", sequence: 0 } }); await c.client.bidReservation.create({ data: { bidId: bid.id, lotId: c.lotIds[0], userId: c.bidders[1], walletId: c.walletIds[1], amount: "90" } }); }
    if (corruption === "preexisting-debit") await c.client.walletTransaction.create({ data: { walletId: c.walletIds[0], type: "DEBIT", amount: "100", balanceAfter: "400", idempotencyKey: `settlement:${c.lotIds[0]}` } });
    await assert.rejects(c.service.process(c.auctionIds[0], c.lotIds[0]), (e: unknown) => e instanceof HttpError && e.status === 409);
    assert.equal((await c.client.lot.findUniqueOrThrow({ where: { id: c.lotIds[0] } })).status, "OPEN"); assert.equal(await c.client.auctionReceipt.count(), 0); assert.equal(c.notifications.length, 0);
  }));
  it("último lote fecha leilão; outro lote OPEN ou PENDING impede", async () => fixture(async c => {
    await c.client.lot.update({ where: { id: c.lotIds[1] }, data: { auctionId: c.auctionIds[0], number: 2, status: "PENDING" } }); await c.expire();
    await c.service.process(c.auctionIds[0], c.lotIds[0]); assert.equal((await c.client.auction.findUniqueOrThrow({ where: { id: c.auctionIds[0] } })).status, "OPEN");
    await c.client.lot.update({ where: { id: c.lotIds[1] }, data: { status: "OPEN", endsAt: new Date(Date.now() + 60000) } }); await c.service.process(c.auctionIds[0], c.lotIds[1]); assert.equal(c.notifications.length, 1);
    await c.client.lot.update({ where: { id: c.lotIds[1] }, data: { endsAt: new Date(Date.now() - 1) } }); await c.service.process(c.auctionIds[0], c.lotIds[1]); assert.equal((await c.client.auction.findUniqueOrThrow({ where: { id: c.auctionIds[0] } })).status, "CLOSED");
  }));
  it("recupera leilão com todos os lotes terminais sem duplicar resultados", async () => fixture(async c => {
    await c.client.lot.update({ where: { id: c.lotIds[0] }, data: { status: "UNSOLD" } }); const candidates = await c.repository.candidates(25); assert(candidates.some(x => x.auctionId === c.auctionIds[0] && x.lotId === null));
    await c.service.process(c.auctionIds[0], null); assert.equal((await c.client.auction.findUniqueOrThrow({ where: { id: c.auctionIds[0] } })).status, "CLOSED"); assert.equal(c.notifications.length, 0);
  }));
  it("abertura antiga mantém hash, encerramento encadeia e abertura futura verifica cadeia mista", async () => fixture(async c => {
    const auction = await c.client.auction.findUniqueOrThrow({ where: { id: c.auctionIds[0] } }), lots = await c.client.lot.findMany({ where: { auctionId: auction.id } });
    await c.client.$transaction(async tx => { const append = await prepareOpeningAudit(tx); await append(auction, lots.map(l => ({ ...l, vehicleOwnerId: c.ownerId, hasFinancialHistory: false })), c.ownerId, new Date()); });
    const old = await c.client.auditEvent.findMany({ orderBy: { sequence: "asc" } }); await c.bids.place(c.lotIds[0], c.bidders[0], "100", "first"); await c.expire(); await c.service.process(c.auctionIds[0], c.lotIds[0]);
    let chain = await c.client.auditEvent.findMany({ orderBy: { sequence: "asc" } }); assert.deepEqual(chain.slice(0, old.length), old); assert(verifyOpeningAuditChain(chain));
    await c.client.$transaction(async tx => { const append = await prepareOpeningAudit(tx); await append(auction, lots.map(l => ({ ...l, vehicleOwnerId: c.ownerId, hasFinancialHistory: false })), c.ownerId, new Date()); });
    chain = await c.client.auditEvent.findMany({ orderBy: { sequence: "asc" } }); assert(verifyOpeningAuditChain(chain));
    await c.client.auditEvent.update({ where: { id: chain[0].id }, data: { occurredAt: new Date(0) } }); assert.throws(() => verifyOpeningAuditChain([{ ...chain[0], occurredAt: new Date(0) }, ...chain.slice(1)]));
    await c.expire(1); await assert.rejects(c.service.process(c.auctionIds[1], c.lotIds[1])); assert.equal((await c.client.lot.findUniqueOrThrow({ where: { id: c.lotIds[1] } })).status, "OPEN");
  }));
  it("REST público expõe resultado sem vencedor e comprovante só aos responsáveis", async () => fixture(async c => {
    await c.bids.place(c.lotIds[0], c.bidders[0], "100", "first"); await c.expire(); await c.service.process(c.auctionIds[0], c.lotIds[0]);
    const lot = await new LotService(createLotRepository(() => c.client)).findById(c.auctionIds[0], c.lotIds[0]); assert.equal(lot.result?.finalAmount, "100.00"); assert(!JSON.stringify(lot).includes(c.bidders[0]));
    const receipts = new ReceiptService(createReceiptRepository(() => c.client)); const r = await receipts.get(c.lotIds[0], c.bidders[0]); assert.deepEqual(await receipts.get(c.lotIds[0], c.ownerId), r); assert(!JSON.stringify(r).includes(c.bidders[0]));
    await assert.rejects(receipts.get(c.lotIds[0], c.bidders[1]), (e: unknown) => e instanceof HttpError && e.status === 403);
  }));
  for (const offset of [-1, 0]) it(`fronteira temporal do banco ${offset}ms em relação ao prazo efetivo`, async () => fixture(async c => {
    const end = new Date("2030-01-01T00:00:00.000Z");
    await c.client.lot.update({ where: { id: c.lotIds[0] }, data: { endsAt: end } });
    const scoped = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opts: object) => c.client.$transaction(tx => fn(new Proxy(tx, { get(target, property) {
      if (property === "$queryRaw") return (strings: TemplateStringsArray, ...values: unknown[]) => strings.join("").includes("EXTRACT(EPOCH FROM clock_timestamp())") ? Promise.resolve([{ milliseconds: BigInt(end.getTime() + offset) }]) : tx.$queryRaw(strings, ...values);
      return Reflect.get(target, property);
    } })), opts) } as unknown as PrismaClient;
    await new SettlementService(createSettlementRepository(() => scoped), c.events).process(c.auctionIds[0], c.lotIds[0]);
    assert.equal((await c.client.lot.findUniqueOrThrow({ where: { id: c.lotIds[0] } })).status, offset === 0 ? "UNSOLD" : "OPEN");
  }));
  it("paginação da descoberta alcança candidatos após um lote inconsistente", async () => fixture(async c => {
    await c.expire(0); await c.expire(1); const first = await c.repository.candidates(1); assert.equal(first.length, 1);
    const second = await c.repository.candidates(1, `${first[0].auctionId}:${first[0].lotId ?? ""}`); assert.equal(second.length, 1); assert.notEqual(first[0].lotId, second[0].lotId);
    assert.equal((await c.repository.candidates(1, `${second[0].auctionId}:${second[0].lotId ?? ""}`)).length, 0);
  }));
  it("não fecha leilão com resultado terminal incompatível", async () => fixture(async c => {
    await c.client.lot.update({ where: { id: c.lotIds[0] }, data: { status: "SOLD", winnerId: c.bidders[0] } });
    await assert.rejects(c.service.process(c.auctionIds[0], null)); assert.equal((await c.client.auction.findUniqueOrThrow({ where: { id: c.auctionIds[0] } })).status, "OPEN"); assert.equal(await c.client.auditEvent.count(), 0);
  }));
  it("worker real descobre e encerra vencido, preservando lote futuro", async () => fixture(async c => {
    await c.expire(); let resolve!: () => void; const closed = new Promise<void>(r => resolve = r);
    c.events.subscribeLot(event => { if (event.lotId === c.lotIds[0]) resolve(); });
    const worker = new SettlementWorker(c.repository, c.service, 20, 1); let timeout: ReturnType<typeof setTimeout> | undefined;
    try { worker.start(); await Promise.race([closed, new Promise<never>((_r, reject) => { timeout = setTimeout(() => reject(new Error("Worker não encerrou lote vencido")), 5000); })]); }
    finally { if (timeout) clearTimeout(timeout); await worker.stop(); }
    assert.equal((await c.client.lot.findUniqueOrThrow({ where: { id: c.lotIds[0] } })).status, "UNSOLD"); assert.equal((await c.client.lot.findUniqueOrThrow({ where: { id: c.lotIds[1] } })).status, "OPEN");
  }));
});
