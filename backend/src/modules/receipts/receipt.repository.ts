import { getPrisma } from "../../lib/prisma";
import type { PrismaClient } from "../../generated/prisma/client";

export function createReceiptRepository(client: () => PrismaClient = getPrisma) {
  return { async find(lotId: string) {
    return client().lot.findUnique({ where: { id: lotId }, select: { auction: { select: { organizerId: true } }, receipt: true } });
  } };
}
export type ReceiptRepository = ReturnType<typeof createReceiptRepository>;

export function createPublicReceiptRepository(client: () => PrismaClient = getPrisma) {
  return { async find(publicId: string) { return client().auctionReceipt.findUnique({ where: { publicId } }); } };
}
