-- PREPARED ONLY: do not apply until the temporal cutover is explicitly approved.
-- Existing rows and inserts omitting the marker deterministically remain LEGACY.
-- UTC_V2 must be explicitly selected by the backend after controlled activation.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TYPE "AuctionTemporalGeneration" AS ENUM ('LEGACY', 'UTC_V2');

ALTER TABLE "Auction"
ADD COLUMN "temporalGeneration" "AuctionTemporalGeneration" NOT NULL DEFAULT 'LEGACY';

CREATE INDEX "Auction_temporalGeneration_status_idx"
ON "Auction"("temporalGeneration", "status");

COMMIT;
