import { Router } from "express";
import { FipeService } from "./fipe.service";
import { fipeCode, positiveCode, referenceTable, vehicleType, yearCode } from "./fipe.validation";

export function createFipeRouter(service = new FipeService()): Router {
  const router = Router();
  router.get("/marcas", async (req, res) => {
    res.json(await service.brands(undefined, referenceTable(req.query)));
  });
  router.get("/marcas/:vehicleType", async (req, res) => {
    res.json(await service.brands(vehicleType(req.params.vehicleType), referenceTable(req.query)));
  });
  router.get("/modelos/:vehicleType/:makerCode", async (req, res) => {
    res.json(await service.models(vehicleType(req.params.vehicleType), positiveCode(req.params.makerCode), referenceTable(req.query)));
  });
  router.get("/anos/:vehicleType/:makerCode/:modelCode", async (req, res) => {
    res.json(await service.years(vehicleType(req.params.vehicleType), positiveCode(req.params.makerCode), positiveCode(req.params.modelCode), referenceTable(req.query)));
  });
  router.get("/preco/:fipeCode", async (req, res) => {
    res.json(await service.prices(fipeCode(req.params.fipeCode), referenceTable(req.query)));
  });
  router.get("/detalhes/:vehicleType/:makerCode/:modelCode/:yearCode", async (req, res) => {
    res.json(await service.details(vehicleType(req.params.vehicleType), positiveCode(req.params.makerCode), positiveCode(req.params.modelCode), yearCode(req.params.yearCode), referenceTable(req.query)));
  });
  router.get("/tabelas", async (req, res) => {
    referenceTable(req.query, false);
    res.json(await service.tables());
  });
  return router;
}

export default createFipeRouter();
