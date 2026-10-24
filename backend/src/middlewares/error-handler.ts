import type { ErrorRequestHandler } from "express";
import { HttpError } from "../errors/http-error";

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status =
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 500;

  if (status === 500) {
    console.error("Erro interno ao processar requisição.");
  }

  const message = error instanceof HttpError && status !== 500
    ? error.message
    : status === 500
    ? "Erro interno do servidor."
    : status === 400
      ? "Requisição inválida."
      : "Não foi possível processar a requisição.";

  res.status(status).json({ message });
};
