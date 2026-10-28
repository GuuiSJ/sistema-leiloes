import type { Auction, Lot } from './auctions'

export type BidAvailability = 'closed' | 'not-open' | 'unverified'

// The public DTO omits temporalGeneration and participant eligibility.
// Never infer permission from OPEN, browser time or an estimated minimum.
export function bidAvailability(auction: Auction, lot: Lot): BidAvailability {
  if (['CLOSED', 'CANCELLED'].includes(auction.status) || ['SOLD', 'UNSOLD', 'CANCELLED'].includes(lot.status)) return 'closed'
  if (auction.status !== 'OPEN' || lot.status !== 'OPEN') return 'not-open'
  return 'unverified'
}
