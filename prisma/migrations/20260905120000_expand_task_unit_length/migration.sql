-- Project-task units can contain a full deliverable description, not just a
-- short label such as "Pcs" or "Reels".
ALTER TABLE "tasks" ALTER COLUMN "unit" TYPE VARCHAR(160);
