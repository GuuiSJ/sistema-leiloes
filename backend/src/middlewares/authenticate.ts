import type { RequestHandler } from "express";
import { getAuthConfig, type AuthConfig } from "../config/auth";
import { HttpError } from "../errors/http-error";
import { authRepository } from "../modules/auth/auth.repository";
import type { AuthRepository } from "../modules/auth/auth.types";
import { verifyAccessToken } from "../modules/auth/auth.tokens";

export function createAuthenticate(
  repository: AuthRepository,
  config: () => AuthConfig,
): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get("Authorization");
    const match = header?.match(/^Bearer ([^\s]+)$/i);
    if (!match) throw new HttpError(401, "Token ausente ou inválido.");

    const authConfig = config();
    let userId: string;
    try {
      userId = verifyAccessToken(match[1]!, authConfig);
    } catch {
      throw new HttpError(401, "Token inválido ou expirado.");
    }

    // Nunca usar um papel do token como fonte de autorização.
    const user = await repository.findPublicById(userId);
    if (!user) throw new HttpError(401, "Token inválido ou expirado.");
    req.authUser = user;
    next();
  };
}

export const authenticate = createAuthenticate(authRepository, getAuthConfig);
