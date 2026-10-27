import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backupConnection } from "../src/scripts/backup-temporal-preflight";

describe("Protecao do backup temporal, sem conexao ou backup real", () => {
  it("permite somente o banco local principal solicitado para esta operacao de leitura", () => {
    const { env } = backupConnection("postgresql://fixture:synthetic@localhost:5432/sistema_leiloes?schema=public");
    assert.equal(env.PGDATABASE, "sistema_leiloes");
    assert.equal(env.PGHOST, "localhost");
    assert.equal(env.PGOPTIONS, "-c default_transaction_read_only=on");
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.PGSERVICE, undefined);
    assert.equal(env.PGHOSTADDR, undefined);
  });
  for (const url of [
    "postgresql://fixture@localhost/outro_banco", "postgresql://fixture@remote.invalid/sistema_leiloes",
    "postgresql://fixture@localhost/sistema_leiloes?host=remote.invalid",
    "postgresql://fixture@localhost/sistema_leiloes?dbname=outro_banco",
    "postgresql://fixture@localhost/sistema_leiloes?options=-c%20default_transaction_read_only=off",
    "postgresql://fixture@localhost/sistema_leiloes?schema=outro", "file:///sistema_leiloes",
  ]) it(`rejeita destino ou opcoes indevidas: ${new URL(url).protocol} ${new URL(url).searchParams.keys().next().value ?? "destino"}`, () => {
    assert.throws(() => backupConnection(url));
  });
  it("erros de configuracao nao incluem credenciais recebidas", () => {
    const marker = "synthetic-private-marker";
    assert.throws(() => backupConnection(`postgresql://fixture:${marker}@remote.invalid/sistema_leiloes`), error =>
      error instanceof Error && !error.message.includes(marker));
  });
});
