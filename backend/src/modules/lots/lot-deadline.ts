import type { Auction, Lot } from "../../generated/prisma/client";

export const ANTI_SNIPING_WINDOW_MS = 120000;

export function effectiveLotEndsAt(lot: Pick<Lot, "endsAt">, auction: Pick<Auction, "endsAt">): Date {
  return lot.endsAt ?? auction.endsAt;
}

export function extendedDeadline(previousEndsAt: Date, acceptedAt: Date): Date | null {
  const remaining = previousEndsAt.getTime() - acceptedAt.getTime();
  if (remaining <= 0 || remaining > ANTI_SNIPING_WINDOW_MS) return null;
  const candidate = acceptedAt.getTime() + ANTI_SNIPING_WINDOW_MS;
  // At the exact boundary a full two-minute window already exists: no actual extension.
  return candidate > previousEndsAt.getTime() ? new Date(candidate) : null;
}
