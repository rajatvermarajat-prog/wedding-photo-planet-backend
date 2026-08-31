-- An INACTIVE role keeps its permission mapping but grants nothing and cannot
-- be assigned. Existing roles stay ACTIVE so authorization is unchanged.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RoleStatus') THEN
    CREATE TYPE "RoleStatus" AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;
END
$$;

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE';

-- Every authenticated request joins roles by organization and status.
CREATE INDEX IF NOT EXISTS "roles_organization_id_status_idx"
  ON "roles" ("organization_id", "status");
