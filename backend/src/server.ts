
import "./config/env";
import app from "./app";
import type { Server } from "node:http";
import { connectDatabase, disconnectDatabase } from "./lib/prisma";
import { getAuthConfig } from "./config/auth";

const PORT = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT deve ser um número inteiro entre 1 e 65535.");
}

let server: Server | undefined;
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    if (server?.listening) {
      const activeServer = server;
      const timeout = setTimeout(() => activeServer.closeAllConnections(), 10000);
      timeout.unref();
      try {
        await new Promise<void>((resolve, reject) => {
          activeServer.close((error) => error ? reject(error) : resolve());
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  } finally {
    await disconnectDatabase();
  }
}

function stop(): void {
  void shutdown().catch(() => {
    console.error("Falha ao encerrar os recursos do servidor.");
    process.exitCode = 1;
  });
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

async function start(): Promise<void> {
  getAuthConfig();
  await connectDatabase();
  if (shuttingDown) {
    await disconnectDatabase();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server = app.listen(PORT, (error?: Error) => error ? reject(error) : resolve());
    server.once("error", reject);
  });
  console.log(`Servidor rodando na porta ${PORT}`);
}

void start().catch(async () => {
  console.error(
    process.env.DATABASE_URL
      ? "Falha ao iniciar a API. Verifique JWT_SECRET, JWT_EXPIRES_IN, PostgreSQL, DATABASE_URL e PORT."
      : "DATABASE_URL não configurada. Configure backend/.env para iniciar a API.",
  );
  process.exitCode = 1;
  try {
    await shutdown();
  } catch {
    console.error("Falha ao encerrar os recursos do servidor.");
  }
});
