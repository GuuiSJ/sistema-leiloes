import { HttpError } from "../../errors/http-error";
import { FipeClient } from "./fipe.client";
import type { VehicleType } from "./fipe.validation";

function invalid(): never {
  throw new HttpError(502, "A BrasilAPI retornou dados FIPE em formato inválido.");
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : invalid();
}
function integer(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : invalid();
}
function code(value: unknown): string {
  // O OpenAPI declara integer para marcas, mas seus exemplos/implementação usam string.
  if (typeof value === "number") return String(integer(value));
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : invalid();
}
function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(parse) : invalid();
}
function price(value: unknown) {
  const item = object(value);
  const codigoFipe = text(item.codigoFipe);
  const valor = text(item.valor);
  const tipoVeiculo = integer(item.tipoVeiculo);
  if (!/^\d{6}-\d$/.test(codigoFipe) || !/^R\$\s*\d[\d.]*,\d{2}$/.test(valor) || ![1, 2, 3].includes(tipoVeiculo)) return invalid();
  return {
    valor, marca: text(item.marca), modelo: text(item.modelo), anoModelo: integer(item.anoModelo),
    combustivel: text(item.combustivel), codigoFipe, mesReferencia: text(item.mesReferencia), tipoVeiculo,
    siglaCombustivel: text(item.siglaCombustivel),
    // A BrasilAPI pode omitir este metadado. Quando presente, continua validado.
    ...(item.dataConsulta === undefined ? {} : { dataConsulta: text(item.dataConsulta) }),
  };
}

export class FipeService {
  constructor(private readonly client = new FipeClient()) {}

  async brands(type?: VehicleType, table?: string) {
    return array(await this.client.get(`marcas/v1${type ? `/${type}` : ""}`, table), value => {
      const item = object(value);
      return { nome: text(item.nome), valor: code(item.valor) };
    });
  }
  async models(type: VehicleType, maker: string, table?: string) {
    return array(await this.client.get(`veiculos/v1/${type}/${maker}`, table), value => {
      const item = object(value);
      return { modelo: text(item.modelo), valor: code(item.valor) };
    });
  }
  async years(type: VehicleType, maker: string, model: string, table?: string) {
    return array(await this.client.get(`anos/v1/${type}/${maker}/${model}`, table), value => {
      const item = object(value);
      const valor = text(item.valor);
      if (!/^\d{4,5}-[1-9]\d{0,2}$/.test(valor)) return invalid();
      return { nome: text(item.nome), valor };
    });
  }
  async prices(fipeCode: string, table?: string) {
    const prices = array(await this.client.get(`preco/v1/${fipeCode}`, table), price);
    if (prices.some(item => item.codigoFipe !== fipeCode)) return invalid();
    return prices;
  }
  async details(type: VehicleType, maker: string, model: string, year: string, table?: string) {
    return price(await this.client.get(`detalhes/v1/${type}/${maker}/${model}/${year}`, table));
  }
  async tables() {
    return array(await this.client.get("tabelas/v1"), value => {
      const item = object(value);
      return { codigo: integer(item.codigo), mes: text(item.mes) };
    });
  }
}
