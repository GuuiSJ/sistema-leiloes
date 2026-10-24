import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promoteAuctioneer } from "../src/scripts/promote-auctioneer";

function fixture() {
  const calls = { reads: 0, writes: 0, confirmations: 0, email: "", messages: [] as string[] };
  const dependencies = {
    nodeEnv: "development" as string | undefined,
    databaseUrl: "postgresql://localhost:5432/sistema_leiloes" as string | undefined,
    interactive: true,
    async findUser(email: string) { calls.reads++; calls.email = email; return { id: "user-id", role: "BIDDER" as const }; },
    async promote(id: string, email: string) { assert.equal(id, "user-id"); assert.equal(email, "teste@example.com"); calls.writes++; return true; },
    async confirm() { calls.confirmations++; return "PROMOVER"; },
    log(message: string) { calls.messages.push(message); },
  };
  return { calls, dependencies };
}

describe("Promoção administrativa local (sem acesso ao banco)", () => {
  it("normaliza e-mail e promove somente após confirmação explícita", async () => {
    const { calls, dependencies } = fixture();
    dependencies.promote = async () => { assert.equal(calls.confirmations, 1); calls.writes++; return true; };
    await promoteAuctioneer([" TESTE@EXAMPLE.COM "], dependencies);
    assert.equal(calls.email, "teste@example.com");
    assert.equal(calls.writes, 1);
  });
  it("bloqueia ambientes diferentes de development antes de consultar", async () => {
    for (const nodeEnv of [undefined, "production", "test", "Development"]) {
      const { calls, dependencies } = fixture();
      dependencies.nodeEnv = nodeEnv;
      await assert.rejects(promoteAuctioneer(["teste@example.com"], dependencies));
      assert.equal(calls.reads, 0);
      assert.equal(calls.writes, 0);
    }
  });
  it("bloqueia conexão remota, outro banco e URL ausente ou inválida", async () => {
    for (const databaseUrl of [undefined, "invalida", "postgresql://remote.example/sistema_leiloes", "postgresql://localhost/producao", "postgresql://localhost/sistema_leiloes?host=remote.example"]) {
      const { calls, dependencies } = fixture();
      dependencies.databaseUrl = databaseUrl;
      await assert.rejects(promoteAuctioneer(["teste@example.com"], dependencies));
      assert.equal(calls.reads, 0);
    }
  });
  it("rejeita argumentos inválidos e opções de confirmação automática", async () => {
    for (const args of [[], ["invalido"], ["teste@example.com", "--yes"], ["teste\n@example.com"]]) {
      const { calls, dependencies } = fixture();
      await assert.rejects(promoteAuctioneer(args, dependencies));
      assert.equal(calls.reads, 0);
    }
  });
  it("exige terminal interativo", async () => {
    const { calls, dependencies } = fixture();
    dependencies.interactive = false;
    await assert.rejects(promoteAuctioneer(["teste@example.com"], dependencies));
    assert.equal(calls.reads, 0);
  });
  it("não cria usuário inexistente", async () => {
    const { calls, dependencies } = fixture();
    await assert.rejects(promoteAuctioneer(["teste@example.com"], { ...dependencies, findUser: async () => null }));
    assert.equal(calls.confirmations, 0);
    assert.equal(calls.writes, 0);
  });
  it("não altera usuário que já é AUCTIONEER", async () => {
    const { calls, dependencies } = fixture();
    await promoteAuctioneer(["teste@example.com"], { ...dependencies, findUser: async () => ({ id: "user-id", role: "AUCTIONEER" }) });
    assert.equal(calls.confirmations, 0);
    assert.equal(calls.writes, 0);
  });
  it("resposta vazia, sim ou diferente da confirmação cancela sem escrita", async () => {
    for (const answer of ["", "sim", "promover", "PROMOVER "]) {
      const { calls, dependencies } = fixture();
      await promoteAuctioneer(["teste@example.com"], { ...dependencies, confirm: async () => answer });
      assert.equal(calls.writes, 0);
    }
  });
  it("interrupção da confirmação não promove", async () => {
    const { calls, dependencies } = fixture();
    await assert.rejects(promoteAuctioneer(["teste@example.com"], { ...dependencies, confirm: async () => { throw new Error("Interrompido"); } }));
    assert.equal(calls.writes, 0);
  });
  it("trata conflito de alteração durante a confirmação", async () => {
    const { dependencies } = fixture();
    await assert.rejects(promoteAuctioneer(["teste@example.com"], { ...dependencies, promote: async () => false }), /alterado durante/);
  });
});
