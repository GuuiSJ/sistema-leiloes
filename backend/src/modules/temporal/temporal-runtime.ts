import { Prisma, $Enums, type PrismaClient } from "../../generated/prisma/client";
import { HttpError } from "../../errors/http-error";
import { temporalMode, type TemporalMode } from "../../config/temporal";
import { loadAuditChain, verifyOpeningAuditChain } from "../audit/opening-audit";

export const temporalMigration = "20261028000000_auction_temporal_generation";
export function generatedTemporalSupport(): boolean {
  const fields = Prisma.AuctionScalarFieldEnum as Record<string, string>;
  const enumeration = ($Enums as unknown as Record<string, Record<string, string>>).AuctionTemporalGeneration;
  return fields.temporalGeneration === "temporalGeneration" && !!enumeration
    && Object.values(enumeration).sort().join(",") === "LEGACY,UTC_V2";
}
export class TemporalStartupError extends Error {
  constructor(readonly code: string) { super(`Inicialização temporal bloqueada: ${code}.`); }
}
function incompatible(code: string): never { throw new TemporalStartupError(code); }

export class TemporalRuntime {
  private ready = false;
  constructor(readonly mode: TemporalMode, private readonly clientSupportsGeneration = generatedTemporalSupport) {}
  get utcActive(): boolean { return this.ready && this.mode === "UTC_V2"; }
  get workerReady(): boolean { return this.utcActive; }
  reset(): void { this.ready = false; }
  assertClientAccess(): void {
    if (!this.ready) throw new HttpError(503, "Inicialização temporal ainda não validada.");
  }
  creationGeneration(): "UTC_V2" | undefined {
    this.assertClientAccess();
    return this.utcActive ? "UTC_V2" : undefined;
  }

  async verify(client: PrismaClient): Promise<void> {
    this.ready = false;
    const supported = this.clientSupportsGeneration();
    if (this.mode === "UTC_V2" && !supported) incompatible("PRISMA_CLIENT_DESATUALIZADO");
    // Inspection is read-only, and uses the same resolved Auction relation as application SQL.
    const [schema] = await client.$queryRaw<{ present: boolean; compatible: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"Auction"')
        AND attname = 'temporalGeneration' AND NOT attisdropped) AS "present",
        EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
          JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = to_regclass('"Auction"') AND a.attname = 'temporalGeneration' AND NOT a.attisdropped
            AND a.attnotnull AND t.typname = 'AuctionTemporalGeneration'
            AND pg_get_expr(d.adbin, d.adrelid) = quote_literal('LEGACY') || '::' || format_type(a.atttypid, NULL)
            AND (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid) = 'LEGACY,UTC_V2'
            AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisvalid AND i.indisready
              AND i.indpred IS NULL AND i.indexprs IS NULL
              AND (SELECT array_agg(att.attname::text ORDER BY keys.position) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY keys(num, position)
                JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = keys.num) = ARRAY['temporalGeneration','status'])) AS "compatible"`;
    if (!schema || supported !== schema.present || (schema.present && !schema.compatible)) incompatible("SCHEMA_CLIENT_INCOMPATIVEIS");
    if (this.mode === "LEGACY") {
      const [audit] = await client.$queryRaw<{ activated: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM "AuditEvent" WHERE "publicData"->'formatVersion' = '2'::jsonb) AS "activated"`;
      if (!audit || audit.activated) incompatible("RETORNO_A_LEGACY_PROIBIDO");
      if (schema.present) {
        const [state] = await client.$queryRaw<{ activated: boolean }[]>`SELECT EXISTS (SELECT 1 FROM "Auction" WHERE "temporalGeneration" = 'UTC_V2') AS "activated"`;
        if (!state || state.activated) incompatible("RETORNO_A_LEGACY_PROIBIDO");
      }
      this.ready = true;
      return;
    }
    if (!schema.present) incompatible("MIGRACAO_AUSENTE");
    const [migration] = await client.$queryRaw<{ applied: boolean }[]>`SELECT EXISTS (
      SELECT 1 FROM "_prisma_migrations" WHERE migration_name = ${temporalMigration}
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS "applied"`;
    if (!migration?.applied) incompatible("MIGRACAO_NAO_CONFIRMADA");
    const [legacy] = await client.$queryRaw<{ active: boolean }[]>`SELECT EXISTS (SELECT 1 FROM "Auction" WHERE "temporalGeneration" = 'LEGACY' AND "status" = 'OPEN')
      OR EXISTS (SELECT 1 FROM "BidReservation" r JOIN "Lot" l ON l."id" = r."lotId" JOIN "Auction" a ON a."id" = l."auctionId"
        WHERE a."temporalGeneration" = 'LEGACY' AND r."status" = 'ACTIVE') AS "active"`;
    if (!legacy || legacy.active) incompatible("OPERACOES_LEGACY_ATIVAS");
    const [types] = await client.$queryRaw<{ valid: boolean }[]>`SELECT COUNT(*) = 20 AND bool_and(format_type(a.atttypid, a.atttypmod) = 'timestamp(3) with time zone') AS "valid"
      FROM (VALUES ('User','createdAt'),('User','updatedAt'),('Vehicle','createdAt'),('Vehicle','updatedAt'),('Vehicle','fipeConsultedAt'),
        ('Auction','startsAt'),('Auction','endsAt'),('Auction','createdAt'),('Auction','updatedAt'),('Lot','endsAt'),('Lot','createdAt'),('Lot','updatedAt'),
        ('Bid','createdAt'),('Wallet','createdAt'),('Wallet','updatedAt'),('WalletTransaction','createdAt'),('BidReservation','createdAt'),('BidReservation','updatedAt'),
        ('AuctionReceipt','issuedAt'),('AuditEvent','occurredAt')) expected(model, field)
      JOIN pg_attribute a ON a.attrelid = to_regclass(quote_ident(expected.model)) AND a.attname = expected.field AND NOT a.attisdropped`;
    if (!types?.valid) incompatible("TIPOS_TEMPORAIS_INCOMPATIVEIS");
    await client.$transaction(async tx => {
      const input = new Date("2030-01-01T15:00:00.123Z");
      const [probe] = await tx.$queryRaw<{ timezone: string; observed: Date; milliseconds: bigint; parameter: bigint }[]>`
        WITH instant AS MATERIALIZED (SELECT date_trunc('milliseconds', clock_timestamp()) AS value)
        SELECT current_setting('TimeZone') AS "timezone", value AS "observed", (EXTRACT(EPOCH FROM value) * 1000)::bigint AS "milliseconds",
          (EXTRACT(EPOCH FROM ${input}::timestamptz) * 1000)::bigint AS "parameter" FROM instant`;
      if (!probe || probe.timezone !== "UTC" || probe.observed.getTime() !== Number(probe.milliseconds) || Number(probe.parameter) !== input.getTime()) incompatible("UTC_EPOCH_INCOMPATIVEL");
      // Exercise the actual generated ORM against the migrated column without writing.
      await tx.auction.findFirst({ select: { id: true, ...{ temporalGeneration: true } } });
      verifyOpeningAuditChain(await loadAuditChain(tx));
    }, { isolationLevel: "RepeatableRead" });
    this.ready = true;
  }
}

// Configuration is fixed for this process; changing environment variables cannot activate it live.
export const temporalRuntime = new TemporalRuntime(temporalMode());
