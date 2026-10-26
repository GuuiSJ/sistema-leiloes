-- No implicit ownership assignment. Existing vehicles require an approved mapping.
-- Explicit transaction ensures a failed precondition leaves the schema untouched.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE "Vehicle" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Vehicle") THEN
    RAISE EXCEPTION 'Vehicle contains rows without an approved owner mapping. Obtain approval before migrating.';
  END IF;
END $$;

ALTER TABLE "Vehicle" ADD COLUMN "ownerId" UUID NOT NULL;
CREATE INDEX "Vehicle_ownerId_idx" ON "Vehicle"("ownerId");
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
