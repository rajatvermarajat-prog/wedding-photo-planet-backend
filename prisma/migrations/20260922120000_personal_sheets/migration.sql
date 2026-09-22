-- CreateTable
CREATE TABLE "personal_sheets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{"columns":[],"rows":[]}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "personal_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One private sheet per user.
CREATE UNIQUE INDEX "personal_sheets_user_id_key" ON "personal_sheets"("user_id");

-- CreateIndex
CREATE INDEX "personal_sheets_organization_id_idx" ON "personal_sheets"("organization_id");

-- AddForeignKey
ALTER TABLE "personal_sheets" ADD CONSTRAINT "personal_sheets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_sheets" ADD CONSTRAINT "personal_sheets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
