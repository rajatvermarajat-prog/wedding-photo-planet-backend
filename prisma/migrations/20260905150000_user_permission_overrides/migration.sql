-- Employee-specific authorization overrides. Fixed shared roles remain intact.
CREATE TABLE "user_permission_overrides" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "permission_keys" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_permission_overrides_user_id_key" ON "user_permission_overrides"("user_id");
CREATE INDEX "user_permission_overrides_organization_id_idx" ON "user_permission_overrides"("organization_id");
ALTER TABLE "user_permission_overrides"
  ADD CONSTRAINT "user_permission_overrides_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permission_overrides"
  ADD CONSTRAINT "user_permission_overrides_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
