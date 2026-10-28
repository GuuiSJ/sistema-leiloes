import { Router } from "express";
import type { AuditEvent, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../lib/prisma";
import { HttpError } from "../../errors/http-error";
import { validateId, validateQuery } from "../bids/bid.validation";
import { loadAuditChain, verifyOpeningAuditChain } from "./opening-audit";

export function auditResult(events: AuditEvent[], lotId: string, auctionId: string, page: number, limit: number) {
  const checkedAt = new Date();
  let valid = false;
  try { verifyOpeningAuditChain(events); valid = true; }
  catch (error) { if (!(error instanceof HttpError && error.status === 409)) throw error; }
  // Never expose unvalidated payloads or author references, including on failure.
  const related = valid ? events.filter(event => (event.entityType === "Lot" && event.entityId === lotId) || (event.entityType === "Auction" && event.entityId === auctionId)) : [];
  const status = !valid ? "INVALID" : related.length ? "VALID" : "UNAVAILABLE";
  return {
    lotId,
    integrity: { status, scope: "GLOBAL_EVENT_CHAIN", checkedAt, eventsChecked: events.length },
    data: related.slice((page - 1) * limit, page * limit).map(event => ({
      id: event.id, sequence: event.sequence.toString(), action: event.action,
      entityType: event.entityType, entityId: event.entityId, occurredAt: event.occurredAt,
      previousHash: event.previousHash, currentHash: event.currentHash,
    })),
    pagination: { page, limit, total: related.length, totalPages: Math.ceil(related.length / limit) },
  };
}
export function createPublicAuditRepository(client: () => PrismaClient = getPrisma) {
  return { async get(lotId: string, page: number, limit: number) {
    return client().$transaction(async tx => {
      const lot = await tx.lot.findUnique({ where: { id: lotId }, select: { auctionId: true } });
      if (!lot) throw new HttpError(404, "Lote não encontrado.");
      return auditResult(await loadAuditChain(tx), lotId, lot.auctionId, page, limit);
    }, { isolationLevel: "RepeatableRead" });
  } };
}
export function createPublicAuditRouter(repository = createPublicAuditRepository()) {
  const router = Router({ mergeParams: true });
  router.get<{ lotId: string }>("/", async (req, res) => {
    const { page, limit } = validateQuery(req.query);
    res.set("Cache-Control", "no-store").json(await repository.get(validateId(req.params.lotId), page, limit));
  });
  return router;
}
