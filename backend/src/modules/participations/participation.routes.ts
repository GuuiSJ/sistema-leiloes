import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { validateQuery } from "../bids/bid.validation";
import { createParticipationRepository, type ParticipationRepository } from "./participation.repository";

export function createParticipationRouter(repository: ParticipationRepository = createParticipationRepository(), authentication: RequestHandler = authenticate) {
  const router = Router();
  router.get("/", authentication, authorize("BIDDER"), async (req, res) => {
    const { page, limit } = validateQuery(req.query);
    res.set("Cache-Control", "no-store").json(await repository.list(req.authUser!.id, page, limit));
  });
  return router;
}
