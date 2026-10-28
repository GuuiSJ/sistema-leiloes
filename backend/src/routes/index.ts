import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import auctionRoutes from "../modules/auctions/auction.routes";
import fipeRoutes from "../modules/fipe/fipe.routes";
import vehicleRoutes from "../modules/vehicles/vehicle.routes";
import lotRoutes from "../modules/lots/lot.routes";
import walletRoutes from "../modules/wallet/wallet.routes";
import bidRoutes from "../modules/bids/bid.routes";
import auctionLifecycleRoutes from "../modules/auctions/auction-lifecycle.routes";
import { createReceiptRouter, createPublicReceiptRouter } from "../modules/receipts/receipt.routes";
import { createParticipationRouter } from "../modules/participations/participation.routes";
import { createPublicAuditRouter } from "../modules/audit/public-audit";
import { createLiveRoomRouter } from "../modules/lots/live-room.routes";

const routes = Router();
routes.use("/auth", authRoutes);
routes.use("/auctions/:auctionId/lots", lotRoutes);
routes.use("/auctions", auctionRoutes);
routes.use("/auctions", auctionLifecycleRoutes);
routes.use("/fipe", fipeRoutes);
routes.use("/vehicles", vehicleRoutes);
routes.use("/wallet", walletRoutes);
routes.use("/lots/:lotId/bids", bidRoutes);
routes.use("/lots/:lotId/receipt", createReceiptRouter());
routes.use("/me/participations", createParticipationRouter());
routes.use("/receipts", createPublicReceiptRouter());
routes.use("/lots/:lotId/audit", createPublicAuditRouter());
routes.use(createLiveRoomRouter());

routes.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "API do Sistema de Leilões funcionando!",
  });
});

export default routes;
