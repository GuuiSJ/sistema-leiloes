import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { lotRepository } from "./lot.repository";
import { LotService } from "./lot.service";
import type { LotRepository } from "./lot.types";
import { validateCreate, validateDelete, validateId, validatePatch, validateQuery } from "./lot.validation";

export function createLotRouter(repository: LotRepository, authentication: RequestHandler = authenticate): Router {
  const router = Router({ mergeParams: true });
  const service = new LotService(repository);
  const auctioneer = authorize("AUCTIONEER");
  router.get<{ auctionId: string }>("/", async (req, res) => { res.json(await service.list(validateId(req.params.auctionId), validateQuery(req.query))); });
  router.get<{ auctionId: string; lotId: string }>("/:lotId", async (req, res) => { res.json({ lot: await service.findById(validateId(req.params.auctionId), validateId(req.params.lotId)) }); });
  router.post("/", authentication, auctioneer, async (req, res) => {
    res.status(201).json({ lot: await service.create(validateId(req.params.auctionId), validateCreate(req.body as unknown), req.authUser!.id) });
  });
  router.patch("/:lotId", authentication, auctioneer, async (req, res) => {
    res.json({ lot: await service.update(validateId(req.params.auctionId), validateId(req.params.lotId), validatePatch(req.body as unknown), req.authUser!.id) });
  });
  router.delete("/:lotId", authentication, auctioneer, async (req, res) => {
    validateDelete(req.body as unknown);
    await service.delete(validateId(req.params.auctionId), validateId(req.params.lotId), req.authUser!.id);
    res.status(204).end();
  });
  return router;
}
export default createLotRouter(lotRepository);
