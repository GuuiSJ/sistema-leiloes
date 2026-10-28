import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireSimulatedCreditAuthorization } from "../../config/wallet";
import { walletRepository } from "./wallet.repository";
import { WalletService } from "./wallet.service";
import type { WalletRepository } from "./wallet.types";
import { validateCredit, validateKey, validateNoQuery, validateQuery } from "./wallet.validation";

export function createWalletRouter(repository: WalletRepository, authentication: RequestHandler = authenticate, requireDemo: (userId?: string) => string | void = requireSimulatedCreditAuthorization): Router {
  const router = Router();
  const service = new WalletService(repository, requireDemo);
  router.use(authentication, authorize("BIDDER"));
  router.get("/credit-capability", (req, res) => {
    validateNoQuery(req.query);
    res.set("Cache-Control", "no-store").json(service.capability(req.authUser!.id));
  });
  router.get("/", async (req, res) => {
    validateNoQuery(req.query);
    res.json({ wallet: await service.get(req.authUser!.id) });
  });
  router.post("/credit", async (req, res) => {
    requireDemo(req.authUser!.id);
    validateNoQuery(req.query);
    const result = await service.credit(req.authUser!.id, validateCredit(req.body as unknown), validateKey(req.get("Idempotency-Key")));
    res.status(result.replayed ? 200 : 201).json(result);
  });
  router.get("/transactions", async (req, res) => { res.json(await service.transactions(req.authUser!.id, validateQuery(req.query))); });
  return router;
}
export default createWalletRouter(walletRepository);
