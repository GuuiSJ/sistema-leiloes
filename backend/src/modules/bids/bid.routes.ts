import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { bidRepository } from "./bid.repository";
import { BidService } from "./bid.service";
import type { BidRepository } from "./bid.types";
import { validateCreate, validateId, validateKey, validateNoQuery, validateQuery } from "./bid.validation";
import type { BidEventBus } from "../../realtime/bid-events";

export function createBidRouter(repository: BidRepository, authentication: RequestHandler = authenticate, events?: Pick<BidEventBus, "publish">): Router {
  const router = Router({ mergeParams: true });
  const service = new BidService(repository, events);
  router.get<{ lotId: string }>("/", async (req, res) => { res.json(await service.list(validateId(req.params.lotId), validateQuery(req.query))); });
  router.post<{ lotId: string }>("/", authentication, authorize("BIDDER"), async (req, res) => {
    validateNoQuery(req.query);
    const result = await service.place(validateId(req.params.lotId), req.authUser!.id, validateCreate(req.body as unknown), validateKey(req.get("Idempotency-Key")));
    res.status(result.replayed ? 200 : 201).json(result);
  });
  return router;
}
export default createBidRouter(bidRepository);
