-- Per-user push notification type preferences
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id              UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  late_punch_alerts    BOOLEAN NOT NULL DEFAULT true,
  message_alerts       BOOLEAN NOT NULL DEFAULT true,
  pto_alerts           BOOLEAN NOT NULL DEFAULT true,
  new_shift_alerts     BOOLEAN NOT NULL DEFAULT true,
  shift_change_alerts  BOOLEAN NOT NULL DEFAULT true,
  swap_alerts          BOOLEAN NOT NULL DEFAULT true,
  shift_reminder_alerts BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_notification_prefs"
  ON user_notification_preferences
  FOR ALL
  USING (auth.uid() = user_id);

-- SECURITY DEFINER so server-side notify functions can read any user's prefs
-- Returns defaults (all true) if no row exists for the user
CREATE OR REPLACE FUNCTION notify_get_push_prefs(p_user_id UUID)
RETURNS TABLE (
  late_punch_alerts     BOOLEAN,
  message_alerts        BOOLEAN,
  pto_alerts            BOOLEAN,
  new_shift_alerts      BOOLEAN,
  shift_change_alerts   BOOLEAN,
  swap_alerts           BOOLEAN,
  shift_reminder_alerts BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(late_punch_alerts, true),
    COALESCE(message_alerts, true),
    COALESCE(pto_alerts, true),
    COALESCE(new_shift_alerts, true),
    COALESCE(shift_change_alerts, true),
    COALESCE(swap_alerts, true),
    COALESCE(shift_reminder_alerts, true)
  FROM user_notification_preferences
  WHERE user_id = p_user_id
  UNION ALL
  SELECT true, true, true, true, true, true, true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION notify_get_push_prefs(UUID) TO authenticated;
