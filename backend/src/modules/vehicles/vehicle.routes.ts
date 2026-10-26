import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { HttpError } from "../../errors/http-error";
import { vehicleRepository } from "./vehicle.repository";
import { VehicleService } from "./vehicle.service";
import type { VehicleRepository } from "./vehicle.types";
import { validateCreate, validatePatch, validateQuery, validateVehicleId } from "./vehicle.validation";

export function createVehicleRouter(repository: VehicleRepository, authentication: RequestHandler = authenticate): Router {
  const router = Router();
  const service = new VehicleService(repository);
  const auctioneer = authorize("AUCTIONEER");
  router.get("/", async (req, res) => { res.json(await service.list(validateQuery(req.query))); });
  router.get("/:id", async (req, res) => { res.json({ vehicle: await service.findById(validateVehicleId(req.params.id)) }); });
  router.post("/", authentication, auctioneer, async (req, res) => {
    res.status(201).json({ vehicle: await service.create(validateCreate(req.body as unknown), req.authUser!.id) });
  });
  router.patch("/:id", authentication, auctioneer, async (req, res) => {
    res.json({ vehicle: await service.update(validateVehicleId(req.params.id), validatePatch(req.body as unknown), req.authUser!.id) });
  });
  router.delete("/:id", authentication, auctioneer, async (req, res) => {
    // Não aceitar payloads que sugiram exclusão em cascata ou alteração de IDs.
    if (req.body !== undefined) throw new HttpError(400, "DELETE não aceita corpo.");
    await service.delete(validateVehicleId(req.params.id), req.authUser!.id);
    res.status(204).end();
  });
  return router;
}
export default createVehicleRouter(vehicleRepository);
