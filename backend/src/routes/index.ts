import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";

const routes = Router();
routes.use("/auth", authRoutes);

routes.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "API do Sistema de Leilões funcionando!",
  });
});

export default routes;
