import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { AuthConfig } from "../../config/auth";

const issuer = "sistema-leiloes";
const audience = "sistema-leiloes:api";

export function signAccessToken(userId: string, config: AuthConfig): string {
  return jwt.sign({}, config.secret, {
    algorithm: "HS256",
    subject: userId,
    issuer,
    audience,
    jwtid: randomUUID(),
    expiresIn: config.expiresInSeconds,
  });
}

export function verifyAccessToken(token: string, config: AuthConfig): string {
  const payload = jwt.verify(token, config.secret, { algorithms: ["HS256"], issuer, audience });
  if (
    typeof payload === "string" ||
    typeof payload.sub !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) ||
    typeof payload.exp !== "number" ||
    !Number.isSafeInteger(payload.exp)
  ) {
    throw new Error("Payload JWT inválido.");
  }
  return payload.sub;
}
