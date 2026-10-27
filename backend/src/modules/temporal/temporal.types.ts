// Classification contracts only. Not imported by any application route or writer.
export const TEMPORAL_FIELDS = {
  User: ["createdAt", "updatedAt"],
  Vehicle: ["createdAt", "updatedAt", "fipeConsultedAt"],
  Auction: ["startsAt", "endsAt", "createdAt", "updatedAt"],
  Lot: ["endsAt", "createdAt", "updatedAt"],
  Bid: ["createdAt"],
  Wallet: ["createdAt", "updatedAt"],
  WalletTransaction: ["createdAt"],
  BidReservation: ["createdAt", "updatedAt"],
  AuctionReceipt: ["issuedAt"],
  AuditEvent: ["occurredAt"],
} as const;
export type TemporalModel = keyof typeof TEMPORAL_FIELDS;
export type TemporalTarget = { [M in TemporalModel]: { model: M; field: typeof TEMPORAL_FIELDS[M][number]; id: string } }[TemporalModel];
export enum TemporalEncoding { UNKNOWN = "UNKNOWN", UTC_INSTANT = "UTC_INSTANT", LEGACY_ADAPTER_WALL_CLOCK = "LEGACY_ADAPTER_WALL_CLOCK" }
export enum TemporalOrigin { UNKNOWN = "UNKNOWN", APPLICATION_EXPLICIT = "APPLICATION_EXPLICIT", DATABASE_DEFAULT = "DATABASE_DEFAULT", ORM_AUTOMATIC = "ORM_AUTOMATIC", IMPORT = "IMPORT" }
export const TEMPORAL_EVIDENCE_CODES = ["NO_ROW_PROVENANCE", "NULL_NO_INSTANT", "SCHEMA_DEFAULT_NOT_ROW_PROOF", "ORM_AUTOMATIC_NOT_ROW_PROOF", "APPLICATION_PATH_NOT_ROW_PROOF", "AUDIT_V1_SIGNED_REPRESENTATION_MATCH", "AUDIT_CHAIN_UNVERIFIED"] as const;
export type TemporalEvidenceCode = typeof TEMPORAL_EVIDENCE_CODES[number];
export type TemporalFieldMetadata = TemporalTarget & {
  revision: number;
  encoding: TemporalEncoding;
  origin: TemporalOrigin;
  sourceTimeZone: string | null;
  storedEpochMs: bigint | null;
  canonicalEpochMs: bigint | null;
  evidenceCode: TemporalEvidenceCode;
  recordedAt: Date;
};
export type TemporalInventoryEntry = TemporalTarget & {
  storedEpochMs: string | null;
  candidateOrigin: TemporalOrigin;
  candidateEncoding: TemporalEncoding;
  originStatus: "UNKNOWN" | "PROVEN";
  encodingStatus: "UNKNOWN" | "PROVEN";
  classification: "UNKNOWN" | "PARTIAL" | "PROVEN" | "NOT_APPLICABLE";
  sourceTimeZone: string | null;
  canonicalEpochMs: string | null;
  evidence: TemporalEvidenceCode[];
};
export interface TemporalInventorySummary {
  fieldDefinitions: number;
  values: number;
  nonNullValues: number;
  nullValues: number;
  proven: number;
  partial: number;
  unknown: number;
  provenOrigins: number;
  provenEncodings: number;
}

export function assertTemporalMetadata(value: TemporalFieldMetadata): void {
  const fields = TEMPORAL_FIELDS[value.model] as readonly string[] | undefined;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!fields?.includes(value.field) || !uuid.test(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 1 || !(value.recordedAt instanceof Date) || !Number.isFinite(value.recordedAt.getTime())) throw new Error("Metadado temporal inválido.");
  if (!Object.values(TemporalEncoding).includes(value.encoding) || !Object.values(TemporalOrigin).includes(value.origin)) throw new Error("Contrato temporal não suportado.");
  if (!TEMPORAL_EVIDENCE_CODES.includes(value.evidenceCode)) throw new Error("Código de evidência não permitido.");
  if ((value.storedEpochMs !== null && typeof value.storedEpochMs !== "bigint") || (value.canonicalEpochMs !== null && typeof value.canonicalEpochMs !== "bigint")) throw new Error("Epoch deve ser bigint ou null.");
  if (value.encoding === TemporalEncoding.UNKNOWN && value.canonicalEpochMs !== null) throw new Error("UNKNOWN não fornece instante canônico.");
  if (value.storedEpochMs === null && value.canonicalEpochMs !== null) throw new Error("Campo nulo não possui instante canônico.");
  if (value.encoding === TemporalEncoding.UTC_INSTANT && value.storedEpochMs !== value.canonicalEpochMs) throw new Error("UTC exige igualdade dos epochs.");
  if (value.encoding === TemporalEncoding.LEGACY_ADAPTER_WALL_CLOCK) {
    if (!value.sourceTimeZone || /^[+-]/.test(value.sourceTimeZone) || value.storedEpochMs === null || value.canonicalEpochMs === null) throw new Error("Legado exige zona IANA e epochs resolvidos.");
    try { new Intl.DateTimeFormat("en", { timeZone: value.sourceTimeZone }).format(); } catch { throw new Error("Zona temporal inválida."); }
  } else if (value.sourceTimeZone !== null) throw new Error("Zona de origem reservada à interpretação legada.");
}
