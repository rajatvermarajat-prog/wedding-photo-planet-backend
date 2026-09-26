-- Allow the same person to hold multiple roles on one shoot.
-- Uniqueness is now (shoot, person, role), not (shoot, person).

DROP INDEX IF EXISTS "shoot_assignments_shoot_id_user_id_key";
DROP INDEX IF EXISTS "shoot_assignments_shoot_id_freelancer_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "shoot_assignments_shoot_id_user_id_role_key" ON "shoot_assignments"("shoot_id", "user_id", "role");
CREATE UNIQUE INDEX IF NOT EXISTS "shoot_assignments_shoot_id_freelancer_id_role_key" ON "shoot_assignments"("shoot_id", "freelancer_id", "role");
