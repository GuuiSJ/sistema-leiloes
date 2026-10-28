import type { Auction, Bid, Lot } from './auctions'

const maxCents = 999999999999999999n
function cents(value: string): bigint | null {
  if (!/^\d{1,16}\.\d{2}$/.test(value)) return null
  const result = BigInt(value.replace('.', ''))
  return result > 0n && result <= maxCents ? result : null
}
export function referenceNextBid(lot: Lot, latest: Bid | null, historyAvailable: boolean): string | null {
  if (!historyAvailable || (latest && (latest.lotId !== lot.id || !Number.isSafeInteger(latest.sequence) || latest.sequence < 1))) return null
  const start = cents(lot.startingPrice), increment = cents(lot.minimumIncrement)
  const previous = latest ? cents(latest.amount) : null
  if (start === null || increment === null || (latest && previous === null)) return null
  const next = previous === null ? start : previous + increment
  if (next > maxCents || next < start) return null
  return `${next / 100n}.${(next % 100n).toString().padStart(2, '0')}`
}

export function deadlineState(auction: Auction, lot: Lot): 'closed' | 'not-open' | 'unverified' {
  if (['CLOSED', 'CANCELLED'].includes(auction.status) || ['SOLD', 'UNSOLD', 'CANCELLED'].includes(lot.status)) return 'closed'
  if (auction.status !== 'OPEN' || lot.status !== 'OPEN') return 'not-open'
  // Public responses do not identify temporalGeneration or prove a canonical legacy instant.
  return 'unverified'
}
