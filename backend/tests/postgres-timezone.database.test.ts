import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withReadonlyTimezones } from "./helpers/timezone-database";

// Characterization of the installed adapter, NOT assertions that its legacy behavior
// is correct. An adapter upgrade/fix must deliberately revise these expectations.
describe("Caracterização temporal do adaptador PostgreSQL 7.10.1 (somente leitura)", { skip: process.env.POSTGRES_TIMEZONE_DATABASE_TESTS !== "1" }, () => {
  it("conexões de teste têm fusos explícitos e são read-only", async () => withReadonlyTimezones(async (legacy, utc) => {
    for (const [client, timezone] of [[legacy, "America/Sao_Paulo"], [utc, "UTC"]] as const) {
      const [row] = await client.$queryRaw<{ timezone: string; readonly: string }[]>`SELECT current_setting('TimeZone') AS "timezone", current_setting('default_transaction_read_only') AS "readonly"`;
      assert.equal(row.timezone, timezone); assert.equal(row.readonly, "on");
    }
  }));
  it("reproduz leitura -3h contra o MESMO clock do banco; UTC coincide com epoch", async () => withReadonlyTimezones(async (legacy, utc) => {
    for (const [client, expected] of [[legacy, -10800000], [utc, 0]] as const) {
      const [row] = await client.$queryRaw<{ observed: Date; milliseconds: bigint }[]>`WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS value) SELECT value AS observed, (EXTRACT(EPOCH FROM value) * 1000)::bigint AS milliseconds FROM instant`;
      assert(Math.abs(row.observed.getTime() - Number(row.milliseconds) - expected) <= 1);
    }
  }));
  it("SELECT parametrizado reproduz gravação interpretada +3h e round-trip enganoso", async () => withReadonlyTimezones(async (legacy, utc) => {
    const input = new Date("2030-01-01T15:00:00.000Z");
    for (const [client, expected] of [[legacy, 10800000], [utc, 0]] as const) {
      const [row] = await client.$queryRaw<{ observed: Date; milliseconds: bigint }[]>`SELECT ${input}::timestamptz AS observed, (EXTRACT(EPOCH FROM ${input}::timestamptz) * 1000)::bigint AS milliseconds`;
      assert.equal(Number(row.milliseconds) - input.getTime(), expected);
      assert.equal(row.observed.toISOString(), input.toISOString());
    }
  }));
  it("comparação SQL do prazo legado diverge da data lida pela aplicação", async () => withReadonlyTimezones(async legacy => {
    const deadline = new Date("2030-01-01T15:00:00Z"), now = new Date("2030-01-01T16:00:00Z");
    const [row] = await legacy.$queryRaw<{ observed: Date; expired: boolean }[]>`SELECT ${deadline}::timestamptz AS observed, ${deadline}::timestamptz <= '2030-01-01T16:00:00Z'::timestamptz AS expired`;
    assert.equal(row.expired, false); assert.equal(row.observed <= now, true);
  }));
  it("horário de verão histórico reproduz 2h, impedindo correção fixa indiscriminada", async () => withReadonlyTimezones(async (legacy, utc) => {
    const input = new Date("2018-01-15T15:00:00Z");
    for (const [client, expected] of [[legacy, 7200000], [utc, 0]] as const) {
      const [row] = await client.$queryRaw<{ milliseconds: bigint }[]>`SELECT (EXTRACT(EPOCH FROM ${input}::timestamptz) * 1000)::bigint AS milliseconds`;
      assert.equal(Number(row.milliseconds) - input.getTime(), expected);
    }
  }));
  it("origem DB-native preserva seu epoch; não recebe o mesmo tratamento do parâmetro legado", async () => withReadonlyTimezones(async legacy => {
    const [row] = await legacy.$queryRaw<{ native: bigint; parameter: bigint }[]>`SELECT (EXTRACT(EPOCH FROM '2030-01-01T15:00:00Z'::timestamptz) * 1000)::bigint AS native, (EXTRACT(EPOCH FROM ${new Date("2030-01-01T15:00:00Z")}::timestamptz) * 1000)::bigint AS parameter`;
    assert.equal(Number(row.native), Date.parse("2030-01-01T15:00:00Z")); assert.equal(Number(row.parameter - row.native), 10800000);
  }));
  it("projeção explícita de legado usa a zona IANA, sem modificar o valor físico", async () => withReadonlyTimezones(async (_legacy, utc) => {
    for (const [physical, intended] of [["2030-01-01T18:00:00Z", "2030-01-01T15:00:00Z"], ["2018-01-15T17:00:00Z", "2018-01-15T15:00:00Z"]]) {
      const [row] = await utc.$queryRaw<{ physical: bigint; projected: bigint }[]>`SELECT (EXTRACT(EPOCH FROM ${physical}::timestamptz) * 1000)::bigint AS physical, (EXTRACT(EPOCH FROM ((${physical}::timestamptz AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC')) * 1000)::bigint AS projected`;
      assert.equal(Number(row.physical), Date.parse(physical)); assert.equal(Number(row.projected), Date.parse(intended));
    }
  }));
});
