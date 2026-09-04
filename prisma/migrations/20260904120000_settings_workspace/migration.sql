-- Settings workspace: additive only.
--
-- Three new tables and one new enum. No existing table, column, constraint or
-- index is altered — studio identity stays on "organizations", employee
-- identity stays on "users", and module grants stay in the existing
-- "roles" / "role_permissions" / "user_roles" tables.

CREATE TYPE "ModuleAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Settings-only extras for a studio that have no column on "organizations".
CREATE TABLE "organization_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "logo_url" VARCHAR(500),
    "date_format" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_settings_organization_id_key"
  ON "organization_settings"("organization_id");

ALTER TABLE "organization_settings"
  ADD CONSTRAINT "organization_settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-employee avatar plus the notification and security toggle maps.
CREATE TABLE "user_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "avatar_url" VARCHAR(500),
    "notifications" JSONB NOT NULL DEFAULT '{}',
    "security" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

ALTER TABLE "user_settings"
  ADD CONSTRAINT "user_settings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The paper trail for module access requests. The grant itself is written to
-- the existing RBAC tables, so this row never becomes a second source of truth
-- for what an employee can actually do.
CREATE TABLE "module_access_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "module_key" VARCHAR(48) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ModuleAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "module_access_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "module_access_requests_organization_id_status_created_at_idx"
  ON "module_access_requests"("organization_id", "status", "created_at");
CREATE INDEX "module_access_requests_employee_id_status_idx"
  ON "module_access_requests"("employee_id", "status");
CREATE INDEX "module_access_requests_reviewed_by_id_idx"
  ON "module_access_requests"("reviewed_by_id");

-- One open request per employee per module. Prisma cannot express a partial
-- unique index, so it lives here: a settled request must not block a re-request
-- after access is later revoked.
CREATE UNIQUE INDEX "module_access_requests_one_pending_per_module"
  ON "module_access_requests"("employee_id", "module_key")
  WHERE "status" = 'PENDING';

ALTER TABLE "module_access_requests"
  ADD CONSTRAINT "module_access_requests_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "module_access_requests"
  ADD CONSTRAINT "module_access_requests_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "module_access_requests"
  ADD CONSTRAINT "module_access_requests_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
