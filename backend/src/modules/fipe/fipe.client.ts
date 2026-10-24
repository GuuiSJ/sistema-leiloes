import { HttpError } from "../../errors/http-error";

export type FipeFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface FipeDiagnostic {
  category: "upstream_http" | "timeout" | "invalid_json" | "network";
  elapsedMs: number;
  upstreamStatus?: number;
  code?: string;
}

function networkCode(error: unknown): string {
  if (error instanceof Error && "cause" in error && typeof error.cause === "object" && error.cause !== null && "code" in error.cause) {
    const code = error.cause.code;
    if (typeof code === "string" && ["EACCES", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_HAS_EXPIRED"].includes(code)) return code;
  }
  return "NETWORK_ERROR";
}

export class FipeClient {
  constructor(
    private readonly request: FipeFetch = fetch,
    private readonly timeoutMs = 5000,
    private readonly report: (event: FipeDiagnostic) => void = event => console.warn("Falha na consulta à BrasilAPI FIPE.", event),
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Timeout FIPE inválido.");
  }

  async get(path: string, table?: string): Promise<unknown> {
    const startedAt = Date.now();
    const url = new URL(`https://brasilapi.com.br/api/fipe/${path}`);
    if (table !== undefined) url.searchParams.set("tabela_referencia", table);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.report({ category: "timeout", elapsedMs: Date.now() - startedAt });
        controller.abort();
        reject(new HttpError(504, "A consulta à BrasilAPI excedeu o tempo limite. Tente novamente."));
      }, this.timeoutMs);
    });

    const operation = async (): Promise<unknown> => {
      const response = await this.request(url.toString(), {
        method: "GET", headers: { Accept: "application/json" }, signal: controller.signal, redirect: "error",
      });
      if (!response.ok) {
        this.report({ category: "upstream_http", upstreamStatus: response.status, elapsedMs: Date.now() - startedAt });
        // Não repassar o corpo, os headers ou detalhes do provedor ao cliente.
        await response.body?.cancel();
        if (response.status === 400) throw new HttpError(400, "A BrasilAPI não reconheceu os códigos ou a tabela de referência informados.");
        if (response.status === 404) throw new HttpError(404, "Informação FIPE não encontrada na BrasilAPI.");
        if (response.status === 408 || response.status === 504) throw new HttpError(504, "A BrasilAPI não respondeu dentro do prazo.");
        if (response.status === 429 || response.status >= 500) throw new HttpError(503, "BrasilAPI temporariamente indisponível. Tente novamente.");
        throw new HttpError(502, "A BrasilAPI retornou uma resposta inesperada.");
      }
      try {
        return await response.json() as unknown;
      } catch (error: unknown) {
        if (controller.signal.aborted) throw error;
        if (error instanceof SyntaxError) {
          this.report({ category: "invalid_json", elapsedMs: Date.now() - startedAt });
          throw new HttpError(502, "A BrasilAPI retornou uma resposta inválida.");
        }
        throw error;
      }
    };

    try {
      return await Promise.race([operation(), timeout]);
    } catch (error: unknown) {
      if (error instanceof HttpError) throw error;
      if (controller.signal.aborted) throw new HttpError(504, "A consulta à BrasilAPI excedeu o tempo limite. Tente novamente.");
      this.report({ category: "network", code: networkCode(error), elapsedMs: Date.now() - startedAt });
      throw new HttpError(503, "Não foi possível consultar a BrasilAPI. Tente novamente.");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
