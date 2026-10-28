import "./env";
import { HttpError } from "../errors/http-error";

export function getSimulatedCreditDiagnostics(env: NodeJS.ProcessEnv = process.env) {
  const conditions = {
    developmentEnvironment: env.NODE_ENV === "development",
    explicitlyEnabled: env.ENABLE_SIMULATED_CREDITS === "true",
    validDatabaseUrl: false,
    postgresProtocol: false,
    localDatabaseHost: false,
    demoDatabaseName: false,
    allowedDatabaseParameters: false,
    noDatabaseFragment: false,
  };
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    const parameters = [...url.searchParams.entries()];
    conditions.validDatabaseUrl = true;
    conditions.postgresProtocol = ["postgres:", "postgresql:"].includes(url.protocol);
    conditions.localDatabaseHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    conditions.demoDatabaseName = url.pathname === "/sistema_leiloes";
    // Allow only the explicit default Prisma schema; never accept host/options overrides.
    conditions.allowedDatabaseParameters = parameters.length === 0
      || (parameters.length === 1 && parameters[0][0] === "schema" && parameters[0][1] === "public");
    conditions.noDatabaseFragment = !url.hash;
  } catch { /* Do not expose connection details. */ }
  return { ...conditions, enabled: Object.values(conditions).every(Boolean) };
}

export function requireSimulatedCreditEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (!getSimulatedCreditDiagnostics(env).enabled) {
    throw new HttpError(403, "Crédito simulado desabilitado. Disponível somente no ambiente local de demonstração explicitamente habilitado.");
  }
}

// Return the cumulative ceiling only for explicitly authorized production demos.
// The existing local-only development policy remains unchanged.
export function requireSimulatedCreditAuthorization(userId?: string, env: NodeJS.ProcessEnv = process.env): string | void {
  if (env.NODE_ENV !== "production") return requireSimulatedCreditEnvironment(env);
  const ids = (env.PRODUCTION_DEMO_CREDIT_USER_IDS ?? "").split(",").map(id => id.trim().toLowerCase());
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const cap = env.PRODUCTION_DEMO_CREDIT_LIMIT ?? "";
  if (env.ENABLE_PRODUCTION_DEMO_CREDITS !== "true" || !userId || !ids.every(id => uuid.test(id))
    || !ids.includes(userId.toLowerCase()) || !/^(0|[1-9]\d{0,15})\.\d{2}$/.test(cap) || BigInt(cap.replace(".", "")) <= 0n) {
    throw new HttpError(403, "Crédito simulado de demonstração indisponível para esta conta.");
  }
  return cap;
}
