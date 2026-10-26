import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { validateId } from "../bids/bid.validation";
import { validateNoQuery } from "../wallet/wallet.validation";
import { createReceiptRepository, type ReceiptRepository } from "./receipt.repository";
import { ReceiptService } from "./receipt.service";

export function createReceiptRouter(repository: ReceiptRepository = createReceiptRepository(), authentication: RequestHandler = authenticate) {
  const router = Router({ mergeParams: true });
  const service = new ReceiptService(repository);
  router.get<{ lotId: string }>("/", authentication, async (req, res) => {
    validateNoQuery(req.query);
    const receipt = await service.get(validateId(req.params.lotId), req.authUser!.id);
    res.set("Cache-Control", "no-store").json({ receipt });
  });
  return router;
}
