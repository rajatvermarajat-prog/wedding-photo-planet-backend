ALTER TABLE "freelancers" ADD COLUMN IF NOT EXISTS "user_id" UUID;

INSERT INTO "users" (
  "id",
  "organization_id",
  "full_name",
  "email",
  "phone",
  "password_hash",
  "status",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  f."organization_id",
  f."full_name",
  lower(f."email"),
  f."phone",
  f."password_hash",
  'ACTIVE',
  now(),
  now()
FROM "freelancers" f
WHERE f."user_id" IS NULL
  AND f."email" IS NOT NULL
  AND f."password_hash" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" u
    WHERE u."organization_id" = f."organization_id"
      AND lower(u."email") = lower(f."email")
      AND u."deleted_at" IS NULL
  );

UPDATE "freelancers" f
SET "user_id" = u."id"
FROM "users" u
WHERE f."user_id" IS NULL
  AND f."email" IS NOT NULL
  AND u."organization_id" = f."organization_id"
  AND lower(u."email") = lower(f."email")
  AND u."deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "freelancers_user_id_key" ON "freelancers"("user_id");
CREATE INDEX IF NOT EXISTS "freelancers_user_id_idx" ON "freelancers"("user_id");

ALTER TABLE "freelancers"
  DROP CONSTRAINT IF EXISTS "freelancers_user_id_fkey";

ALTER TABLE "freelancers"
  ADD CONSTRAINT "freelancers_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
