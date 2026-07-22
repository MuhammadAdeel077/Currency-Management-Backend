-- =============================================================================
-- Reset user model: collapse user_profiles / admins / customers / super_admins
-- into the users table, keyed by user_type_id.
--
-- DEV RESET script — assumes no production data needs preserving.
-- Run against your Postgres database, e.g.:
--   psql "$DATABASE_URL" -f src/migrations/reset-user-model.sql
-- =============================================================================

BEGIN;

-- 1. New columns on users -----------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS user_type_id uuid,
  ADD COLUMN IF NOT EXISTS type          varchar,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS is_active     boolean NOT NULL DEFAULT true;

-- 2. FK from users.user_type_id -> user_types.id ------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_user_type'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_user_type
      FOREIGN KEY (user_type_id) REFERENCES user_types(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Seed the canonical user types (idempotent) -------------------------------
INSERT INTO user_types (id, name, created_at, updated_at)
SELECT gen_random_uuid(), t.name, now(), now()
FROM (VALUES ('superAdmin'), ('admin'), ('customer')) AS t(name)
WHERE NOT EXISTS (SELECT 1 FROM user_types ut WHERE ut.name = t.name);

-- 4. Drop the now-obsolete tables ---------------------------------------------
--    (dev reset — data in these tables is discarded)
DROP TABLE IF EXISTS customers     CASCADE;
DROP TABLE IF EXISTS admins        CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS super_admins  CASCADE;

COMMIT;

-- Note on adminId scoping:
--   IsAdminGuard now sets request.adminId = users.id (previously it was the
--   admins-table PK). All account/journal/currency data is scoped by adminId.
--   Because this is a dev reset with no rows to migrate, nothing needs
--   remapping; going forward adminId == the admin user's own id.
