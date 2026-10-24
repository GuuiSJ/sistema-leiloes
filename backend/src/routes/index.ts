import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import auctionRoutes from "../modules/auctions/auction.routes";
import fipeRoutes from "../modules/fipe/fipe.routes";

const routes = Router();
routes.use("/auth", authRoutes);
routes.use("/auctions", auctionRoutes);
routes.use("/fipe", fipeRoutes);

routes.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "API do Sistema de Leilões funcionando!",
  });
});

export default routes;
