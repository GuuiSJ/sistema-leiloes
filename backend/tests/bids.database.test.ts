import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { disconnectDatabase } from "../src/lib/prisma";
import { HttpError } from "../src/errors/http-error";
import { withBidRollback } from "./helpers/bid-fixture";

describe("Lances e reservas PostgreSQL (rollback integral)", { skip: process.env.BID_DATABASE_TESTS !== "1" }, () => {
  after(disconnectDatabase);
  const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;
  it("lance inicial reserva o valor inteiro e mantém o saldo total", async () => {
    await withBidRollback(async ({ service, wallets, tx, bidders, lotIds, walletIds }) => {
      const result = await service.place(lotIds[0], bidders[0], "100", "initial");
      assert.equal(result.bid.sequence, 1); assert.equal(result.bid.amount, "100.00"); assert.equal(result.replayed, false);
      assert.deepEqual(await wallets.get(bidders[0]), { totalBalance: "500.00", reservedBalance: "100.00", availableBalance: "400.00" });
      const reservation = await tx.bidReservation.findUniqueOrThrow({ where: { walletId_lotId: { walletId: walletIds[0], lotId: lotIds[0] } } });
      assert.equal(reservation.bidId, result.bid.id); assert.equal(reservation.status, "ACTIVE");
      const movement = await tx.walletTransaction.findFirstOrThrow({ where: { reservationId: reservation.id, type: "RESERVE" } });
      assert.equal(movement.amount.toFixed(2), "100.00"); assert.equal(movement.balanceAfter.toFixed(2), "500.00"); assert(movement.idempotencyKey.endsWith(result.bid.id));
    });
  });
  it("aplica valor inicial, incremento e saldo insuficiente sem efeitos parciais", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds, walletIds }) => {
      await assert.rejects(service.place(lotIds[0], bidders[0], "99.99", "low"), status(409));
      await assert.rejects(service.place(lotIds[0], bidders[0], "500.01", "funds"), status(409));
      const first = await service.place(lotIds[0], bidders[0], "100", "first");
      await assert.rejects(service.place(lotIds[0], bidders[1], "109.99", "increment"), status(409));
      assert.equal(await tx.bid.count({ where: { lotId: lotIds[0] } }), 1);
      assert.equal(await tx.walletTransaction.count({ where: { walletId: { in: walletIds }, type: "RELEASE" } }), 0);
      assert.equal((await service.place(lotIds[0], bidders[1], "110.01", "increment")).bid.sequence, first.bid.sequence + 1);
    });
  });
  it("outro participante libera a reserva anterior e registra RELEASE sem debitar saldo", async () => {
    await withBidRollback(async ({ service, wallets, tx, bidders, lotIds, walletIds }) => {
      const first = await service.place(lotIds[0], bidders[0], "100", "first");
      const second = await service.place(lotIds[0], bidders[1], "110", "second");
      assert.deepEqual(await wallets.get(bidders[0]), { totalBalance: "500.00", reservedBalance: "0.00", availableBalance: "500.00" });
      assert.equal((await wallets.get(bidders[1])).reservedBalance, "110.00");
      const positions = await tx.bidReservation.findMany({ where: { lotId: lotIds[0] } });
      assert.equal(positions.filter(p => p.status === "ACTIVE").length, 1); assert.equal(positions.find(p => p.bidId === first.bid.id)!.status, "RELEASED");
      const release = await tx.walletTransaction.findFirstOrThrow({ where: { walletId: walletIds[0], type: "RELEASE" } });
      assert.equal(release.amount.toFixed(2), "100.00"); assert(release.idempotencyKey.includes(first.bid.id)); assert(release.idempotencyKey.includes(second.bid.id));
    });
  });
  it("aumento próprio ajusta apenas a diferença na mesma reserva", async () => {
    await withBidRollback(async ({ service, wallets, tx, bidders, lotIds, walletIds }) => {
      const first = await service.place(lotIds[0], bidders[0], "490", "first");
      const reservation = await tx.bidReservation.findFirstOrThrow({ where: { walletId: walletIds[0], lotId: lotIds[0] } });
      const originalMovement = await tx.walletTransaction.findFirstOrThrow({ where: { reservationId: reservation.id } });
      const second = await service.place(lotIds[0], bidders[0], "500", "raise");
      const updated = await tx.bidReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      assert.equal(updated.bidId, second.bid.id); assert.equal(updated.amount.toFixed(2), "500.00");
      assert.equal(await tx.bidReservation.count({ where: { walletId: walletIds[0], lotId: lotIds[0] } }), 1);
      assert.equal((await tx.walletTransaction.findUniqueOrThrow({ where: { id: originalMovement.id } })).idempotencyKey, originalMovement.idempotencyKey);
      assert(originalMovement.idempotencyKey.endsWith(first.bid.id));
      const delta = await tx.walletTransaction.findFirstOrThrow({ where: { idempotencyKey: { endsWith: second.bid.id }, type: "RESERVE" } });
      assert.equal(delta.amount.toFixed(2), "10.00"); assert.equal((await wallets.get(bidders[0])).availableBalance, "0.00");
    });
  });
  it("participante retorna à liderança reativando a reserva única e preservando todo o histórico", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds, walletIds }) => {
      const first = await service.place(lotIds[0], bidders[0], "100", "a");
      const reservation = await tx.bidReservation.findFirstOrThrow({ where: { walletId: walletIds[0] } });
      await service.place(lotIds[0], bidders[1], "110", "b");
      const ledgerBefore = await tx.walletTransaction.findMany({ where: { walletId: { in: walletIds } }, orderBy: { id: "asc" } });
      const third = await service.place(lotIds[0], bidders[0], "120", "c");
      const position = await tx.bidReservation.findUniqueOrThrow({ where: { id: reservation.id } }); assert.equal(position.status, "ACTIVE"); assert.equal(position.bidId, third.bid.id);
      assert.equal(await tx.bidReservation.count({ where: { lotId: lotIds[0] } }), 2);
      const oldRows = await tx.walletTransaction.findMany({ where: { id: { in: ledgerBefore.map(t => t.id) } }, orderBy: { id: "asc" } }); assert.deepEqual(oldRows, ledgerBefore);
      const replay = await service.place(lotIds[0], bidders[0], "100.00", "a"); assert.equal(replay.bid.id, first.bid.id); assert.equal(replay.replayed, true);
      assert.equal(await tx.bid.count({ where: { lotId: lotIds[0] } }), 3);
    });
  });
  it("idempotência não repete reservas nem lances e bloqueia outro valor ou lote", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds, walletIds }) => {
      const first = await service.place(lotIds[0], bidders[0], "100", "same");
      const replay = await service.place(lotIds[0], bidders[0], "100.0", "same"); assert.equal(first.bid.id, replay.bid.id); assert(replay.replayed);
      await assert.rejects(service.place(lotIds[0], bidders[0], "110", "same"), status(409));
      await assert.rejects(service.place(lotIds[1], bidders[0], "100", "same"), status(409));
      assert.equal(await tx.walletTransaction.count({ where: { walletId: walletIds[0], type: "RESERVE" } }), 1);
      assert.equal(await tx.bid.count({ where: { lotId: { in: lotIds } } }), 1);
    });
  });
  it("reenvio antigo continua válido depois da liberação e do fechamento", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds, auctionIds }) => {
      const first = await service.place(lotIds[0], bidders[0], "100", "a"); await service.place(lotIds[0], bidders[1], "110", "b");
      await tx.auction.update({ where: { id: auctionIds[0] }, data: { status: "CLOSED" } });
      const replay = await service.place(lotIds[0], bidders[0], "100", "a"); assert.equal(replay.bid.id, first.bid.id); assert(replay.replayed);
      await assert.rejects(service.place(lotIds[0], bidders[0], "120", "c"), status(409));
    });
  });
  it("mesma chave textual em participantes diferentes é independente", async () => {
    await withBidRollback(async ({ service, bidders, lotIds }) => {
      await service.place(lotIds[0], bidders[0], "100", "same"); assert.equal((await service.place(lotIds[0], bidders[1], "110", "same")).replayed, false);
    });
  });
  it("falha no histórico reverte lance, liberação, reserva e versões de ambas as carteiras", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds, walletIds, control }) => {
      await service.place(lotIds[0], bidders[0], "100", "a");
      const before = { bids: await tx.bid.findMany({ where: { lotId: lotIds[0] } }), positions: await tx.bidReservation.findMany({ where: { lotId: lotIds[0] } }), wallets: await tx.wallet.findMany({ where: { id: { in: walletIds } }, orderBy: { id: "asc" } }) };
      control.failLedger = true; await assert.rejects(service.place(lotIds[0], bidders[1], "110", "fail"), /Falha simulada/); control.failLedger = false;
      assert.deepEqual(await tx.bid.findMany({ where: { lotId: lotIds[0] } }), before.bids);
      assert.deepEqual(await tx.bidReservation.findMany({ where: { lotId: lotIds[0] } }), before.positions);
      assert.deepEqual(await tx.wallet.findMany({ where: { id: { in: walletIds } }, orderBy: { id: "asc" } }), before.wallets);
      assert.equal((await service.place(lotIds[0], bidders[1], "110", "fail")).bid.sequence, 2);
    });
  });
  it("uma carteira desconta as reservas ACTIVE de outros lotes", async () => {
    await withBidRollback(async ({ service, wallets, bidders, lotIds }) => {
      await service.place(lotIds[0], bidders[0], "400", "a");
      await assert.rejects(service.place(lotIds[1], bidders[0], "110", "b"), status(409));
      await service.place(lotIds[1], bidders[0], "100", "b"); assert.equal((await wallets.get(bidders[0])).availableBalance, "0.00");
    });
  });
  it("fecha por status e horário sem depender de encerramento automático", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds, auctionIds }) => {
      await tx.auction.update({ where: { id: auctionIds[0] }, data: { endsAt: new Date(Date.now() - 1000) } });
      await assert.rejects(service.place(lotIds[0], bidders[0], "100", "a"), status(409));
      await tx.auction.update({ where: { id: auctionIds[0] }, data: { endsAt: new Date(Date.now() + 86400000), status: "SCHEDULED" } });
      await assert.rejects(service.place(lotIds[0], bidders[0], "100", "a"), status(409));
      await tx.auction.update({ where: { id: auctionIds[0] }, data: { status: "OPEN" } }); await tx.lot.update({ where: { id: lotIds[0] }, data: { status: "PENDING" } });
      await assert.rejects(service.place(lotIds[0], bidders[0], "100", "a"), status(409));
    });
  });
  it("sem carteira e lote inexistente são tratados sem criar saldo", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds }) => {
      await assert.rejects(service.place(randomUUID(), bidders[0], "100", "a"), status(404));
      const missing = await tx.user.create({ data: { name: "Fixture sem carteira", email: `${randomUUID()}@example.invalid`, role: "BIDDER", passwordHash: "unused" } });
      await assert.rejects(service.place(lotIds[0], missing.id, "100", "a"), status(409)); assert.equal(await tx.wallet.count({ where: { userId: missing.id } }), 0);
    });
  });
  it("histórico público paginado não retorna nenhum identificador privado", async () => {
    await withBidRollback(async ({ service, bidders, lotIds }) => {
      await service.place(lotIds[0], bidders[0], "100", "a"); await service.place(lotIds[0], bidders[1], "110", "b");
      const page = await service.list(lotIds[0], { page: 1, limit: 1 }); assert.equal(page.data[0].sequence, 2); assert.equal(page.pagination.total, 2);
      assert.deepEqual(Object.keys(page.data[0]).sort(), ["amount", "createdAt", "id", "lotId", "sequence"]);
    });
  });
  it("inconsistência entre maior lance e reserva bloqueia novas operações", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds }) => {
      const bid = await service.place(lotIds[0], bidders[0], "100", "a");
      await tx.bidReservation.update({ where: { bidId: bid.bid.id }, data: { status: "RELEASED" } });
      await assert.rejects(service.place(lotIds[0], bidders[1], "110", "b"), status(409));
      assert.equal(await tx.bid.count({ where: { lotId: lotIds[0] } }), 1);
    });
  });
  it("desafiante sem saldo não libera a reserva do maior ofertante", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds, walletIds }) => {
      const first = await service.place(lotIds[0], bidders[0], "100", "first");
      await tx.wallet.update({ where: { id: walletIds[1] }, data: { balance: "50" } });
      await assert.rejects(service.place(lotIds[0], bidders[1], "110", "poor"), status(409));
      const position = await tx.bidReservation.findUniqueOrThrow({ where: { bidId: first.bid.id } }); assert.equal(position.status, "ACTIVE");
      assert.equal(await tx.walletTransaction.count({ where: { walletId: walletIds[0], type: "RELEASE" } }), 0);
    });
  });
  it("saldo total inferior ao reservado bloqueia novo lance e preserva o histórico", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds, walletIds }) => {
      await service.place(lotIds[0], bidders[0], "100", "first");
      await tx.wallet.update({ where: { id: walletIds[0] }, data: { balance: "50" } });
      await assert.rejects(service.place(lotIds[0], bidders[1], "110", "blocked"), status(409));
      assert.equal(await tx.bid.count({ where: { lotId: lotIds[0] } }), 1);
    });
  });
  it("não reutiliza posição CAPTURED nem permite múltiplas reservas ativas para um lote", async () => {
    await withBidRollback(async ({ service, tx, bidders, lotIds, walletIds }) => {
      const first = await service.place(lotIds[0], bidders[0], "100", "first");
      const second = await tx.bid.create({ data: { lotId: lotIds[0], userId: bidders[1], amount: "110", sequence: 2 } });
      const captured = await tx.bidReservation.create({ data: { walletId: walletIds[1], userId: bidders[1], lotId: lotIds[0], bidId: second.id, amount: "110", status: "CAPTURED" } });
      await assert.rejects(service.place(lotIds[0], bidders[0], "120", "blocked"), status(409));
      await tx.bidReservation.update({ where: { id: captured.id }, data: { status: "ACTIVE" } });
      await assert.rejects(service.place(lotIds[0], bidders[0], "120", "blocked"), status(409));
      assert(await tx.bid.findUnique({ where: { id: first.bid.id } })); assert.equal(await tx.bid.count({ where: { lotId: lotIds[0] } }), 2);
    });
  });
});
