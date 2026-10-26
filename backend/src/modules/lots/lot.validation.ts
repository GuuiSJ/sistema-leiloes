import { HttpError } from "../../errors/http-error";
import type { LotInput, LotPatch, LotQuery } from "./lot.types";

function invalid(message: string): never { throw new HttpError(400, message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Envie um objeto JSON válido.");
  return value as Record<string, unknown>;
}
function allowed(input: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(input).some(key => !fields.includes(key))) invalid("A requisição contém campos não permitidos.");
}
export function validateId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) invalid("Identificador inválido.");
  return value.toLowerCase();
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647) invalid("Número do lote deve ser um inteiro positivo até 2147483647.");
  return value;
}
function money(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) invalid("Valores devem ser strings decimais positivas com até 16 inteiros e duas casas decimais.");
  return value;
}
export function validateCreate(value: unknown): LotInput {
  const input = object(value);
  allowed(input, ["vehicleId", "number", "startingPrice", "minimumIncrement"]);
  return { vehicleId: validateId(input.vehicleId), number: number(input.number), startingPrice: money(input.startingPrice), minimumIncrement: money(input.minimumIncrement) };
}
export function validatePatch(value: unknown): LotPatch {
  const input = object(value);
  allowed(input, ["vehicleId", "number", "startingPrice"]);
  if (!Object.keys(input).length) invalid("Informe ao menos um campo para atualização.");
  const patch: LotPatch = {};
  if ("vehicleId" in input) patch.vehicleId = validateId(input.vehicleId);
  if ("number" in input) patch.number = number(input.number);
  if ("startingPrice" in input) patch.startingPrice = money(input.startingPrice);
  return patch;
}
export function validateDelete(value: unknown): void {
  if (value !== undefined) invalid("DELETE não aceita corpo.");
}
export function validateQuery(value: unknown): LotQuery {
  const input = object(value);
  allowed(input, ["page", "limit"]);
  function integer(raw: unknown, fallback: number, max: number): number {
    if (raw === undefined) return fallback;
    if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) invalid("Paginação inválida: page de 1 a 1000000, limit de 1 a 100.");
    return Number(raw);
  }
  return { page: integer(input.page, 1, 1000000), limit: integer(input.limit, 20, 100) };
}
