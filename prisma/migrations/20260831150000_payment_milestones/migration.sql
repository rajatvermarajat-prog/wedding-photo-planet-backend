CREATE TABLE "payment_milestones" (
  "id" VARCHAR(64) NOT NULL, "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL, "title" VARCHAR(160) NOT NULL, "due_date" DATE,
  "amount" DECIMAL(14,2) NOT NULL DEFAULT 0, "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "notes" TEXT, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL, CONSTRAINT "payment_milestones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "payment_milestones_organization_id_project_id_idx" ON "payment_milestones"("organization_id", "project_id");
