import { createHash, randomUUID } from "node:crypto";
import type { AuditEvent, Prisma } from "../../generated/prisma/client";
import { HttpError } from "../../errors/http-error";
import type { PrepareOpeningAudit } from "../auctions/auction-lifecycle.types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(): never { throw new HttpError(409, "Cadeia de auditoria inválida ou formato não suportado. Abertura não aplicada."); }
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
export function auditFormatVersion(publicData: AuditEvent["publicData"]): 1 | 2 {
  if (!publicData || typeof publicData !== "object" || Array.isArray(publicData)) invalid();
  if (!Object.prototype.hasOwnProperty.call(publicData, "formatVersion")) return 1;
  const version = publicData.formatVersion;
  if (version !== 1 && version !== 2) invalid();
  return version;
}
function validatePublicData(event: Pick<AuditEvent, "action" | "entityType" | "entityId" | "publicData">): void {
  if (!uuid.test(event.entityId) || !event.publicData || typeof event.publicData !== "object" || Array.isArray(event.publicData)) invalid();
  const data = event.publicData as Record<string, unknown>;
  auditFormatVersion(event.publicData);
  // Absence is the original v1 contract: do not insert a version into signed data.
  const keys = Object.keys(data).filter(key => key !== "formatVersion").sort().join(",");
  if (["LOT_CLOSED", "FUNDS_DEBITED", "RECEIPT_ISSUED", "AUCTION_CLOSED"].includes(event.action)) {
    if (event.action === "AUCTION_CLOSED") {
      if (event.entityType !== "Auction" || keys !== "status" || data.status !== "CLOSED") invalid();
    } else {
      if (event.entityType !== "Lot" || keys !== "auctionId,status" || typeof data.auctionId !== "string" || !uuid.test(data.auctionId) || !["SOLD", "UNSOLD"].includes(String(data.status))) invalid();
      if (event.action !== "LOT_CLOSED" && data.status !== "SOLD") invalid();
    }
    return;
  }
  if (data.status !== "OPEN") invalid();
  if (event.action === "AUCTION_OPENED" && event.entityType === "Auction") {
    if (keys !== "lotIds,status" || !Array.isArray(data.lotIds) || !data.lotIds.length || data.lotIds.some(id => typeof id !== "string" || !uuid.test(id))) invalid();
    if (new Set(data.lotIds).size !== data.lotIds.length || [...data.lotIds].sort().join(",") !== data.lotIds.join(",")) invalid();
  } else if (event.action === "LOT_OPENED" && event.entityType === "Lot") {
    if (keys !== "auctionId,number,status" || typeof data.auctionId !== "string" || !uuid.test(data.auctionId) || !Number.isInteger(data.number) || (data.number as number) < 1) invalid();
  } else invalid();
}
export function openingAuditHash(event: Pick<AuditEvent, "id" | "sequence" | "action" | "entityType" | "entityId" | "occurredAt" | "publicData" | "previousHash">): string {
  validatePublicData(event);
  const version = auditFormatVersion(event.publicData);
  if (!Number.isFinite(event.occurredAt.getTime())) invalid();
  return createHash("sha256").update(canonical({
    formatVersion: version,
    ...(version === 2 ? { timestampEncoding: "UTC_ISO8601_MILLISECONDS" } : {}),
    id: event.id, sequence: event.sequence.toString(), action: event.action,
    entityType: event.entityType, entityId: event.entityId, occurredAt: event.occurredAt.toISOString(),
    publicData: event.publicData, previousHash: event.previousHash,
  }), "utf8").digest("hex");
}
export function verifyOpeningAuditChain(events: AuditEvent[]): string | null {
  let previousHash: string | null = null, previousSequence = 0n;
  let reachedV2 = false;
  for (const event of events) {
    const version = auditFormatVersion(event.publicData);
    if (reachedV2 && version === 1) invalid();
    reachedV2 ||= version === 2;
    if (event.sequence <= previousSequence || event.previousHash !== previousHash || !/^[0-9a-f]{64}$/.test(event.currentHash) || event.currentHash !== openingAuditHash(event)) invalid();
    previousHash = event.currentHash; previousSequence = event.sequence;
  }
  return previousHash;
}

