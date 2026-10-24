import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { auctionRepository } from "./auction.repository";
import { AuctionService } from "./auction.service";
import type { AuctionRepository } from "./auction.types";
import { validateAuctionId, validateCancellation, validateCreate, validatePatch, validateQuery } from "./auction.validation";

export function createAuctionRouter(repository: AuctionRepository, authentication: RequestHandler = authenticate): Router {
  const router = Router();
  const service = new AuctionService(repository);
  const auctioneer = authorize("AUCTIONEER");

  router.get("/", async (req, res) => {
    res.status(200).json(await service.list(validateQuery(req.query)));
  });
  router.get("/:id", async (req, res) => {
    res.status(200).json({ auction: await service.findById(validateAuctionId(req.params.id)) });
  });
  router.post("/", authentication, auctioneer, async (req, res) => {
    const auction = await service.create(validateCreate(req.body as unknown), req.authUser!.id);
    res.status(201).json({ auction });
  });
  router.patch("/:id", authentication, auctioneer, async (req, res) => {
    const auction = await service.update(validateAuctionId(req.params.id), validatePatch(req.body as unknown), req.authUser!.id);
    res.status(200).json({ auction });
  });
  router.patch("/:id/cancel", authentication, auctioneer, async (req, res) => {
    validateCancellation(req.body as unknown);
    const auction = await service.cancel(validateAuctionId(req.params.id), req.authUser!.id);
    res.status(200).json({ auction });
  });
  return router;
}

export default createAuctionRouter(auctionRepository);
