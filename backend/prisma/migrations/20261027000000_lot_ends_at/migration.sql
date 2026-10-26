-- Individual deadline override. NULL preserves the auction's existing base deadline.
-- No backfill or modification of existing business data.
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE "Lot" ADD COLUMN "endsAt" TIMESTAMPTZ(3);
COMMIT;
