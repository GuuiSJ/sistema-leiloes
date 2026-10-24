import "../config/env";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getPrisma, disconnectDatabase } from "../lib/prisma";
import type { UserRole } from "../generated/prisma/client";

interface PromotionDependencies {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
  interactive: boolean;
  findUser(email: string): Promise<{ id: string; role: UserRole } | null>;
  promote(id: string, email: string): Promise<boolean>;
  confirm(question: string): Promise<string>;
  log(message: string): void;
}

class PromotionError extends Error {}

export async function promoteAuctioneer(args: string[], dependencies: PromotionDependencies): Promise<void> {
  if (dependencies.nodeEnv !== "development") {
    throw new PromotionError("Operação permitida somente com NODE_ENV=development.");
  }
  let local = false;
  try {
    const url = new URL(dependencies.databaseUrl ?? "");
    local = ["postgresql:", "postgres:"].includes(url.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && url.pathname === "/sistema_leiloes"
      && !url.searchParams.has("host");
  } catch { /* Não exibir a URL nem o erro de parsing. */ }
  if (!local) throw new PromotionError("Configure DATABASE_URL para o banco local sistema_leiloes em localhost ou loopback.");
  if (args.length !== 1) throw new PromotionError("Uso: npm run user:promote -- email@example.com");
  const email = args[0]!.trim().toLowerCase();
  if (email.length > 254 || /[\x00-\x1f\x7f]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PromotionError("Informe um e-mail válido.");
  }
  if (!dependencies.interactive) throw new PromotionError("Execute em um terminal interativo; confirmação por pipe não é aceita.");

  const user = await dependencies.findUser(email);
  if (!user) throw new PromotionError("Usuário não encontrado. Nenhuma conta foi criada.");
  if (user.role === "AUCTIONEER") {
    dependencies.log("O usuário já possui perfil AUCTIONEER. Nenhuma alteração realizada.");
    return;
  }
  const answer = await dependencies.confirm(`Promover ${email} de BIDDER para AUCTIONEER no banco local sistema_leiloes? Digite PROMOVER para confirmar: `);
  if (answer !== "PROMOVER") {
    dependencies.log("Operação cancelada. Nenhuma alteração realizada.");
    return;
  }
  if (!await dependencies.promote(user.id, email)) {
    throw new PromotionError("Usuário alterado durante a confirmação. Nenhuma promoção realizada; verifique e tente novamente.");
  }
  dependencies.log("Perfil atualizado para AUCTIONEER com sucesso.");
}

async function main(): Promise<void> {
  try {
    await promoteAuctioneer(process.argv.slice(2), {
      nodeEnv: process.env.NODE_ENV,
      databaseUrl: process.env.DATABASE_URL,
      interactive: Boolean(stdin.isTTY && stdout.isTTY),
      findUser: (email) => getPrisma().user.findUnique({ where: { email }, select: { id: true, role: true } }),
      async promote(id, email) {
        // SQL parametrizado via Prisma: alterar literalmente só role, sem @updatedAt.
        const count = await getPrisma().$executeRaw`
          UPDATE "User" SET "role" = 'AUCTIONEER'::"UserRole"
          WHERE "id" = ${id}::uuid AND "email" = ${email} AND "role" = 'BIDDER'::"UserRole"
        `;
        return count === 1;
      },
      async confirm(question) {
        const terminal = createInterface({ input: stdin, output: stdout });
        try { return await terminal.question(question); }
        finally { terminal.close(); }
      },
      log: (message) => console.log(message),
    });
  } catch (error: unknown) {
    console.error(error instanceof PromotionError ? error.message : "Falha na operação administrativa. Verifique a conexão local; detalhes sensíveis foram omitidos.");
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  void main().catch(() => {
    console.error("Falha ao encerrar a conexão administrativa.");
    process.exitCode = 1;
  });
}
