-- Comprehensive audit log — captures every significant action in the system.
-- Writes go through the service role (admin client); no direct user inserts.
-- Immutable: no UPDATE or DELETE policies are defined.

CREATE TABLE IF NOT EXISTS audit_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action        text NOT NULL,
  actor_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resource_type text,
  resource_id   text,
  before        jsonb,
  after         jsonb,
  metadata      jsonb,
  created_at    timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only managers can read audit logs
CREATE POLICY "audit_logs_managers_select" ON audit_logs
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx  ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx    ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx      ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx    ON audit_logs (resource_type, resource_id);
