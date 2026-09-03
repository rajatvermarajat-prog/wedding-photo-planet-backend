-- Income ledger: organization-scoped, soft-deletable, and project-attributable.
CREATE TYPE "IncomeCategory" AS ENUM ('CLIENT_PAYMENT', 'ADVANCE', 'ALBUM_SALES', 'REFERRAL', 'OTHER');

CREATE TABLE "incomes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID,
  "date" DATE NOT NULL,
  "category" "IncomeCategory" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "client" VARCHAR(160),
  "source" VARCHAR(160),
  "payment_method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
  "notes" TEXT,
  "added_by" VARCHAR(160),
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_by" UUID,
  CONSTRAINT "incomes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incomes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "incomes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "incomes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "incomes_organization_id_date_idx" ON "incomes"("organization_id", "date");
CREATE INDEX "incomes_organization_id_category_date_idx" ON "incomes"("organization_id", "category", "date");
CREATE INDEX "incomes_project_id_idx" ON "incomes"("project_id");
