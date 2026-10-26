import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { createAuctionLifecycleRepository } from "../src/modules/auctions/auction-lifecycle.repository";

describe("Conflitos de agendamento e abertura", () => {
  const error = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("Detalhe privado", { code, meta, clientVersion: "7.10.1" });
  const decide = () => ({ status: "OPEN" as const, openLotIds: [], unchanged: false });
  for (const [label, failure] of [
    ["Prisma", error("P2034")], ["SQLSTATE", error("P2010", { code: "40001" })],
    ["adapter serialização", error("P2010", { driverAdapterError: { cause: { originalCode: "40001" } } })],
    ["adapter deadlock", error("P2010", { driverAdapterError: { cause: { originalCode: "40P01" } } })],
  ] as const) it(`limita ${label} a três tentativas e retorna 409`, async () => {
    let attempts = 0;
    const client = { async $transaction(_fn: unknown, options: { isolationLevel: string }) { attempts++; assert.equal(options.isolationLevel, "Serializable"); throw failure; } } as unknown as PrismaClient;
    await assert.rejects(createAuctionLifecycleRepository(() => client).transition("unused", "open", "unused", decide), e => e instanceof HttpError && e.status === 409); assert.equal(attempts, 3);
  });
  for (const code of ["P2002", "P2003", "P2025"]) it(`mapeia ${code} para conflito de integridade`, async () => {
    const client = { async $transaction() { throw error(code); } } as unknown as PrismaClient;
    await assert.rejects(createAuctionLifecycleRepository(() => client).transition("unused", "schedule", "unused", decide), e => e instanceof HttpError && e.status === 409 && !e.message.includes("privado"));
  });
  it("preserva erro inesperado para tratamento centralizado", async () => {
    const failure = new Error("Falha interna"); const client = { async $transaction() { throw failure; } } as unknown as PrismaClient;
    await assert.rejects(createAuctionLifecycleRepository(() => client).transition("unused", "open", "unused", decide), e => e === failure);
  });
});
