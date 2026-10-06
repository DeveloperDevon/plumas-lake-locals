-- NFR-06 defense-in-depth, paired with 0001_users_rls.sql.
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
