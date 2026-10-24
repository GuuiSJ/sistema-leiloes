
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
let startupStage: "jwt" | "database" | "http" = "jwt";

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
  startupStage = "database";
  await connectDatabase();
  if (shuttingDown) {
    await disconnectDatabase();
    return;
  }

  startupStage = "http";
  await new Promise<void>((resolve, reject) => {
    server = app.listen(PORT, (error?: Error) => error ? reject(error) : resolve());
    server.once("error", reject);
  });
  console.log(`Servidor rodando na porta ${PORT}`);
}

void start().catch(async (error: unknown) => {
  if (startupStage === "jwt") {
    console.error("Configuração JWT inválida. Verifique JWT_SECRET (mínimo de 32 bytes) e JWT_EXPIRES_IN (inteiro positivo em segundos).");
  } else if (startupStage === "database") {
    console.error(process.env.DATABASE_URL
      ? "Falha ao conectar ao PostgreSQL. Verifique o serviço e DATABASE_URL."
      : "DATABASE_URL não configurada. Configure backend/.env para iniciar a API.");
  } else if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
    console.error(`A porta ${PORT} já está em uso. Utilize a API existente ou encerre o processo anterior antes de iniciar outra instância.`);
  } else {
    console.error(`Falha ao abrir a porta ${PORT}. Verifique sua disponibilidade e as permissões do processo.`);
  }
  process.exitCode = 1;
  try {
    await shutdown();
  } catch {
    console.error("Falha ao encerrar os recursos do servidor.");
  }
});
