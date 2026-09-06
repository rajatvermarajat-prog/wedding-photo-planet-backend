-- Additive follow-up for clearly named, employee-specific legacy roles.
-- Original personal roles remain assigned and active, so this only grants the
-- matching fixed role; it never removes an assignment or permission.
WITH role_map AS (
  SELECT
    legacy.id AS source_role_id,
    target.id AS target_role_id
  FROM roles legacy
  JOIN roles target
    ON target.organization_id = legacy.organization_id
   AND target.is_legacy = FALSE
   AND target.status = 'ACTIVE'
   AND target.name = CASE
     WHEN legacy.name ILIKE '% — Photographer' THEN 'Photographer - Traditional'
     WHEN legacy.name ILIKE '% — Videographer'
       OR legacy.name ILIKE '% — Cinematographer'
       OR legacy.name ILIKE '% — Assistant Cinematographer'
       THEN 'Videographer - Traditional'
     WHEN legacy.name ILIKE '% — Assistant Photographer' THEN 'Photographer - Traditional'
     WHEN legacy.name ILIKE '% — Manager' THEN 'Manager'
   END
  WHERE legacy.is_legacy = TRUE
    AND (
      legacy.name ILIKE '% — Photographer'
      OR legacy.name ILIKE '% — Assistant Photographer'
      OR legacy.name ILIKE '% — Videographer'
      OR legacy.name ILIKE '% — Cinematographer'
      OR legacy.name ILIKE '% — Assistant Cinematographer'
      OR legacy.name ILIKE '% — Manager'
    )
)
INSERT INTO user_roles (id, user_id, role_id, assigned_by, created_at)
SELECT gen_random_uuid(), ur.user_id, rm.target_role_id, ur.assigned_by, NOW()
FROM user_roles ur
JOIN role_map rm ON rm.source_role_id = ur.role_id
ON CONFLICT (user_id, role_id) DO NOTHING;
