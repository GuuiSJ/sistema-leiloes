import "./env";

export interface AuthConfig {
  secret: string;
  expiresInSeconds: number;
}

export function getAuthConfig(): AuthConfig {
  const secret = process.env.JWT_SECRET;
  const rawExpiration = process.env.JWT_EXPIRES_IN ?? "3600";
  const expiresInSeconds = Number(rawExpiration);

  if (!secret || Buffer.byteLength(secret.trim(), "utf8") < 32) {
    throw new Error("Configure JWT_SECRET com pelo menos 32 bytes aleatórios.");
  }

  if (!/^\d+$/.test(rawExpiration) || !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("JWT_EXPIRES_IN deve ser um inteiro positivo em segundos.");
  }

  return { secret, expiresInSeconds };
}
