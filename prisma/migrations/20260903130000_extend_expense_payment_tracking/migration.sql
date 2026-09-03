ALTER TABLE "expenses" ADD COLUMN "subcategory" VARCHAR(160), ADD COLUMN "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
CREATE TABLE "expense_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "expense_id" UUID NOT NULL, "amount" DECIMAL(14,2) NOT NULL,
  "paid_at" DATE NOT NULL, "method" "PaymentMethod" NOT NULL DEFAULT 'CASH', "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expense_payments_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "expense_payments_expense_id_paid_at_idx" ON "expense_payments"("expense_id", "paid_at");
