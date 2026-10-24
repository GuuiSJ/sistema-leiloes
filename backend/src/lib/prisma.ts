import "../config/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL não configurada.");
    }

    const adapter = new PrismaPg({
      connectionString,
      connectionTimeoutMillis: 5000,
    });

    // Não registrar queries ou erros do driver: podem conter dados sensíveis.
    client = new PrismaClient({ adapter, log: [], errorFormat: "minimal" });
  }

  return client;
}

export async function connectDatabase(): Promise<void> {
  const prisma = getPrisma();
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnectDatabase(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
