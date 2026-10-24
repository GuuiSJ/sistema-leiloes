import { Router } from "express";
import { getAuthConfig, type AuthConfig } from "../../config/auth";
import { createAuthenticate } from "../../middlewares/authenticate";
import { authRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import type { AuthRepository } from "./auth.types";
import { validateLogin, validateRegister } from "./auth.validation";

export function createAuthRouter(repository: AuthRepository, config: () => AuthConfig): Router {
  const router = Router();
  const service = new AuthService(repository, config);

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/register", async (req, res) => {
    const user = await service.register(validateRegister(req.body as unknown));
    res.status(201).json({ user });
  });

  router.post("/login", async (req, res) => {
    const result = await service.login(validateLogin(req.body as unknown));
    res.status(200).json(result);
  });

  router.get("/me", createAuthenticate(repository, config), (req, res) => {
    res.status(200).json({ user: req.authUser });
  });

  return router;
}

export default createAuthRouter(authRepository, getAuthConfig);
