import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import auctionRoutes from "../modules/auctions/auction.routes";
import fipeRoutes from "../modules/fipe/fipe.routes";
import vehicleRoutes from "../modules/vehicles/vehicle.routes";
import lotRoutes from "../modules/lots/lot.routes";

const routes = Router();
routes.use("/auth", authRoutes);
routes.use("/auctions/:auctionId/lots", lotRoutes);
routes.use("/auctions", auctionRoutes);
routes.use("/fipe", fipeRoutes);
routes.use("/vehicles", vehicleRoutes);

routes.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "API do Sistema de Leilões funcionando!",
  });
});

export default routes;
