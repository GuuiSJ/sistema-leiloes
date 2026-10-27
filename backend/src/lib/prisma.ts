import "../config/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { temporalPoolConfig } from "../config/temporal";
import { temporalRuntime } from "../modules/temporal/temporal-runtime";

let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  temporalRuntime.assertClientAccess();
  return unverifiedPrisma();
}

// Startup alone may access the candidate pool before compatibility verification.
function unverifiedPrisma(): PrismaClient {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL não configurada.");
    }

    const adapter = new PrismaPg(temporalPoolConfig(connectionString, temporalRuntime.mode));

    // Não registrar queries ou erros do driver: podem conter dados sensíveis.
    client = new PrismaClient({ adapter, log: [], errorFormat: "minimal" });
  }

  return client;
}

export async function connectDatabase(): Promise<void> {
  temporalRuntime.reset();
  const prisma = unverifiedPrisma();
  await prisma.$connect();
  await temporalRuntime.verify(prisma);
}

export async function disconnectDatabase(): Promise<void> {
  temporalRuntime.reset();
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
