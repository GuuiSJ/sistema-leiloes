import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { validateId } from "../bids/bid.validation";
import { validateNoQuery } from "../wallet/wallet.validation";
import { createReceiptRepository, createPublicReceiptRepository, type ReceiptRepository } from "./receipt.repository";
import { ReceiptService, publicReceipt } from "./receipt.service";
import { HttpError } from "../../errors/http-error";

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

export function createPublicReceiptRouter(repository = createPublicReceiptRepository()) {
  const router = Router();
  router.get<{ publicId: string }>("/:publicId", async (req, res) => {
    validateNoQuery(req.query);
    const receipt = await repository.find(validateId(req.params.publicId));
    if (!receipt) throw new HttpError(404, "Comprovante público não encontrado.");
    res.set("Cache-Control", "no-store").json({ receipt: publicReceipt(receipt) });
  });
  return router;
}
