import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { validateNoQuery } from "../wallet/wallet.validation";
import { validateAuctionId, validateCancellation } from "./auction.validation";
import { auctionLifecycleRepository } from "./auction-lifecycle.repository";
import { AuctionLifecycleService } from "./auction-lifecycle.service";
import type { AuctionLifecycleRepository } from "./auction-lifecycle.types";

export function createAuctionLifecycleRouter(repository: AuctionLifecycleRepository, authentication: RequestHandler = authenticate): Router {
  const router = Router();
  const service = new AuctionLifecycleService(repository);
  for (const operation of ["schedule", "open"] as const) {
    router.patch<{ id: string }>(`/:id/${operation}`, authentication, authorize("AUCTIONEER"), async (req, res) => {
      validateNoQuery(req.query);
      validateCancellation(req.body as unknown);
      res.json(await service.transition(validateAuctionId(req.params.id), operation, req.authUser!.id));
    });
  }
  return router;
}
export default createAuctionLifecycleRouter(auctionLifecycleRepository);
