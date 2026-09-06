-- Final role-catalogue cleanup. All employees must already hold one of the
-- approved fixed roles before this migration is applied.
DELETE FROM user_roles
WHERE role_id IN (
  SELECT id FROM roles
  WHERE name NOT IN (
    'Admin', 'Manager', 'Account Manager', 'Video Editor',
    'Social Media Handler', 'Photo Editor', 'Album Designer',
    'Photographer - Traditional', 'Photographer - Candid',
    'Videographer - Traditional', 'Videographer - Candid',
    'Drone Operator', 'Sales Team'
  )
);

DELETE FROM roles
WHERE name NOT IN (
  'Admin', 'Manager', 'Account Manager', 'Video Editor',
  'Social Media Handler', 'Photo Editor', 'Album Designer',
  'Photographer - Traditional', 'Photographer - Candid',
  'Videographer - Traditional', 'Videographer - Candid',
  'Drone Operator', 'Sales Team'
);

ALTER TABLE roles DROP COLUMN IF EXISTS is_legacy;
