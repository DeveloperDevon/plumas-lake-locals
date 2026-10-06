-- Custom SQL migration file, put your code below! --

-- NFR-06 defense-in-depth row-level security. The app sets app.current_user_id for the
-- duration of each request (see withRequestContext in src/client.ts). These policies back
-- up, never replace, explicit application-level checks. Source: src/rls/0001_users_rls.sql
-- and src/rls/0002_invites_rls.sql (kept there for reference and review).

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_self_or_active ON users
  FOR SELECT
  USING (status = 'active' OR id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY users_update_self ON users
  FOR UPDATE
  USING (id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY invites_select_own ON invites
  FOR SELECT
  USING (inviter_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY invites_insert_self ON invites
  FOR INSERT
  WITH CHECK (inviter_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY invites_update_own ON invites
  FOR UPDATE
  USING (inviter_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (inviter_id = current_setting('app.current_user_id', true)::uuid);
