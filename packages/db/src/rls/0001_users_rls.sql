-- NFR-06 defense-in-depth: the app sets app.current_user_id for the duration of each request
-- (see withRequestContext in src/client.ts). These policies back up, never replace, explicit
-- application-level checks.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_self_or_active ON users
  FOR SELECT
  USING (status = 'active' OR id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY users_update_self ON users
  FOR UPDATE
  USING (id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (id = current_setting('app.current_user_id', true)::uuid);
