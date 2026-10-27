import { HttpError } from "../../errors/http-error";
import type { Prisma } from "../../generated/prisma/client";

// Transitional type: keep the generated client aligned with the unmigrated database.
export type TemporalMarker = { temporalGeneration?: unknown };
export function isOperationalAuction(auction: object): boolean {
  return (auction as TemporalMarker).temporalGeneration === "UTC_V2";
}
export function requireOperationalAuction(auction: object): void {
  if (!isOperationalAuction(auction)) throw new HttpError(409, "Leilão LEGACY ou sem geração temporal válida: operação bloqueada. Histórico disponível para consulta.");
}
// Caller holds the Auction row lock. The current ORM omits this column.
export async function readAuctionGeneration(tx: Prisma.TransactionClient, id: string): Promise<TemporalMarker> {
  const rows = await tx.$queryRaw<TemporalMarker[]>`SELECT "temporalGeneration" FROM "Auction" WHERE "id" = ${id}::uuid`;
  return { temporalGeneration: rows[0]?.temporalGeneration };
}
export function rejectClientGeneration(input: object): void {
  if ("temporalGeneration" in input) throw new HttpError(400, "A geração temporal é interna e não pode ser alterada pelo cliente.");
}