// Fixed historical interpretation proven by the inventory. Never try alternate offsets.
// Epoch values bypass adapter/session timezone conversion for BOTH versions.
export async function loadAuditChain(tx: Prisma.TransactionClient): Promise<AuditEvent[]> {
  const rows = await tx.$queryRaw<(Omit<AuditEvent, "occurredAt"> & { milliseconds: bigint })[]>`
    SELECT "id", "sequence", "action", "entityType", "entityId", "publicData", "previousHash", "currentHash",
      CASE WHEN "publicData"->'formatVersion' = '2'::jsonb
        THEN (EXTRACT(EPOCH FROM "occurredAt") * 1000)::bigint
        ELSE (EXTRACT(EPOCH FROM (("occurredAt" AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC')) * 1000)::bigint
      END AS "milliseconds"
    FROM "AuditEvent" ORDER BY "sequence"`;
  return rows.map(row => ({ ...row, authorId: null, occurredAt: new Date(Number(row.milliseconds)) }));
}

export async function prepareAuditWriter(tx: Prisma.TransactionClient) {
  // A global table lock covers even an empty chain and blocks non-cooperating inserts.
  // Caller must use Serializable + retries: a waiter may hold an older snapshot.
  await tx.$executeRaw`LOCK TABLE "AuditEvent" IN SHARE ROW EXCLUSIVE MODE`;
  const existing = await loadAuditChain(tx);
  let previousHash = verifyOpeningAuditChain(existing);
  let previousSequence = existing.at(-1)?.sequence ?? 0n;
  let tail: Promise<void> = Promise.resolve();
  return async (action: AuditEvent["action"], entityType: string, entityId: string, publicData: Prisma.InputJsonObject, authorId: string | null, occurredAt: Date): Promise<void> => {
    // Snapshot caller-owned values before any await or queue wait.
    if (auditFormatVersion(publicData as Prisma.JsonObject) !== 2) invalid();
    validatePublicData({ action, entityType, entityId, publicData: publicData as Prisma.JsonObject });
    const data = JSON.parse(JSON.stringify(publicData)) as Prisma.JsonObject;
    const instant = new Date(occurredAt.getTime());
    if (!Number.isFinite(instant.getTime())) invalid();
    const append = async () => {
      // This writer only appends v2, even to an empty or entirely v1 chain.
      const [allocated] = await tx.$queryRaw<{ sequence: bigint }[]>`SELECT nextval(pg_get_serial_sequence('"AuditEvent"', 'sequence'))::bigint AS "sequence"`;
      if (!allocated || allocated.sequence <= previousSequence) invalid();
      const event = { id: randomUUID(), sequence: allocated.sequence, action, entityType, entityId, occurredAt: instant, publicData: data, previousHash };
      const currentHash = openingAuditHash(event);
      // Insert epoch explicitly. An ORM Date write on the legacy pool is not UTC-safe.
      await tx.$executeRaw`INSERT INTO "AuditEvent" ("id", "sequence", "authorId", "action", "entityType", "entityId", "occurredAt", "publicData", "previousHash", "currentHash")
        VALUES (${event.id}::uuid, ${event.sequence}::bigint, ${authorId}::uuid, ${action}::"AuditAction", ${entityType}, ${entityId}::uuid,
          to_timestamp(${instant.getTime()}::double precision / 1000.0), ${JSON.stringify(data)}::jsonb, ${previousHash}, ${currentHash})`;
      previousHash = currentHash;
      previousSequence = allocated.sequence;
    };
    // Preserve a single tail even when a caller appends concurrently within its transaction.
    const result = tail.then(append);
    tail = result;
    return result;
  };
}
export const prepareOpeningAudit: PrepareOpeningAudit = async tx => {
  const writer = await prepareAuditWriter(tx);
  return async (auction, lots, authorId, occurredAt) => {
    const append = (action: "AUCTION_OPENED" | "LOT_OPENED", entityType: string, entityId: string, data: Prisma.InputJsonObject) => writer(action, entityType, entityId, data, authorId, occurredAt);
    const ordered = [...lots].sort((a, b) => a.id.localeCompare(b.id));
    await append("AUCTION_OPENED", "Auction", auction.id, { formatVersion: 2, status: "OPEN", lotIds: ordered.map(lot => lot.id) });
    for (const lot of ordered) await append("LOT_OPENED", "Lot", lot.id, { formatVersion: 2, auctionId: auction.id, number: lot.number, status: "OPEN" });
  };
};
