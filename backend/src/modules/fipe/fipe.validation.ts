import { HttpError } from "../../errors/http-error";

export type VehicleType = "carros" | "motos" | "caminhoes";

export function vehicleType(value: unknown): VehicleType {
  if (value !== "carros" && value !== "motos" && value !== "caminhoes") {
    throw new HttpError(400, "Tipo de veículo inválido: use carros, motos ou caminhoes.");
  }
  return value;
}

export function positiveCode(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new HttpError(400, "Código deve ser um inteiro positivo válido.");
  }
  return value;
}

export function fipeCode(value: unknown): string {
  if (typeof value !== "string" || !/^\d{6}-\d$/.test(value)) {
    throw new HttpError(400, "Código FIPE inválido: use o formato 000000-0.");
  }
  return value;
}

export function yearCode(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4,5}-[1-9]\d{0,2}$/.test(value)) {
    throw new HttpError(400, "Código de ano inválido. Use o valor retornado pela consulta de anos.");
  }
  return value;
}

export function referenceTable(query: Record<string, unknown>, supported = true): string | undefined {
  if (Object.keys(query).some(key => key !== "tabela_referencia" || !supported)) {
    throw new HttpError(400, "Parâmetro de consulta não suportado.");
  }
  return query.tabela_referencia === undefined ? undefined : positiveCode(query.tabela_referencia);
}
