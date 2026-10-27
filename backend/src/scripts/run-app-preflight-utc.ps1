$ErrorActionPreference = 'Stop'
$appPreflightSavedUrl = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')
$appPreflightSavedMode = [Environment]::GetEnvironmentVariable('AUCTION_TEMPORAL_MODE', 'Process')
$appPreflightExit = 1

try {
    # Ignore an inherited administrative URL; dotenv must load the application's URL.
    [Environment]::SetEnvironmentVariable('DATABASE_URL', $null, 'Process')
    [Environment]::SetEnvironmentVariable('AUCTION_TEMPORAL_MODE', 'UTC_V2', 'Process')
    Push-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
    try {
        @'
let client;
let runtime;
let stage = "BUILD_LOAD";
(async () => {
  try {
    // Only compiled modules: never import server.js or the worker entry point.
    require("./dist/config/env");
    const { temporalMode, temporalPoolConfig } = require("./dist/config/temporal");
    const { TemporalRuntime } = require("./dist/modules/temporal/temporal-runtime");
    const { PrismaClient } = require("./dist/generated/prisma/client");
    const { PrismaPg } = require("@prisma/adapter-pg");
    stage = "APPLICATION_CONFIGURATION";
    const url = new URL(process.env.DATABASE_URL || "");
    if (temporalMode() !== "UTC_V2" ||
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        decodeURIComponent(url.pathname.slice(1)) !== "sistema_leiloes" ||
        decodeURIComponent(url.username) !== "leiloes_app" ||
        [...url.searchParams.keys()].some(key => !["schema", "sslmode", "sslcert", "sslkey", "sslrootcert"].includes(key)) ||
        (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public")) {
      throw new Error("INVALID_APPLICATION_CONFIGURATION");
    }
    const config = temporalPoolConfig(url.toString(), "UTC_V2");
    // Same build preflight, with a dedicated pool enforcing READ ONLY on every session.
    // No application singleton is activated and no HTTP/worker module is loaded.
    client = new PrismaClient({ adapter: new PrismaPg({ ...config,
      options: config.options + " -c default_transaction_read_only=on", max: 2 }),
      log: [], errorFormat: "minimal" });
    stage = "DATABASE_IDENTITY";
    const [identity] = await client.$queryRawUnsafe(
      "SELECT current_database() AS database, session_user AS role, current_setting('TimeZone') AS timezone, current_setting('transaction_read_only') AS readonly"
    );
    if (!identity || identity.database !== "sistema_leiloes" || identity.role !== "leiloes_app" ||
        identity.timezone !== "UTC" || identity.readonly !== "on") throw new Error("INVALID_CONNECTION");
    stage = "UTC_PREFLIGHT_AND_AUDIT";
    runtime = new TemporalRuntime("UTC_V2");
    await runtime.verify(client);
    const events = await client.auditEvent.count();
    // Do not announce success until disconnect also succeeds.
    runtime.reset();
    await client.$disconnect();
    client = undefined;
    console.log(JSON.stringify({ complete: true, database: identity.database, role: identity.role,
      mode: "UTC_V2", timezone: identity.timezone, readOnly: true, preflightPassed: true,
      auditChainVerified: true, auditEvents: events, httpStarted: false, workerStarted: false,
      applicationActivated: false }));
  } catch (error) {
    // Never print a URI, password, driver error, query, payload or audit hash.
    const { TemporalStartupError } = (() => {
      try { return require("./dist/modules/temporal/temporal-runtime"); } catch { return {}; }
    })();
    console.error(JSON.stringify({ complete: false, stage,
      code: TemporalStartupError && error instanceof TemporalStartupError ? error.code : "APP_PREFLIGHT_FAILED",
      httpStarted: false, workerStarted: false }));
    process.exitCode = 1;
  } finally {
    runtime?.reset();
    if (client) {
      try { await client.$disconnect(); }
      catch { process.exitCode = 1; console.error("Falha ao encerrar a conexao de verificacao."); }
    }
  }
})();
'@ | & node -
        $appPreflightExit = $LASTEXITCODE
        if ($appPreflightExit -ne 0) { throw 'Preflight recusado. Nao iniciar o backend ou worker.' }
    } finally { Pop-Location }
} finally {
    [Environment]::SetEnvironmentVariable('DATABASE_URL', $appPreflightSavedUrl, 'Process')
    [Environment]::SetEnvironmentVariable('AUCTION_TEMPORAL_MODE', $appPreflightSavedMode, 'Process')
    Remove-Variable appPreflightSavedUrl,appPreflightSavedMode -ErrorAction SilentlyContinue
}
exit $appPreflightExit
