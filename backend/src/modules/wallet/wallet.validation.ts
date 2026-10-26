import { HttpError } from "../../errors/http-error";
import type { WalletQuery } from "./wallet.types";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Envie um objeto JSON válido.");
  return value as Record<string, unknown>;
}
function allowed(input: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(input).some(key => !fields.includes(key))) throw new HttpError(400, "A requisição contém campos não permitidos.");
}
export function validateCredit(value: unknown): string {
  const input = object(value);
  allowed(input, ["amount"]);
  if (typeof input.amount !== "string" || !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(input.amount) || !/[1-9]/.test(input.amount)) {
    throw new HttpError(400, "amount deve ser string decimal positiva com até 16 inteiros e duas casas decimais.");
  }
  return input.amount;
}
export function validateKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(value)) throw new HttpError(400, "Informe Idempotency-Key com 1 a 64 caracteres: letras, números, ponto, hífen, dois-pontos ou sublinhado.");
  return value;
}
export function validateQuery(value: unknown): WalletQuery {
  const input = object(value);
  allowed(input, ["page", "limit"]);
  function integer(raw: unknown, fallback: number, max: number) {
    if (raw === undefined) return fallback;
    if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) throw new HttpError(400, "Paginação inválida: page de 1 a 1000000, limit de 1 a 100.");
    return Number(raw);
  }
  return { page: integer(input.page, 1, 1000000), limit: integer(input.limit, 20, 100) };
}
export function validateNoQuery(value: unknown): void { allowed(object(value), []); }
