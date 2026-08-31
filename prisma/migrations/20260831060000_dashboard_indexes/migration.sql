-- Indexes supporting the dashboard aggregation endpoint. Each one matches an
-- exact (organization-scoped) filter used by GET /api/v1/dashboard/summary.
CREATE INDEX IF NOT EXISTS "projects_organization_id_status_delivery_due_date_idx"
  ON "projects" ("organization_id", "status", "delivery_due_date");

CREATE INDEX IF NOT EXISTS "shoots_organization_id_status_shoot_date_idx"
  ON "shoots" ("organization_id", "status", "shoot_date");

CREATE INDEX IF NOT EXISTS "tasks_organization_id_status_due_date_idx"
  ON "tasks" ("organization_id", "status", "due_date");

CREATE INDEX IF NOT EXISTS "tasks_organization_id_assignee_id_status_idx"
  ON "tasks" ("organization_id", "assignee_id", "status");

CREATE INDEX IF NOT EXISTS "personal_todos_organization_id_user_id_completed_idx"
  ON "personal_todos" ("organization_id", "user_id", "completed");

CREATE INDEX IF NOT EXISTS "attendance_organization_id_date_status_idx"
  ON "attendance" ("organization_id", "date", "status");

CREATE INDEX IF NOT EXISTS "notifications_organization_id_user_id_is_read_idx"
  ON "notifications" ("organization_id", "user_id", "is_read");
