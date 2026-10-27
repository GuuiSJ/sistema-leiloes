import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "pg";
import "../src/config/env";
import { inventoryTemporalFields } from "../src/modules/temporal/temporal-inventory";

describe("Inventário PostgreSQL real (somente leitura)", { skip: process.env.TEMPORAL_INVENTORY_DATABASE_TESTS !== "1" }, () => {
  it("snapshot é read-only, consistente e mantém registros existentes intactos", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    try {
      await client.connect(); const reads: string[] = [];
      const fingerprint = async () => (await client.query(`SELECT md5(COALESCE(string_agg(row_to_json(a)::text, '' ORDER BY "sequence"), '')) AS digest FROM "AuditEvent" a`)).rows[0].digest;
      const before = await fingerprint(); let checked = false;
      const summary = await inventoryTemporalFields({ query: async (sql, parameters) => { reads.push(sql); return client.query(sql, parameters); } }, async entry => {
        if (!checked) { const r = await client.query("SELECT current_setting('transaction_read_only') AS readonly, current_setting('transaction_isolation') AS isolation"); assert.equal(r.rows[0].readonly, "on"); assert.equal(r.rows[0].isolation, "repeatable read"); checked = true; }
        assert.equal(typeof entry.id, "string"); if (entry.storedEpochMs !== null) assert.match(entry.storedEpochMs, /^-?\d+$/);
      });
      assert.equal(summary.fieldDefinitions, 20); assert.equal(summary.values, summary.nullValues + summary.proven + summary.partial + summary.unknown); assert.equal(summary.provenOrigins, 0);
      assert.equal(await fingerprint(), before); assert(reads.every(sql => /^(BEGIN|SELECT|COMMIT)/.test(sql)));
    } finally { await client.end(); }
  });
});
