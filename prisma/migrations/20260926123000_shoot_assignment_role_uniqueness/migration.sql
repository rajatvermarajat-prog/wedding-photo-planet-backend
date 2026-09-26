-- Allow the same person to serve different roles on one shoot while still
-- blocking duplicate assignment to the same role.
ALTER TABLE "shoot_assignments" DROP CONSTRAINT IF EXISTS "shoot_assignments_shoot_id_user_id_key";
ALTER TABLE "shoot_assignments" DROP CONSTRAINT IF EXISTS "shoot_assignments_shoot_id_freelancer_id_key";

ALTER TABLE "shoot_assignments"
  ADD CONSTRAINT "shoot_assignments_shoot_id_user_id_role_key"
  UNIQUE ("shoot_id", "user_id", "role");

ALTER TABLE "shoot_assignments"
  ADD CONSTRAINT "shoot_assignments_shoot_id_freelancer_id_role_key"
  UNIQUE ("shoot_id", "freelancer_id", "role");
