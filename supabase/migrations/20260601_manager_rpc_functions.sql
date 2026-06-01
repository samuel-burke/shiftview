-- SECURITY DEFINER helpers for promoting/demoting managers.
-- These run as the DB owner so the managers table needs no direct-write RLS.
-- Only authenticated users who are already managers can call these.

CREATE OR REPLACE FUNCTION manager_promote(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized: caller is not a manager';
  END IF;
  INSERT INTO managers (user_id) VALUES (target_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION manager_demote(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized: caller is not a manager';
  END IF;
  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Cannot demote yourself';
  END IF;
  DELETE FROM managers WHERE user_id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION manager_promote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION manager_demote(uuid) TO authenticated;
