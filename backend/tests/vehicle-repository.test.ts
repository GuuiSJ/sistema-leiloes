import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { HttpError } from "../src/errors/http-error";
import { createVehicleRepository } from "../src/modules/vehicles/vehicle.repository";

describe("Conflitos do repositório de veículos", () => {
  function prismaError(code: string, meta?: Record<string, unknown>) {
    return new Prisma.PrismaClientKnownRequestError("Detalhe privado do driver", { code, clientVersion: "7.10.1", meta });
  }
  const decision = () => ({ operation: "delete" as const });
  const conflict = (error: unknown) => error instanceof HttpError && error.status === 409 && !error.message.includes("privado");

  for (const [name, error] of [
    ["serialização Prisma", prismaError("P2034")],
    ["serialização de query raw", prismaError("P2010", { code: "40001" })],
    ["deadlock de query raw", prismaError("P2010", { code: "40P01" })],
    ["serialização do adapter-pg", prismaError("P2010", { driverAdapterError: { cause: { originalCode: "40001" } } })],
    ["deadlock do adapter-pg", prismaError("P2010", { driverAdapterError: { cause: { originalCode: "40P01" } } })],
  ] as const) it(`repete ${name} e limita a três tentativas antes de retornar 409`, async () => {
    let attempts = 0;
    const client = { async $transaction(_operation: unknown, options: { isolationLevel: string }) {
      attempts++;
      assert.equal(options.isolationLevel, "Serializable");
      throw error;
    } } as unknown as PrismaClient;
    await assert.rejects(createVehicleRepository(() => client).mutate("unused", decision), conflict);
    assert.equal(attempts, 3);
  });
  it("conclui quando uma repetição resolve o conflito", async () => {
    let attempts = 0;
    const result = { id: "resultado" };
    const client = { async $transaction() {
      if (++attempts < 3) throw prismaError("P2034");
      return result;
    } } as unknown as PrismaClient;
    assert.equal(await createVehicleRepository(() => client).mutate("unused", decision), result);
    assert.equal(attempts, 3);
  });
  it("mapeia violação de FK para 409 sem repetir", async () => {
    let attempts = 0;
    const client = { async $transaction() { attempts++; throw prismaError("P2003"); } } as unknown as PrismaClient;
    await assert.rejects(createVehicleRepository(() => client).mutate("unused", decision), conflict);
    assert.equal(attempts, 1);
  });
  it("preserva erros desconhecidos para o tratamento centralizado", async () => {
    const error = new Error("Falha interna");
    const client = { async $transaction() { throw error; } } as unknown as PrismaClient;
    await assert.rejects(createVehicleRepository(() => client).mutate("unused", decision), thrown => thrown === error);
  });
});
