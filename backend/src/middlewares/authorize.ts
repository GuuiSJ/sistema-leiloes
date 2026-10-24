import type { RequestHandler } from "express";
import { HttpError } from "../errors/http-error";
import type { Role } from "../modules/auth/auth.types";

// Usar após authenticate, que consulta o perfil atual no banco.
export function authorize(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.authUser) throw new HttpError(401, "Autenticação necessária.");
    if (!roles.includes(req.authUser.role)) throw new HttpError(403, "Acesso não permitido para este perfil.");
    next();
  };
}
