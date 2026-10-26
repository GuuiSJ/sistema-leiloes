import { HttpError } from "../../errors/http-error";
import type { VehicleInput, VehiclePatch, VehicleQuery } from "./vehicle.types";

function invalid(message = "Dados de veículo inválidos."): never { throw new HttpError(400, message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Envie um objeto JSON válido.");
  return value as Record<string, unknown>;
}
function allowed(input: Record<string, unknown>, fields: string[]) {
  if (Object.keys(input).some(key => !fields.includes(key))) invalid("A requisição contém campos não permitidos.");
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || value.includes("\0")) invalid(`Texto deve conter entre 1 e ${max} caracteres.`);
  return value.trim();
}
function year(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1886 || value > new Date().getUTCFullYear() + 1) invalid("Ano deve estar entre 1886 e o próximo ano.");
  return value;
}
const sizes = { brand: 100, model: 150, version: 150, description: 10000, fipeCode: 30, fipeBrandCode: 30, fipeModelCode: 30, fipeYearCode: 30, fipeReferenceMonth: 50 };
const fields = [...Object.keys(sizes), "year", "imageUrls", "fipeReferencePrice"];
function parse(body: unknown, partial: boolean): VehiclePatch {
  const input = object(body);
  allowed(input, fields);
  if (partial && !Object.keys(input).length) invalid("Informe ao menos um campo para atualização.");
  const result: Record<string, unknown> = {};
  for (const [key, size] of Object.entries(sizes)) {
    const required = key === "brand" || key === "model";
    if (partial && !(key in input)) continue;
    result[key] = !required && (input[key] === null || input[key] === undefined) ? null : text(input[key], size);
  }
  if (!partial || "year" in input) result.year = year(input.year);
  if (!partial || "imageUrls" in input) {
    const urls = input.imageUrls;
    if (!Array.isArray(urls) || urls.length > 20) invalid("imageUrls deve ser uma lista com até 20 URLs HTTP(S).");
    result.imageUrls = urls.map(raw => {
      const value = text(raw, 2048);
      let url: URL;
      try { url = new URL(value); } catch { return invalid("URL de imagem inválida."); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) invalid("URL de imagem deve usar HTTP(S), sem credenciais.");
      return value;
    });
  }
  if (!partial || "fipeReferencePrice" in input) {
    const value = input.fipeReferencePrice;
    if (value === null || value === undefined) result.fipeReferencePrice = null;
    else {
      if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value)) invalid("fipeReferencePrice deve ser uma string decimal não negativa, com até 16 inteiros e 2 casas decimais.");
      result.fipeReferencePrice = value;
    }
  }
  return result as VehiclePatch;
}
export function validateCreate(body: unknown): VehicleInput { return parse(body, false) as VehicleInput; }
export function validatePatch(body: unknown): VehiclePatch { return parse(body, true); }
export function validateVehicleId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) invalid("Identificador de veículo inválido.");
  return value.toLowerCase();
}
export function validateQuery(value: unknown): VehicleQuery {
  const input = object(value);
  allowed(input, ["page", "limit", "brand", "model", "year"]);
  function integer(raw: unknown, fallback: number, max: number): number {
    if (raw === undefined) return fallback;
    if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) invalid("Paginação inválida.");
    return Number(raw);
  }
  const query: VehicleQuery = { page: integer(input.page, 1, 1000000), limit: integer(input.limit, 20, 100) };
  if (input.brand !== undefined) query.brand = text(input.brand, 100);
  if (input.model !== undefined) query.model = text(input.model, 150);
  if (input.year !== undefined) {
    if (typeof input.year !== "string" || !/^\d{4}$/.test(input.year)) invalid("Ano inválido.");
    query.year = year(Number(input.year));
  }
  return query;
}
