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
function validatePublicData(event: Pick<AuditEvent, "action" | "entityType" | "entityId" | "publicData">): void {
  if (!uuid.test(event.entityId) || !event.publicData || typeof event.publicData !== "object" || Array.isArray(event.publicData)) invalid();
  const data = event.publicData as Record<string, unknown>;
  if (data.formatVersion !== 1 || data.status !== "OPEN") invalid();
  if (event.action === "AUCTION_OPENED" && event.entityType === "Auction") {
    if (Object.keys(data).sort().join(",") !== "formatVersion,lotIds,status" || !Array.isArray(data.lotIds) || !data.lotIds.length || data.lotIds.some(id => typeof id !== "string" || !uuid.test(id))) invalid();
    if (new Set(data.lotIds).size !== data.lotIds.length || [...data.lotIds].sort().join(",") !== data.lotIds.join(",")) invalid();
  } else if (event.action === "LOT_OPENED" && event.entityType === "Lot") {
    if (Object.keys(data).sort().join(",") !== "auctionId,formatVersion,number,status" || typeof data.auctionId !== "string" || !uuid.test(data.auctionId) || !Number.isInteger(data.number) || (data.number as number) < 1) invalid();
  } else invalid();
}
export function openingAuditHash(event: Pick<AuditEvent, "id" | "sequence" | "action" | "entityType" | "entityId" | "occurredAt" | "publicData" | "previousHash">): string {
  validatePublicData(event);
  return createHash("sha256").update(canonical({
    formatVersion: 1, id: event.id, sequence: event.sequence.toString(), action: event.action,
    entityType: event.entityType, entityId: event.entityId, occurredAt: event.occurredAt.toISOString(),
    publicData: event.publicData, previousHash: event.previousHash,
  }), "utf8").digest("hex");
}
export function verifyOpeningAuditChain(events: AuditEvent[]): string | null {
  let previousHash: string | null = null, previousSequence = 0n;
  for (const event of events) {
    if (event.sequence <= previousSequence || event.previousHash !== previousHash || !/^[0-9a-f]{64}$/.test(event.currentHash) || event.currentHash !== openingAuditHash(event)) invalid();
    previousHash = event.currentHash; previousSequence = event.sequence;
  }
  return previousHash;
}

export const prepareOpeningAudit: PrepareOpeningAudit = async tx => {
  // A global table lock covers even an empty chain and blocks non-cooperating inserts.
  // Caller must use Serializable + retries: a waiter may hold an older snapshot.
  await tx.$executeRaw`LOCK TABLE "AuditEvent" IN SHARE ROW EXCLUSIVE MODE`;
  const existing = await tx.auditEvent.findMany({ orderBy: { sequence: "asc" } });
  let previousHash = verifyOpeningAuditChain(existing);
  return async (auction, lots, authorId, occurredAt) => {
    const append = async (action: "AUCTION_OPENED" | "LOT_OPENED", entityType: string, entityId: string, publicData: Prisma.InputJsonObject) => {
      const [allocated] = await tx.$queryRaw<{ sequence: bigint }[]>`SELECT nextval(pg_get_serial_sequence('"AuditEvent"', 'sequence'))::bigint AS "sequence"`;
      const event = { id: randomUUID(), sequence: allocated.sequence, authorId, action, entityType, entityId, occurredAt, publicData, previousHash };
      const currentHash = openingAuditHash({ ...event, publicData: publicData as Prisma.JsonObject });
      await tx.auditEvent.create({ data: { ...event, currentHash } });
      previousHash = currentHash;
    };
    const ordered = [...lots].sort((a, b) => a.id.localeCompare(b.id));
    await append("AUCTION_OPENED", "Auction", auction.id, { formatVersion: 1, status: "OPEN", lotIds: ordered.map(lot => lot.id) });
    for (const lot of ordered) await append("LOT_OPENED", "Lot", lot.id, { formatVersion: 1, auctionId: auction.id, number: lot.number, status: "OPEN" });
  };
};
