ALTER TABLE "projects" ADD COLUMN "is_urgent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shoots" ADD COLUMN "planned_role_slots" JSONB;
