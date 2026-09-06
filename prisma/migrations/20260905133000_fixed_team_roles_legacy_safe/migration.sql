-- Safe, reversible fixed-role migration.  The previous role rows remain intact.
ALTER TABLE "roles" ADD COLUMN "is_legacy" BOOLEAN NOT NULL DEFAULT false;

WITH role_map(old_name, new_name) AS (
  VALUES
    ('ADMIN', 'Admin'), ('Admin', 'Admin'),
    ('MANAGER', 'Manager'), ('Manager', 'Manager'), ('Studio Manager', 'Manager'),
    ('Account Manager', 'Account Manager'), ('Video Editor', 'Video Editor'),
    ('Social Media Handler', 'Social Media Handler'), ('Photo Editor', 'Photo Editor'),
    ('Retoucher', 'Photo Editor'), ('Album Designer', 'Album Designer'),
    ('Drone Operator', 'Drone Operator'), ('Sales Team', 'Sales Team'),
    ('Photographer', 'Photographer - Traditional'), ('Assistant Photographer', 'Photographer - Traditional'),
    ('Videographer', 'Videographer - Traditional'), ('Cinematographer', 'Videographer - Traditional'),
    ('Assistant Cinematographer', 'Videographer - Traditional')
), needed AS (
  SELECT DISTINCT r."organization_id", m.new_name
  FROM "roles" r JOIN role_map m ON r."name" = m.old_name
  WHERE r."deleted_at" IS NULL
)
INSERT INTO "roles" ("id", "organization_id", "name", "description", "type", "status", "is_legacy", "is_default", "created_at", "updated_at")
SELECT gen_random_uuid(), "organization_id", new_name, 'Migrated fixed team role', 'SYSTEM', 'ACTIVE', false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM needed
ON CONFLICT ("organization_id", "name") DO UPDATE
SET "status" = 'ACTIVE', "is_legacy" = false, "updated_at" = CURRENT_TIMESTAMP;

-- Every studio receives the complete fixed catalogue, including both crew sub-types.
INSERT INTO "roles" ("id", "organization_id", "name", "description", "type", "status", "is_legacy", "is_default", "created_at", "updated_at")
SELECT gen_random_uuid(), o."id", fixed.name, 'Fixed team role', 'SYSTEM', 'ACTIVE', false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('Admin'), ('Manager'), ('Account Manager'), ('Video Editor'), ('Social Media Handler'), ('Photo Editor'), ('Album Designer'),
  ('Photographer - Traditional'), ('Photographer - Candid'), ('Videographer - Traditional'), ('Videographer - Candid'), ('Drone Operator'), ('Sales Team')
) AS fixed(name)
ON CONFLICT ("organization_id", "name") DO UPDATE
SET "status" = 'ACTIVE', "is_legacy" = false, "updated_at" = CURRENT_TIMESTAMP;

WITH role_map(old_name, new_name) AS (
  VALUES
    ('ADMIN', 'Admin'), ('Admin', 'Admin'), ('MANAGER', 'Manager'), ('Manager', 'Manager'), ('Studio Manager', 'Manager'),
    ('Account Manager', 'Account Manager'), ('Video Editor', 'Video Editor'), ('Social Media Handler', 'Social Media Handler'),
    ('Photo Editor', 'Photo Editor'), ('Retoucher', 'Photo Editor'), ('Album Designer', 'Album Designer'), ('Drone Operator', 'Drone Operator'), ('Sales Team', 'Sales Team'),
    ('Photographer', 'Photographer - Traditional'), ('Assistant Photographer', 'Photographer - Traditional'),
    ('Videographer', 'Videographer - Traditional'), ('Cinematographer', 'Videographer - Traditional'), ('Assistant Cinematographer', 'Videographer - Traditional')
)
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), target."id", rp."permission_id", CURRENT_TIMESTAMP
FROM "roles" source
JOIN role_map m ON m.old_name = source."name"
JOIN "roles" target ON target."organization_id" = source."organization_id" AND target."name" = m.new_name
JOIN "role_permissions" rp ON rp."role_id" = source."id"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

WITH role_map(old_name, new_name) AS (
  VALUES
    ('ADMIN', 'Admin'), ('Admin', 'Admin'), ('MANAGER', 'Manager'), ('Manager', 'Manager'), ('Studio Manager', 'Manager'),
    ('Account Manager', 'Account Manager'), ('Video Editor', 'Video Editor'), ('Social Media Handler', 'Social Media Handler'),
    ('Photo Editor', 'Photo Editor'), ('Retoucher', 'Photo Editor'), ('Album Designer', 'Album Designer'), ('Drone Operator', 'Drone Operator'), ('Sales Team', 'Sales Team'),
    ('Photographer', 'Photographer - Traditional'), ('Assistant Photographer', 'Photographer - Traditional'),
    ('Videographer', 'Videographer - Traditional'), ('Cinematographer', 'Videographer - Traditional'), ('Assistant Cinematographer', 'Videographer - Traditional')
)
INSERT INTO "user_roles" ("id", "user_id", "role_id", "assigned_by", "created_at")
SELECT gen_random_uuid(), ur."user_id", target."id", ur."assigned_by", CURRENT_TIMESTAMP
FROM "user_roles" ur
JOIN "roles" source ON source."id" = ur."role_id"
JOIN role_map m ON m.old_name = source."name"
JOIN "roles" target ON target."organization_id" = source."organization_id" AND target."name" = m.new_name
ON CONFLICT ("user_id", "role_id") DO NOTHING;

-- Mapped roles have a replacement with copied permissions and assignments.
UPDATE "roles" SET "is_legacy" = true, "status" = 'INACTIVE', "updated_at" = CURRENT_TIMESTAMP
WHERE "name" IN ('ADMIN', 'MANAGER', 'Studio Manager', 'Retoucher', 'Assistant Photographer', 'Videographer', 'Cinematographer', 'Assistant Cinematographer')
  AND "deleted_at" IS NULL;

-- Unmatched roles are labelled legacy.  Assigned ones intentionally remain
-- active until a studio administrator reassigns them, preventing lockouts.
UPDATE "roles" r SET "is_legacy" = true, "status" = CASE WHEN EXISTS (SELECT 1 FROM "user_roles" ur WHERE ur."role_id" = r."id") THEN r."status" ELSE 'INACTIVE'::"RoleStatus" END, "updated_at" = CURRENT_TIMESTAMP
WHERE r."name" IN ('MEMBER', 'Coordinator', 'Editor', 'Other') OR (r."type" = 'CUSTOM' AND r."name" NOT IN ('Photographer - Traditional', 'Photographer - Candid', 'Videographer - Traditional', 'Videographer - Candid'));
