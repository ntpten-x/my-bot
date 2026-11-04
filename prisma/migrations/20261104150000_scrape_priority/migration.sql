-- Faster, more complete read-only capture: per-source priority, adaptive interval and last-run stats.
ALTER TABLE "Source" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "Source" ADD COLUMN "currentIntervalMinutes" DOUBLE PRECISION NOT NULL DEFAULT 10;
ALTER TABLE "Source" ADD COLUMN "nextRunAt" TIMESTAMP(3);
ALTER TABLE "Source" ADD COLUMN "lastRunAt" TIMESTAMP(3);
ALTER TABLE "Source" ADD COLUMN "lastRunFound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Source" ADD COLUMN "lastRunNew" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Source" ADD COLUMN "lastRunScrolls" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Source" ADD COLUMN "lastRunStop" TEXT NOT NULL DEFAULT '';

-- Existing sources start at their configured interval.
UPDATE "Source" SET "currentIntervalMinutes" = "intervalMinutes";

-- New default: 5 groups per extension cycle (only bump the old default, keep owner-chosen values).
UPDATE "Setting" SET "value" = '5' WHERE "key" = 'max_groups_per_cycle' AND "value" = '3';
