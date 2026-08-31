-- A personal role gives one specific employee their own permission set, so it
-- must never be offered for anyone else to be assigned. Marking the owner on the
-- role itself keeps that rule in the data instead of in a naming convention.
ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "personal_for_user_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'roles_personal_for_user_id_fkey'
  ) THEN
    ALTER TABLE "roles"
      ADD CONSTRAINT "roles_personal_for_user_id_fkey"
      FOREIGN KEY ("personal_for_user_id") REFERENCES "users" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "roles_personal_for_user_id_idx"
  ON "roles" ("personal_for_user_id");

-- Backfill: roles already created by the "give own permissions" action are
-- identifiable by their generated description plus a single assignee.
UPDATE "roles" r
SET "personal_for_user_id" = sole.user_id
FROM (
  SELECT ur."role_id", MIN(ur."user_id"::text)::uuid AS user_id
  FROM "user_roles" ur
  GROUP BY ur."role_id"
  HAVING COUNT(*) = 1
) AS sole
WHERE r."id" = sole."role_id"
  AND r."type" = 'CUSTOM'
  AND r."personal_for_user_id" IS NULL
  AND r."description" LIKE 'Personal access for %';
