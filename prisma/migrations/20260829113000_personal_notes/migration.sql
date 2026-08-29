ALTER TABLE "personal_todos" ADD COLUMN IF NOT EXISTS "category" VARCHAR(80);

CREATE TABLE "personal_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "personal_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "personal_notes_user_id_sort_order_idx" ON "personal_notes"("user_id", "sort_order");
CREATE INDEX "personal_notes_organization_id_user_id_idx" ON "personal_notes"("organization_id", "user_id");

ALTER TABLE "personal_notes" ADD CONSTRAINT "personal_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personal_notes" ADD CONSTRAINT "personal_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
