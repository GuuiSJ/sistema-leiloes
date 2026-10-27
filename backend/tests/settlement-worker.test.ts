import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { SettlementRepository } from "../src/modules/settlement/settlement.repository";
import { SettlementWorker } from "../src/workers/settlement-worker";
import { SettlementService } from "../src/modules/settlement/settlement.service";
import { SettlementEventBus } from "../src/realtime/settlement-events";

describe("Worker de encerramento", () => {
  it("inicia imediatamente, não sobrepõe ciclos e stop aguarda operação", async () => {
    let started!: () => void, release!: () => void, calls = 0;
    const reached = new Promise<void>(r => started = r), gate = new Promise<void>(r => release = r);
    const repository: SettlementRepository = { async candidates() { return [{ auctionId: "a", lotId: "b" }]; }, async settle() { calls++; started(); await gate; return {}; } };
    const worker = new SettlementWorker(repository, undefined, 5, 25, () => true); worker.start(); worker.start(); await reached;
    try { await delay(25); await worker.tick(); assert.equal(calls, 1); let stopped = false; const stopping = worker.stop().then(() => { stopped = true; }); await delay(10); assert.equal(stopped, false); release(); await stopping; await delay(15); assert.equal(calls, 1); }
    finally { release(); await worker.stop(); }
  });
  it("falha individual não impede os demais e cursor avança após falha", async () => {
    const seen: string[] = [], cursors: (string | undefined)[] = [];
    let finished!: () => void; const done = new Promise<void>(r => finished = r);
    const repository: SettlementRepository = {
      async candidates(_limit, after) { cursors.push(after); return after ? [] : [{ auctionId: "a", lotId: "bad" }, { auctionId: "a", lotId: "good" }]; },
      async settle(_a, id) { seen.push(id!); if (id === "bad") throw new Error("sensitive failure"); finished(); return {}; },
    };
    const worker = new SettlementWorker(repository, undefined, 60000, 25, () => true); worker.start(); await done; await delay(1); await worker.tick(); await worker.stop();
    assert.deepEqual(seen.slice(0, 2), ["bad", "good"]); assert(cursors.includes("a:good"));
  });
  it("falha de descoberta não encerra permanentemente o worker", async () => {
    let calls = 0; const repository: SettlementRepository = { async candidates() { if (++calls === 1) throw new Error("private"); return []; }, async settle() { return {}; } };
    const worker = new SettlementWorker(repository, undefined, 60000, 25, () => true); worker.start(); await delay(1); await worker.tick(); await worker.stop(); assert.equal(calls, 2);
  });
  it("nenhum evento antes da resolução do repositório nem quando ele falha", async () => {
    const events = new SettlementEventBus(), seen: unknown[] = []; events.subscribeLot(e => { seen.push(e); });
    let release!: () => void; const gate = new Promise<void>(r => release = r);
    const repository: SettlementRepository = { async candidates() { return []; }, async settle() { await gate; return { lot: { lotId: "l", auctionId: "a", status: "UNSOLD", closedAt: new Date().toISOString() } }; } };
    const request = new SettlementService(repository, events).process("a", "l"); assert.equal(seen.length, 0); release(); await request; assert.equal(seen.length, 1);
    repository.settle = async () => { throw new Error("rollback"); }; await assert.rejects(new SettlementService(repository, events).process("a", "l")); assert.equal(seen.length, 1);
  });
  it("falhas síncronas e assíncronas de transmissão não propagam nem impedem outros listeners", async () => {
    const events = new SettlementEventBus(), seen: unknown[] = [];
    events.subscribeLot(() => { throw new Error("private"); }); events.subscribeLot(async () => { throw new Error("private"); }); events.subscribeLot(e => { seen.push(e); });
    events.publishLot({ lotId: "l", auctionId: "a", status: "SOLD", closedAt: "now", winnerId: "private" } as never);
    await delay(1); assert.deepEqual(seen, [{ lotId: "l", auctionId: "a", status: "SOLD", closedAt: "now" }]);
  });
});
