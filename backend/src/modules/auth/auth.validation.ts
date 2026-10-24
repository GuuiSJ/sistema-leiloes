import { HttpError } from "../../errors/http-error";
import type { LoginInput, RegisterInput } from "./auth.types";

function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Envie um objeto JSON válido.");
  }
  return body as Record<string, unknown>;
}

function validateEmail(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "E-mail inválido.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "E-mail inválido.");
  }
  return email;
}

function validatePassword(value: unknown, registration: boolean): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (registration && value.length < 8) ||
    Buffer.byteLength(value, "utf8") > 72 ||
    value.includes("\0")
  ) {
    throw new HttpError(400, "Senha inválida: no cadastro, use ao menos 8 caracteres; limite de 72 bytes.");
  }
  return value;
}

function rejectUnknownFields(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new HttpError(400, "A requisição contém campos não permitidos.");
  }
}

export function validateRegister(body: unknown): RegisterInput {
  const input = objectBody(body);
  rejectUnknownFields(input, ["name", "email", "password", "role"]);
  if (typeof input.name !== "string" || input.name.trim().length < 2 || input.name.trim().length > 120) {
    throw new HttpError(400, "Nome deve conter entre 2 e 120 caracteres.");
  }
  if (input.role === "AUCTIONEER") {
    throw new HttpError(403, "Cadastro público permitido somente para BIDDER.");
  }
  if (input.role !== "BIDDER") {
    throw new HttpError(400, "Informe o perfil BIDDER.");
  }
  return {
    name: input.name.trim(),
    email: validateEmail(input.email),
    password: validatePassword(input.password, true),
    role: "BIDDER",
  };
}

export function validateLogin(body: unknown): LoginInput {
  const input = objectBody(body);
  rejectUnknownFields(input, ["email", "password"]);
  return { email: validateEmail(input.email), password: validatePassword(input.password, false) };
}
