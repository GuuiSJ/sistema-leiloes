import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { createBidRepository } from "../src/modules/bids/bid.repository";
import { HttpError } from "../src/errors/http-error";

describe("Conflitos transacionais de lances", () => {
  it("elegibilidade usa snapshot READ ONLY e não cria carteira ausente ou outro registro", async () => {
    const calls: string[] = [];
    const tx = {
      async $executeRaw(sql: TemplateStringsArray) { calls.push(sql.join("")); return 0; },
      lot: { async findUnique() { calls.push("lot"); return { id: "lot", auctionId: "auction", vehicleId: "vehicle" }; } },
      auction: { async findUniqueOrThrow() { return { id: "auction", temporalGeneration: "UTC_V2" }; } },
      vehicle: { async findUniqueOrThrow() { return { ownerId: "owner" }; } },
      bid: { async findFirst() { return null; } },
      auctionReceipt: { async findUnique() { return null; } },
      wallet: { async findUnique() { return null; } },
      async $queryRaw() { return [{ milliseconds: 1700000000000n }]; },
    };
    const client = { async $transaction(fn: (db: unknown) => Promise<unknown>, options: { isolationLevel: string }) { assert.equal(options.isolationLevel, "RepeatableRead"); return fn(tx); } } as unknown as PrismaClient;
    const result = await createBidRepository(() => client).eligibility!("lot", "bidder");
    assert.equal(calls[0], "SET TRANSACTION READ ONLY"); assert.equal(result.walletExists, false);
    assert.equal(result.available.toFixed(2), "0.00"); assert.equal(result.held.toFixed(2), "0.00");
    assert.equal(result.state.now.toISOString(), "2023-11-14T22:13:20.000Z");
  });
  const failure = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("Detalhe privado", { code, meta, clientVersion: "7.10.1" });
  for (const [name, error] of [
    ["Prisma", failure("P2034")], ["SQLSTATE", failure("P2010", { code: "40001" })],
    ["adapter serialização", failure("P2010", { driverAdapterError: { cause: { originalCode: "40001" } } })],
    ["adapter deadlock", failure("P2010", { driverAdapterError: { cause: { originalCode: "40P01" } } })],
  ] as const) it(`limita ${name} a três tentativas e retorna 409`, async () => {
    let attempts = 0;
    const client = { async $transaction(_fn: unknown, options: { isolationLevel: string }) { attempts++; assert.equal(options.isolationLevel, "Serializable"); throw error; } } as unknown as PrismaClient;
    await assert.rejects(createBidRepository(() => client).place("unused", "unused", new Prisma.Decimal(100), "key", () => {}), e => e instanceof HttpError && e.status === 409);
    assert.equal(attempts, 3);
  });
  for (const code of ["P2002", "P2003", "P2025"]) it(`trata ${code} como conflito sem expor detalhes`, async () => {
    const client = { async $transaction() { throw failure(code); } } as unknown as PrismaClient;
    await assert.rejects(createBidRepository(() => client).place("unused", "unused", new Prisma.Decimal(100), "key", () => {}), e => e instanceof HttpError && e.status === 409 && !e.message.includes("privado"));
  });
  it("permite que o tratamento centralizado cuide de falhas inesperadas", async () => {
    const error = new Error("Falha interna"); const client = { async $transaction() { throw error; } } as unknown as PrismaClient;
    await assert.rejects(createBidRepository(() => client).place("unused", "unused", new Prisma.Decimal(100), "key", () => {}), e => e === error);
  });
});
