import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BidEventBus, BidExecutionQueue } from "../src/realtime/bid-events";
import { HttpError } from "../src/errors/http-error";

describe("Ordem e isolamento da publicação em memória", () => {
  it("serializa registro e publicação do mesmo lote, mas permite outros lotes", async () => {
    const queue = new BidExecutionQueue(), order: string[] = [];
    let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
    const first = queue.run("a", async () => { order.push("first-start"); await gate; order.push("first-publish"); });
    const second = queue.run("a", async () => { order.push("second-start"); order.push("second-publish"); });
    await queue.run("b", async () => { order.push("other-lot"); });
    assert.deepEqual(order, ["first-start", "other-lot"]); release(); await Promise.all([first, second]);
    assert.deepEqual(order, ["first-start", "other-lot", "first-publish", "second-start", "second-publish"]);
  });
  it("uma operação rejeitada não bloqueia o próximo lance", async () => {
    const queue = new BidExecutionQueue();
    await assert.rejects(queue.run("a", async () => { throw new Error("Rollback"); }));
    assert.equal(await queue.run("a", async () => "accepted"), "accepted");
  });
  it("limita a fila por lote e libera espaço depois de terminar", async () => {
    const queue = new BidExecutionQueue(); let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const operations = Array.from({ length: 100 }, () => queue.run("a", async () => { await gate; }));
    await assert.rejects(queue.run("a", async () => {}), e => e instanceof HttpError && e.status === 429);
    release(); await Promise.all(operations); assert.equal(await queue.run("a", async () => true), true);
  });
  it("desinscrição remove a transmissão sem alterar outros assinantes", () => {
    const bus = new BidEventBus(); let count = 0;
    const unsubscribe = bus.subscribe(() => { count++; });
    const event = { lotId: "a", bidId: "b", amount: "1.00", createdAt: "now", sequence: 1 };
    bus.publish(event); unsubscribe(); bus.publish(event); assert.equal(count, 1);
  });
});
