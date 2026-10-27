import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateCreate, validatePatch } from "../src/modules/auctions/auction.validation";

const schema = readFileSync(resolve(__dirname, "../prisma/schema.prisma"), "utf8");
const sql = readFileSync(resolve(__dirname, "../prisma/migrations/20261028000000_auction_temporal_generation/migration.sql"), "utf8").replace(/--[^\n]*/g, "");
describe("Preparação da geração temporal (sem conexão ou aplicação de migração)", () => {
  it("enum do schema é explícito e contém apenas LEGACY e UTC_V2", () => {
    const body = schema.match(/enum AuctionTemporalGeneration\s*\{([^}]+)\}/)?.[1]; assert(body); assert.deepEqual(body.trim().split(/\s+/), ["LEGACY", "UTC_V2"]);
  });
  it("Auction exige marcador com padrão seguro LEGACY e índice por geração/status", () => {
    const body = schema.match(/model Auction\s*\{([\s\S]*?)\n\}/)?.[1]; assert(body);
    assert.match(body, /temporalGeneration\s+AuctionTemporalGeneration\s+@default\(LEGACY\)/);
    assert.match(body, /@@index\(\[temporalGeneration,\s*status\]\)/);
  });
  it("migração usa somente DDL aditivo e uma transação com timeout de lock", () => {
    const commands = sql.split(";").map(s => s.trim()).filter(Boolean);
    assert.equal(commands.length, 6); assert.equal(commands[0], "BEGIN"); assert.equal(commands.at(-1), "COMMIT");
    assert.equal(commands[1], "SET LOCAL lock_timeout = '10s'");
    assert.match(commands[2], /^CREATE TYPE "AuctionTemporalGeneration" AS ENUM \('LEGACY', 'UTC_V2'\)$/);
    assert.match(commands[3], /^ALTER TABLE "Auction"\s+ADD COLUMN "temporalGeneration" "AuctionTemporalGeneration" NOT NULL DEFAULT 'LEGACY'$/);
    assert.match(commands[4], /^CREATE INDEX "Auction_temporalGeneration_status_idx"\s+ON "Auction"\("temporalGeneration", "status"\)$/);
  });
  it("não reescreve datas, estados, finanças ou hashes e não usa inferências", () => {
    assert(!/\b(?:UPDATE|DELETE|DROP|TRUNCATE|INSERT|ALTER\s+(?:DATABASE|ROLE|SYSTEM))\b/i.test(sql));
    for (const column of ["createdAt", "updatedAt", "startsAt", "endsAt", "balance", "currentHash", "previousHash"]) assert(!sql.includes(`"${column}"`));
    assert(!/clock_timestamp|CURRENT_TIMESTAMP|NOW\(|AT TIME ZONE/i.test(sql));
  });
  it("padrão não é promovido para UTC_V2 ao final da migração", () => {
    assert(!/SET DEFAULT\s+'UTC_V2'/i.test(sql)); assert.equal((sql.match(/DEFAULT 'LEGACY'/g) ?? []).length, 1);
  });
  it("cliente REST não pode escolher a geração no cadastro", () => {
    for (const marker of ["LEGACY", "UTC_V2"]) assert.throws(() => validateCreate({ title: "Fixture", startsAt: "2030-01-01T15:00:00Z", endsAt: "2030-01-01T16:00:00Z", temporalGeneration: marker }));
  });
  it("cliente REST não pode promover um leilão existente via PATCH", () => {
    assert.throws(() => validatePatch({ temporalGeneration: "UTC_V2" }));
    assert.throws(() => validatePatch({ title: "Fixture", temporalGeneration: "UTC_V2" }));
  });
});
