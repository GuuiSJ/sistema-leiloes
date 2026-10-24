import { connectDatabase, disconnectDatabase } from "../lib/prisma";

async function main(): Promise<void> {
  try {
    await connectDatabase();
    console.log("Conexão com PostgreSQL validada com SELECT 1.");
  } catch {
    console.error(
      process.env.DATABASE_URL
        ? "Falha na conexão. Verifique o serviço PostgreSQL, o banco e as credenciais de DATABASE_URL."
        : "DATABASE_URL não configurada. Configure backend/.env antes de testar a conexão.",
    );
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void main().catch(() => {
  console.error("Falha ao encerrar a conexão com PostgreSQL.");
  process.exitCode = 1;
});
