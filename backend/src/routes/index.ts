import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import auctionRoutes from "../modules/auctions/auction.routes";

const routes = Router();
routes.use("/auth", authRoutes);
routes.use("/auctions", auctionRoutes);

routes.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "API do Sistema de Leilões funcionando!",
  });
});

export default routes;
