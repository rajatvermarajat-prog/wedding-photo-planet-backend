ALTER TYPE "StorageProvider" ADD VALUE IF NOT EXISTS 'DATABASE';

ALTER TABLE "files"
  ADD COLUMN "content" BYTEA,
  ADD COLUMN "is_registered" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "files_pending_database_upload_idx"
  ON "files" ("bucket", "object_key")
  WHERE "is_registered" = false AND "deleted_at" IS NULL;
