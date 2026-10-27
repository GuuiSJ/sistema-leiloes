import "./env";

export type TemporalMode = "LEGACY" | "UTC_V2";
export function temporalMode(env: { AUCTION_TEMPORAL_MODE?: string } = process.env): TemporalMode {
  const value = env.AUCTION_TEMPORAL_MODE ?? "LEGACY";
  if (value !== "LEGACY" && value !== "UTC_V2") throw new Error("AUCTION_TEMPORAL_MODE deve ser LEGACY ou UTC_V2.");
  return value;
}

// pg gives connection-string parameters precedence over PoolConfig, including options.
// Do not allow URL options to silently defeat the UTC startup parameter.
export function temporalPoolConfig(connectionString: string, mode: TemporalMode) {
  if (mode === "UTC_V2") {
    let url: URL;
    try { url = new URL(connectionString); } catch { throw new Error("Configuração de conexão temporal inválida."); }
    if ([...url.searchParams.keys()].some(key => ["options", "timezone", "tz"].includes(key.toLowerCase()))) {
      throw new Error("Modo UTC_V2 exige URL sem opções de fuso ou opções de sessão.");
    }
  }
  return { connectionString, connectionTimeoutMillis: 5000, ...(mode === "UTC_V2" ? { options: "-c timezone=UTC" } : {}) };
}
