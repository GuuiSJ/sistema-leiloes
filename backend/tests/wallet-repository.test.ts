import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { createWalletRepository } from "../src/modules/wallet/wallet.repository";
import { HttpError } from "../src/errors/http-error";

describe("Conflitos financeiros do repositório", () => {
  const error = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("Detalhe privado", { code, meta, clientVersion: "7.10.1" });
  for (const [name, failure] of [
    ["Prisma", error("P2034")], ["SQLSTATE", error("P2010", { code: "40001" })],
    ["adapter serialização", error("P2010", { driverAdapterError: { cause: { originalCode: "40001" } } })],
    ["adapter deadlock", error("P2010", { driverAdapterError: { cause: { originalCode: "40P01" } } })],
  ] as const) it(`limita repetições em conflito ${name}`, async () => {
    let attempts = 0;
    const client = { async $transaction(_fn: unknown, options: { isolationLevel: string }) { attempts++; assert.equal(options.isolationLevel, "Serializable"); throw failure; } } as unknown as PrismaClient;
    await assert.rejects(createWalletRepository(() => client).get("unused"), e => e instanceof HttpError && e.status === 409);
    assert.equal(attempts, 3);
  });
  it("resolve conflito transitório sem repetir além do necessário", async () => {
    let attempts = 0; const snapshot = { marker: true };
    const client = { async $transaction() { if (++attempts < 2) throw error("P2034"); return snapshot; } } as unknown as PrismaClient;
    assert.equal(await createWalletRepository(() => client).get("unused"), snapshot); assert.equal(attempts, 2);
  });
  it("preserva falhas inesperadas para erro interno genérico", async () => {
    const failure = new Error("Falha interna"); const client = { async $transaction() { throw failure; } } as unknown as PrismaClient;
    await assert.rejects(createWalletRepository(() => client).get("unused"), e => e === failure);
  });
});
