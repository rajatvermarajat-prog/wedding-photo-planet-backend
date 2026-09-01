CREATE TABLE "staff_salary_payments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "payment_month" VARCHAR(7) NOT NULL,
  "base_salary" DECIMAL(14,2) NOT NULL,
  "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "installments" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organization_id", "user_id", "payment_month")
);
CREATE INDEX "staff_salary_payments_organization_id_payment_month_idx" ON "staff_salary_payments" ("organization_id", "payment_month");
