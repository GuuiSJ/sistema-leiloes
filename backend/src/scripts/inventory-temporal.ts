import "../config/env";
import { Client } from "pg";
import { once } from "node:events";
import { inventoryTemporalFields } from "../modules/temporal/temporal-inventory";

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--summary")) throw new Error("Use inventory-temporal.ts [--summary].");
  if (!process.env.DATABASE_URL) throw new Error("Conexão indisponível.");
  // Standalone client: no change to the application pool, timezone or singleton.
  // The inventory establishes a REPEATABLE READ READ ONLY transaction before data reads.
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  const write = async (value: object) => { if (!process.stdout.write(`${JSON.stringify(value)}\n`)) await once(process.stdout, "drain"); };
  try {
    await client.connect();
    const summary = await inventoryTemporalFields({ query: async (sql, parameters) => client.query(sql, parameters) }, args[0] === "--summary" ? undefined : entry => write({ type: "value", ...entry }));
    // Only this trailing record marks a complete report; preceding lines on failure are incomplete.
    await write({ type: "summary", formatVersion: 1, complete: true, ...summary });
  } finally { await client.end(); }
}
if (require.main === module) void main().catch(() => {
  // Never print raw errors, SQL, environment values, URLs or audit/publicData contents.
  console.error("Inventário temporal não concluído. Verifique configuração, permissões e disponibilidade. Relatório sem resumo final deve ser descartado.");
  process.exitCode = 1;
});
