import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { createLotRepository } from "../src/modules/lots/lot.repository";

describe("Conflitos do repositório de lotes", () => {
  const command = { operation: "delete" as const, auctionId: "unused", lotId: "unused" };
  const error = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("Detalhe privado", { code, clientVersion: "7.10.1", meta });
  const conflict = (e: unknown) => e instanceof HttpError && e.status === 409 && !e.message.includes("privado");
  for (const failure of [error("P2034"), error("P2010", { code: "40001" }), error("P2010", { code: "40P01" }), error("P2010", { driverAdapterError: { cause: { originalCode: "40001" } } }), error("P2010", { driverAdapterError: { cause: { originalCode: "40P01" } } })]) {
    it(`limita repetições em conflito ${failure.code}/${failure.meta?.code ?? ""}`, async () => {
      let attempts = 0;
      const client = { async $transaction(_fn: unknown, options: { isolationLevel: string }) { attempts++; assert.equal(options.isolationLevel, "Serializable"); throw failure; } } as unknown as PrismaClient;
      await assert.rejects(createLotRepository(() => client).write(command, () => {}), conflict); assert.equal(attempts, 3);
    });
  }
  for (const code of ["P2002", "P2003", "P2025"]) it(`converte ${code} para 409 sem repetir escrita`, async () => {
    let attempts = 0;
    const client = { async $transaction() { attempts++; throw error(code); } } as unknown as PrismaClient;
    await assert.rejects(createLotRepository(() => client).write(command, () => {}), conflict); assert.equal(attempts, 1);
  });
  it("conclui após conflito transitório", async () => {
    let attempts = 0; const result = { id: "resultado" };
    const client = { async $transaction() { if (++attempts < 3) throw error("P2034"); return result; } } as unknown as PrismaClient;
    assert.equal(await createLotRepository(() => client).write(command, () => {}), result); assert.equal(attempts, 3);
  });
  it("preserva falha inesperada para tratamento centralizado", async () => {
    const failure = new Error("Falha interna"); const client = { async $transaction() { throw failure; } } as unknown as PrismaClient;
    await assert.rejects(createLotRepository(() => client).write(command, () => {}), e => e === failure);
  });
});
