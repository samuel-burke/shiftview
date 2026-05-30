-- SECURITY DEFINER helpers for the notification system.
-- These run as the DB owner, so callers (authenticated or service_role) never
-- touch notification / push_subscription tables directly.

-- Insert one notification row.
CREATE OR REPLACE FUNCTION notify_insert(
  p_user_id  uuid,
  p_type     text,
  p_title    text,
  p_body     text,
  p_data     jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, body, data)
  VALUES (p_user_id, p_type, p_title, p_body, p_data);
END;
$$;

-- Return all user_ids that are managers.
CREATE OR REPLACE FUNCTION notify_get_manager_ids()
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT m.user_id FROM managers m;
END;
$$;

-- Return push subscriptions for a specific user.
CREATE OR REPLACE FUNCTION notify_get_push_subs(p_user_id uuid)
RETURNS TABLE (endpoint text, p256dh text, auth_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT ps.endpoint, ps.p256dh, ps.auth_key
    FROM push_subscriptions ps
    WHERE ps.user_id = p_user_id;
END;
$$;

-- Delete stale push subscriptions for a user.
CREATE OR REPLACE FUNCTION notify_delete_subs(p_user_id uuid, p_endpoints text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM push_subscriptions
  WHERE user_id = p_user_id
    AND endpoint = ANY(p_endpoints);
END;
$$;

-- Grant execute to authenticated users and service_role.
GRANT EXECUTE ON FUNCTION notify_insert(uuid, text, text, text, jsonb)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION notify_get_manager_ids()                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION notify_get_push_subs(uuid)                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION notify_delete_subs(uuid, text[])                TO authenticated, service_role;
