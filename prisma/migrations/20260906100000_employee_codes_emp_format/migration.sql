-- Move employee IDs to the canonical EMP-S## format once, outside any read API.
-- Existing null, empty, or legacy/non-matching codes are assigned a stable
-- sequence per organization ordered by user creation time.
WITH existing_max AS (
  SELECT
    organization_id,
    COALESCE(MAX(CAST(SUBSTRING(employee_code FROM '[0-9]+$') AS INTEGER)), 0) AS max_seq
  FROM users
  WHERE employee_code ~ '^EMP-S[0-9]{2,}$'
  GROUP BY organization_id
),
needs_code AS (
  SELECT
    id,
    organization_id,
    ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at ASC, id ASC) AS row_num
  FROM users
  WHERE employee_code IS NULL
     OR BTRIM(employee_code) = ''
     OR employee_code !~ '^EMP-S[0-9]{2,}$'
)
UPDATE users AS u
SET employee_code = 'EMP-S' || LPAD(((COALESCE(existing_max.max_seq, 0) + needs_code.row_num)::text), 2, '0')
FROM needs_code
LEFT JOIN existing_max ON existing_max.organization_id = needs_code.organization_id
WHERE u.id = needs_code.id;

ALTER TABLE users
  ADD CONSTRAINT users_employee_code_emp_format_chk
  CHECK (employee_code IS NULL OR employee_code ~ '^EMP-S[0-9]{2,}$');
