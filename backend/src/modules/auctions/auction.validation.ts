import { AuctionStatus } from "../../generated/prisma/client";
import { HttpError } from "../../errors/http-error";
import type { AuctionInput, AuctionPatch, AuctionQuery } from "./auction.types";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Envie um objeto JSON válido.");
  }
  return value as Record<string, unknown>;
}

function allowedFields(input: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(input).some((key) => !fields.includes(key))) {
    throw new HttpError(400, "A requisição contém campos não permitidos.");
  }
}

function title(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 150 || value.includes("\0")) {
    throw new HttpError(400, "Título deve conter entre 1 e 150 caracteres.");
  }
  return value.trim();
}

function description(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 10000 || value.includes("\0")) {
    throw new HttpError(400, "Descrição deve ser texto de até 10000 caracteres ou null.");
  }
  return value.trim();
}

function date(value: unknown): Date {
  const match = typeof value === "string"
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/)
    : null;
  if (!match) throw new HttpError(400, "Datas devem usar ISO 8601 com segundos e fuso horário.");
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const parsed = new Date(value as string);
  if (
    Number(year) < 1000 || Number(month) < 1 || Number(month) > 12 ||
    Number(day) < 1 || Number(day) > daysInMonth || Number(hour) > 23 ||
    Number(minute) > 59 || Number(second) > 59 || Number(offsetHour ?? 0) > 23 ||
    Number(offsetMinute ?? 0) > 59 || Number.isNaN(parsed.getTime())
  ) throw new HttpError(400, "Data inválida.");
  return parsed;
}

export function validateAuctionId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, "Identificador de leilão inválido.");
  }
  return value.toLowerCase();
}

export function validateCreate(body: unknown): AuctionInput {
  const input = object(body);
  allowedFields(input, ["title", "description", "startsAt", "endsAt"]);
  return {
    title: title(input.title),
    description: input.description === undefined ? null : description(input.description),
    startsAt: date(input.startsAt),
    endsAt: date(input.endsAt),
  };
}

export function validatePatch(body: unknown): AuctionPatch {
  const input = object(body);
  allowedFields(input, ["title", "description", "startsAt", "endsAt"]);
  if (!Object.keys(input).length) throw new HttpError(400, "Informe ao menos um campo para atualização.");
  const patch: AuctionPatch = {};
  if ("title" in input) patch.title = title(input.title);
  if ("description" in input) patch.description = description(input.description);
  if ("startsAt" in input) patch.startsAt = date(input.startsAt);
  if ("endsAt" in input) patch.endsAt = date(input.endsAt);
  return patch;
}

export function validateCancellation(body: unknown): void {
  if (body === undefined) return;
  allowedFields(object(body), []);
}

export function validateQuery(value: unknown): AuctionQuery {
  const input = object(value);
  allowedFields(input, ["page", "limit", "status"]);
  function integer(raw: unknown, fallback: number, max: number): number {
    if (raw === undefined) return fallback;
    if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) {
      throw new HttpError(400, "Paginação inválida: page deve ser de 1 a 1000000 e limit de 1 a 100.");
    }
    return Number(raw);
  }
  const query: AuctionQuery = { page: integer(input.page, 1, 1000000), limit: integer(input.limit, 20, 100) };
  if (input.status !== undefined) {
    if (typeof input.status !== "string" || !Object.values(AuctionStatus).includes(input.status as AuctionStatus)) {
      throw new HttpError(400, "Status de leilão inválido.");
    }
    query.status = input.status as AuctionStatus;
  }
  return query;
}
