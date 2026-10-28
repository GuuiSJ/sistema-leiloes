import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { validateId, validateNoQuery, validateQuery } from "../bids/bid.validation";
import { createLiveRoomRepository } from "./live-room.repository";

export function createLiveRoomRouter(repository = createLiveRoomRepository(), authentication: RequestHandler = authenticate) {
  const router = Router();
  router.get<{ lotId: string }>("/lots/:lotId/clock", async (req, res) => {
    validateNoQuery(req.query);
    res.set("Cache-Control", "no-store").json(await repository.clock(validateId(req.params.lotId)));
  });
  router.get<{ lotId: string }>("/lots/:lotId/position", authentication, authorize("BIDDER"), async (req, res) => {
    validateNoQuery(req.query);
    res.set("Cache-Control", "no-store").json(await repository.position(validateId(req.params.lotId), req.authUser!.id));
  });
  router.get("/me/lot-results", authentication, authorize("AUCTIONEER"), async (req, res) => {
    const { auctionId: rawId, ...pagination } = req.query;
    const auctionId = rawId === undefined ? undefined : validateId(rawId);
    const { page, limit } = validateQuery(pagination);
    res.set("Cache-Control", "no-store").json(await repository.results(req.authUser!.id, page, limit, auctionId));
  });
  return router;
}
