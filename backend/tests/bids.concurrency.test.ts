import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { disconnectDatabase, getPrisma } from "../src/lib/prisma";
import { HttpError } from "../src/errors/http-error";
import { withCommittedBidFixture } from "./helpers/bid-fixture";

describe("Lances concorrentes PostgreSQL (conexões reais)", { skip: process.env.BID_DATABASE_TESTS !== "1" }, () => {
  after(disconnectDatabase);
  const conflict = (reason: unknown) => { assert(reason instanceof HttpError); assert.equal(reason.status, 409); };
  it("participantes simultâneos com mesmo valor não são ambos aceitos", async () => {
    await withCommittedBidFixture(async ({ service, bidders, lotIds }) => {
      const results = await Promise.allSettled(bidders.map(user => service.place(lotIds[0], user, "100", "initial")));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      for (const result of results) if (result.status === "rejected") conflict(result.reason);
      const positions = await getPrisma().bidReservation.findMany({ where: { lotId: lotIds[0], status: "ACTIVE" } }); assert.equal(positions.length, 1); assert.equal(positions[0].amount.toFixed(2), "100.00");
    });
  });
  it("ofertas distintas concorrentes mantêm o maior lance e uma única reserva", async () => {
    await withCommittedBidFixture(async ({ service, bidders, lotIds, walletIds }) => {
      const results = await Promise.allSettled([service.place(lotIds[0], bidders[0], "100", "a"), service.place(lotIds[0], bidders[1], "110", "b")]);
      for (const result of results) if (result.status === "rejected") conflict(result.reason);
      assert.equal((await service.list(lotIds[0], { page: 1, limit: 20 })).data[0].amount, "110.00");
      const positions = await getPrisma().bidReservation.findMany({ where: { lotId: lotIds[0], status: "ACTIVE" } }); assert.equal(positions.length, 1); assert.equal(positions[0].userId, bidders[1]);
      const wallets = await getPrisma().wallet.findMany({ where: { id: { in: walletIds } } }); assert(wallets.every(w => w.balance.equals("500")));
    });
  });
  it("mesma chave concorrente cria um único lance e movimento de reserva", async () => {
    await withCommittedBidFixture(async ({ service, bidders, lotIds, walletIds }) => {
      const results = await Promise.allSettled([service.place(lotIds[0], bidders[0], "100", "same"), service.place(lotIds[0], bidders[0], "100.00", "same")]);
      const accepted = results.map(result => { if (result.status === "rejected") throw result.reason; return result.value; });
      assert.equal(accepted[0].bid.id, accepted[1].bid.id); assert.equal(accepted.filter(r => r.replayed).length, 1);
      assert.equal(await getPrisma().bid.count({ where: { lotId: lotIds[0] } }), 1); assert.equal(await getPrisma().walletTransaction.count({ where: { walletId: walletIds[0], type: "RESERVE" } }), 1);
    });
  });
  it("lotes em leilões diferentes não consomem simultaneamente o mesmo saldo", async () => {
    await withCommittedBidFixture(async ({ service, wallets, bidders, lotIds }) => {
      const results = await Promise.allSettled(lotIds.map((lotId, i) => service.place(lotId, bidders[0], "400", `lot-${i}`)));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1); for (const result of results) if (result.status === "rejected") conflict(result.reason);
      assert.deepEqual(await wallets.get(bidders[0]), { totalBalance: "500.00", reservedBalance: "400.00", availableBalance: "100.00" });
    });
  });
  it("mesma chave usada em lotes distintos só pode registrar um dos lances", async () => {
    await withCommittedBidFixture(async ({ service, bidders, lotIds, walletIds }) => {
      const results = await Promise.allSettled(lotIds.map(lotId => service.place(lotId, bidders[0], "100", "same")));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1); for (const result of results) if (result.status === "rejected") conflict(result.reason);
      assert.equal(await getPrisma().walletTransaction.count({ where: { walletId: walletIds[0], type: "RESERVE" } }), 1);
    });
  });
  it("trocas cruzadas de liderança bloqueiam carteiras em ordem e preservam saldos", async () => {
    await withCommittedBidFixture(async ({ service, wallets, bidders, lotIds }) => {
      await service.place(lotIds[0], bidders[0], "100", "first"); await service.place(lotIds[1], bidders[1], "100", "first");
      const results = await Promise.allSettled([service.place(lotIds[0], bidders[1], "110", "cross"), service.place(lotIds[1], bidders[0], "110", "cross")]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
      for (const user of bidders) assert.deepEqual(await wallets.get(user), { totalBalance: "500.00", reservedBalance: "110.00", availableBalance: "390.00" });
    });
  });
  it("crédito e lance simultâneos compartilham o bloqueio da carteira", async () => {
    await withCommittedBidFixture(async ({ service, wallets, bidders, lotIds }) => {
      const results = await Promise.allSettled([service.place(lotIds[0], bidders[0], "400", "bid"), wallets.credit(bidders[0], "100", "credit")]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
      assert.deepEqual(await wallets.get(bidders[0]), { totalBalance: "600.00", reservedBalance: "400.00", availableBalance: "200.00" });
    });
  });
  it("espera por bloqueio não permite registrar lance após o término", async () => {
    await withCommittedBidFixture(async ({ service, bidders, lotIds, auctionIds, walletIds }) => {
      let ready!: () => void, unlock!: () => void;
      const locked = new Promise<void>(resolve => ready = resolve), release = new Promise<void>(resolve => unlock = resolve);
      const blocker = getPrisma().$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "id" = ${walletIds[0]}::uuid FOR UPDATE`;
        ready(); await release;
      });
      await locked;
      await getPrisma().auction.update({ where: { id: auctionIds[0] }, data: { endsAt: new Date(Date.now() + 400) } });
      const bid = service.place(lotIds[0], bidders[0], "100", "wait");
      try { await delay(700); } finally { unlock(); await blocker; }
      await assert.rejects(bid, (e: unknown) => e instanceof HttpError && e.status === 409);
      assert.equal(await getPrisma().bid.count({ where: { lotId: lotIds[0] } }), 0);
    });
  });
});
