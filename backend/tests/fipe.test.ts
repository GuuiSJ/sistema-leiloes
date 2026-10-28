import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { FipeClient, type FipeFetch, type FipeDiagnostic } from "../src/modules/fipe/fipe.client";
import { createFipeRouter } from "../src/modules/fipe/fipe.routes";
import { FipeService } from "../src/modules/fipe/fipe.service";
import { errorHandler } from "../src/middlewares/error-handler";
import { notFound } from "../src/middlewares/not-found";

const samplePrice = {
  valor: "R$ 6.022,00", marca: "Fiat", modelo: "Palio EX 1.0 mpi 2p", anoModelo: 1998,
  combustivel: "Álcool", codigoFipe: "001004-9", mesReferencia: "junho de 2021 ",
  tipoVeiculo: 1, siglaCombustivel: "Á", dataConsulta: "segunda-feira, 7 de junho de 2021 23:05",
};

describe("Consultas FIPE HTTP (BrasilAPI simulada, sem banco)", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const diagnostics: FipeDiagnostic[] = [];
  let handler: FipeFetch;
  let server: Server;
  let base: string;
  const json = (value: unknown, status = 200) => Response.json(value, { status });

  before(async () => {
    const request: FipeFetch = async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    };
    const app = express();
    app.use("/api/fipe", createFipeRouter(new FipeService(new FipeClient(request, 100, event => diagnostics.push(event)))));
    app.use(notFound);
    app.use(errorHandler);
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
      server.once("error", reject);
    });
    const address = server.address();
    assert(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}/api/fipe`;
  });
  beforeEach(() => {
    calls.length = 0;
    diagnostics.length = 0;
    handler = async () => json([]);
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const get = (path: string) => fetch(`${base}${path}`);

  it("lista marcas por tipo e sem tipo, preservando zeros dos códigos", async () => {
    handler = async () => json([{ nome: "AGRALE", valor: "102", campoInterno: "não repassar" }]);
    for (const path of ["/marcas", "/marcas/carros", "/marcas/motos", "/marcas/caminhoes"]) {
      const response = await get(path);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), [{ nome: "AGRALE", valor: "102" }]);
    }
    assert.equal(calls[0]!.url, "https://brasilapi.com.br/api/fipe/marcas/v1");
    assert.equal(calls[1]!.url, "https://brasilapi.com.br/api/fipe/marcas/v1/carros");
  });

  it("aceita código numérico de marca conforme o schema oficial e normaliza para string", async () => {
    handler = async () => json([{ nome: "AGRALE", valor: 102 }]);
    assert.deepEqual(await (await get("/marcas/carros")).json(), [{ nome: "AGRALE", valor: "102" }]);
  });

  it("consulta modelos pela rota externa veiculos e encaminha tabela_referencia", async () => {
    handler = async () => json([{ modelo: "Palio EX", valor: "123" }]);
    const response = await get("/modelos/carros/21?tabela_referencia=271");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ modelo: "Palio EX", valor: "123" }]);
    assert.equal(calls[0]!.url, "https://brasilapi.com.br/api/fipe/veiculos/v1/carros/21?tabela_referencia=271");
  });

  it("consulta anos e preserva o código composto de ano/combustível", async () => {
    handler = async () => json([{ nome: "1998 Gasolina", valor: "1998-1" }, { nome: "Zero KM Gasolina", valor: "32000-1" }]);
    const response = await get("/anos/carros/21/123");
    assert.equal(response.status, 200);
    assert.equal((await response.json())[1].valor, "32000-1");
    assert.equal(calls[0]!.url, "https://brasilapi.com.br/api/fipe/anos/v1/carros/21/123");
  });

  it("consulta preço por código, mantém lista e valor monetário textual", async () => {
    handler = async () => json([{ ...samplePrice, campoInterno: "não repassar" }]);
    const response = await get("/preco/001004-9?tabela_referencia=271");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [samplePrice]);
    assert.equal(calls[0]!.url, "https://brasilapi.com.br/api/fipe/preco/v1/001004-9?tabela_referencia=271");
  });

  it("consulta detalhes pela hierarquia e retorna objeto", async () => {
    handler = async () => json(samplePrice);
    const response = await get("/detalhes/carros/21/123/1998-1");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), samplePrice);
    assert.equal(calls[0]!.url, "https://brasilapi.com.br/api/fipe/detalhes/v1/carros/21/123/1998-1");
  });

  it("aceita detalhes e preços sem dataConsulta e omite o metadado sem fabricar uma data", async () => {
    const { dataConsulta: _date, ...withoutDate } = samplePrice;
    for (const path of ["/detalhes/carros/21/123/1998-1", "/preco/001004-9"]) {
      const body = path.startsWith("/preco/") ? [withoutDate] : withoutDate;
      handler = async () => json(body);
      const response = await get(path);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.deepEqual(result, body);
      assert.equal(Object.hasOwn(Array.isArray(result) ? result[0] : result, "dataConsulta"), false);
    }
  });

  it("continua rejeitando dataConsulta presente com tipo inválido ou texto vazio", async () => {
    for (const dataConsulta of [null, 123, true, {}, [], "", "   "]) {
      for (const path of ["/detalhes/carros/21/123/1998-1", "/preco/001004-9"]) {
        const value = { ...samplePrice, dataConsulta };
        handler = async () => json(path.startsWith("/preco/") ? [value] : value);
        assert.equal((await get(path)).status, 502);
      }
    }
  });

  it("continua exigindo todos os campos essenciais mesmo sem dataConsulta", async () => {
    const { dataConsulta: _date, ...withoutDate } = samplePrice;
    for (const field of Object.keys(withoutDate)) {
      for (const invalid of [undefined, null, typeof withoutDate[field as keyof typeof withoutDate] === "number" ? "1" : 1]) {
        const value = { ...withoutDate, [field]: invalid };
        for (const path of ["/detalhes/carros/21/123/1998-1", "/preco/001004-9"]) {
          handler = async () => json(path.startsWith("/preco/") ? [value] : value);
          assert.equal((await get(path)).status, 502, `${path}: ${field} = ${String(invalid)}`);
        }
      }
    }
  });

  it("lista tabelas de referência", async () => {
    handler = async () => json([{ codigo: 271, mes: "junho/2021 " }]);
    assert.deepEqual(await (await get("/tabelas")).json(), [{ codigo: 271, mes: "junho/2021 " }]);
    assert.equal(calls[0]!.url, "https://brasilapi.com.br/api/fipe/tabelas/v1");
  });

  it("permite listas vazias sem fabricar dados", async () => {
    for (const path of ["/marcas/carros", "/modelos/carros/21", "/anos/carros/21/123", "/preco/001004-9", "/tabelas"]) {
      const response = await get(path);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), []);
    }
  });

  it("rejeita parâmetros inválidos antes de acessar o provedor", async () => {
    for (const path of ["/marcas/aviao", "/marcas/CARROS", "/modelos/carros/abc", "/modelos/carros/0", "/modelos/carros/-1", "/anos/carros/21/1.5", "/anos/carros/21/999999999999999999999", "/preco/0010049", "/preco/001004-99", "/detalhes/carros/21/123/1998", "/detalhes/carros/21/123/1998-0", "/marcas/carros?tabela_referencia=0", "/marcas/carros?tabela_referencia=abc", "/marcas/carros?tabela_referencia=1&tabela_referencia=2", "/marcas/carros?url=http://indevido", "/tabelas?tabela_referencia=271"]) {
      assert.equal((await get(path)).status, 400, path);
    }
    assert.equal(calls.length, 0);
  });

  it("não encaminha Authorization nem outros headers do cliente", async () => {
    const response = await fetch(`${base}/marcas/carros`, { headers: { Authorization: "Bearer valor-simulado", "X-Private": "nao-encaminhar" } });
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0]!.init.headers, { Accept: "application/json" });
    assert.equal(calls[0]!.init.method, "GET");
    assert.equal(calls[0]!.init.redirect, "error");
  });

  it("mapeia HTTP 400 e 404 sem expor corpo externo", async () => {
    for (const status of [400, 404]) {
      handler = async () => json({ message: "detalhe-interno-nao-publicar" }, status);
      const response = await get("/preco/001004-9");
      assert.equal(response.status, status);
      assert(!(await response.text()).includes("detalhe-interno-nao-publicar"));
    }
  });

  it("mapeia indisponibilidade e limite de requisições para 503", async () => {
    for (const status of [429, 500, 502, 503]) {
      handler = async () => json({ message: "detalhe-interno" }, status);
      const response = await get("/marcas/carros");
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { message: "BrasilAPI temporariamente indisponível. Tente novamente." });
    }
  });

  it("mapeia falha de rede para 503 sem vazar detalhes", async () => {
    handler = async () => { throw new Error("detalhe-interno-de-rede"); };
    const response = await get("/marcas/carros");
    assert.equal(response.status, 503);
    assert(!(await response.text()).includes("detalhe-interno"));
  });

  it("trata status externos inesperados como 502", async () => {
    handler = async () => json({}, 403);
    assert.equal((await get("/marcas/carros")).status, 502);
  });

  it("mapeia timeout informado pelo provedor para 504", async () => {
    for (const status of [408, 504]) {
      handler = async () => json({}, status);
      assert.equal((await get("/marcas/carros")).status, 504);
    }
  });

  it("aplica timeout e aborta a chamada pendente", async () => {
    let signal: AbortSignal | undefined;
    handler = async (_url, init) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    };
    const response = await get("/marcas/carros");
    assert.equal(response.status, 504);
    assert.equal(signal?.aborted, true);
  });

  it("o timeout também cobre a leitura do body", async () => {
    handler = async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener("abort", () => controller.error(new Error("abortado")), { once: true });
      },
    }));
    assert.equal((await get("/marcas/carros")).status, 504);
  });

  it("trata JSON inválido como 502", async () => {
    handler = async () => new Response("<html>indisponivel</html>");
    assert.equal((await get("/marcas/carros")).status, 502);
  });

  it("rejeita contratos externos inválidos em todas as consultas", async () => {
    for (const [path, body] of [
      ["/marcas/carros", {}], ["/marcas/carros", [{ nome: "Marca" }]],
      ["/modelos/carros/21", [{ nome: "Campo incorreto", valor: "1" }]],
      ["/anos/carros/21/123", [{ nome: "Ano", valor: "invalido" }]],
      ["/tabelas", [{ codigo: "271", mes: "junho/2021" }]],
      ["/preco/001004-9", samplePrice], ["/preco/001004-9", [{ ...samplePrice, valor: 6022 }]],
      ["/preco/001004-9", [{ ...samplePrice, codigoFipe: "000000-0" }]],
      ["/detalhes/carros/21/123/1998-1", [samplePrice]],
      ["/detalhes/carros/21/123/1998-1", { ...samplePrice, anoModelo: "1998" }],
    ] as const) {
      handler = async () => json(body);
      assert.equal((await get(path)).status, 502, path);
    }
  });

  it("rejeita configuração inválida do timeout", () => {
    assert.throws(() => new FipeClient(fetch, 0));
    assert.throws(() => new FipeClient(fetch, -1));
  });

  it("registra o status externo exato sem expor corpo ou headers do provedor", async () => {
    handler = async () => json({ message: "segredo-simulado" }, 502);
    const response = await get("/marcas/carros");
    assert.equal(response.status, 503);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]!.category, "upstream_http");
    assert.equal(diagnostics[0]!.upstreamStatus, 502);
    assert.equal(typeof diagnostics[0]!.elapsedMs, "number");
    assert(!JSON.stringify(diagnostics).includes("segredo-simulado"));
    assert(!(await response.text()).includes("502"));
  });

  it("registra somente código de rede permitido, sem mensagem interna", async () => {
    handler = async () => { throw new TypeError("segredo-simulado", { cause: { code: "EACCES", address: "endereco-privado" } }); };
    assert.equal((await get("/marcas/carros")).status, 503);
    assert.equal(diagnostics[0]!.category, "network");
    assert.equal(diagnostics[0]!.code, "EACCES");
    assert(!JSON.stringify(diagnostics).includes("segredo-simulado"));
    assert(!JSON.stringify(diagnostics).includes("endereco-privado"));
    diagnostics.length = 0;
    handler = async () => { throw new Error("segredo-simulado", { cause: { code: "codigo-nao-permitido" } }); };
    assert.equal((await get("/marcas/carros")).status, 503);
    assert.equal(diagnostics[0]!.code, "NETWORK_ERROR");
  });
});
