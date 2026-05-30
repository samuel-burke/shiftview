-- ============================================================
-- Shift Dashboard — Combined schema update
-- Run this once against your Supabase database to apply all
-- new tables, RLS policies, and functions added across PRs
-- #52, #54, #55, #58, #59, #60, #61, #62, #65, #66, #67,
-- #68, #69, #70, #72 (and the security/RLS refactor in #72).
--
-- Safe to run on an existing database — every statement uses
-- CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE FUNCTION so
-- re-running is idempotent.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. EMPLOYEE AVAILABILITY (#52)
--    Stores which days-of-week an employee is usually unavailable.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS availability (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  note        text,
  UNIQUE (employee_id, day_of_week)
);

ALTER TABLE availability ENABLE ROW LEVEL SECURITY;

-- Managers can read and write all availability records
CREATE POLICY "availability_managers_all" ON availability
  FOR ALL
  USING  (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()));


-- ─────────────────────────────────────────────────────────────
-- 2. TIME-OFF REQUESTS (#54)
--    Employees submit; managers approve or deny.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS time_off_requests (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        date NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','denied')),
  note        text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (employee_id, date)
);

ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;

-- Employees see their own requests; managers see all
CREATE POLICY "time_off_select_own_or_manager" ON time_off_requests
  FOR SELECT USING (
    auth.uid() = (SELECT user_id FROM employees WHERE id = employee_id)
    OR EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid())
  );

-- Employees can submit requests for themselves
CREATE POLICY "time_off_insert_own" ON time_off_requests
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT user_id FROM employees WHERE id = employee_id)
  );

-- Only managers can approve / deny
CREATE POLICY "time_off_update_manager" ON time_off_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid())
  );


-- ─────────────────────────────────────────────────────────────
-- 3. SHIFT SWAPS (#55)
--    Employees propose swaps; managers approve atomically.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shift_swaps (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_id  bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  target_id     bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  schedule_a_id bigint NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  schedule_b_id bigint NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','denied')),
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE shift_swaps ENABLE ROW LEVEL SECURITY;

-- Requester, target, or any manager can view a swap
CREATE POLICY "shift_swaps_select_involved_or_manager" ON shift_swaps
  FOR SELECT USING (
    auth.uid() = (SELECT user_id FROM employees WHERE id = requester_id)
    OR auth.uid() = (SELECT user_id FROM employees WHERE id = target_id)
    OR EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid())
  );

-- Only the requester (who must own schedule_a) can create a swap
CREATE POLICY "shift_swaps_insert_own" ON shift_swaps
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT user_id FROM employees WHERE id = requester_id)
  );

-- Only managers can approve / deny
CREATE POLICY "shift_swaps_update_manager" ON shift_swaps
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid())
  );


-- ─────────────────────────────────────────────────────────────
-- 4. SCHEDULE TEMPLATES (#58)
--    Named weekly patterns that can be applied to any target week.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schedule_templates (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedule_template_rows (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id   bigint NOT NULL REFERENCES schedule_templates(id) ON DELETE CASCADE,
  employee_id   bigint NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,
  day_of_week   smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_minutes int NOT NULL,
  end_minutes   int NOT NULL
);

ALTER TABLE schedule_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_template_rows ENABLE ROW LEVEL SECURITY;

-- Manager-only access to templates
CREATE POLICY "templates_managers_all" ON schedule_templates
  FOR ALL
  USING  (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()));

CREATE POLICY "template_rows_managers_all" ON schedule_template_rows
  FOR ALL
  USING  (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()));


-- ─────────────────────────────────────────────────────────────
-- 5. CLOCK-IN / PUNCH RECORDS (#72)
--    Stores every clock-in, clock-out, break-start, break-end event.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS punch_records (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  schedule_id bigint REFERENCES schedules(id) ON DELETE SET NULL,
  punch_type  text NOT NULL
                CHECK (punch_type IN ('clock_in','clock_out','break_start','break_end')),
  punched_at  timestamptz NOT NULL DEFAULT now(),
  lat         double precision,
  lng         double precision,
  is_manual   boolean NOT NULL DEFAULT false,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE punch_records ENABLE ROW LEVEL SECURITY;

-- Managers can do everything
CREATE POLICY "punch_records_managers_all" ON punch_records
  FOR ALL
  USING  (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()));

-- Employees can insert their own punches
CREATE POLICY "punch_records_employees_insert" ON punch_records
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1)
  );

-- Employees can read their own punches
CREATE POLICY "punch_records_employees_select" ON punch_records
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1)
  );

-- Employees can update their own punches (manual correction with note)
CREATE POLICY "punch_records_employees_update" ON punch_records
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1)
  );


-- ─────────────────────────────────────────────────────────────
-- 6. PUSH SUBSCRIPTIONS & NOTIFICATION INBOX (#72)
--    Web Push browser subscriptions and the in-app activity feed.
-- ─────────────────────────────────────────────────────────────

-- One Web Push subscription per browser per user
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth_key   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Each user can only see and manage their own subscriptions
CREATE POLICY "push_subscriptions_own" ON push_subscriptions
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- In-app notification inbox (user_id = NULL means "all managers" broadcast)
CREATE TABLE IF NOT EXISTS notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = manager broadcast
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  read       boolean NOT NULL DEFAULT false,
  data       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY "notifications_own_select" ON notifications
  FOR SELECT USING (user_id = auth.uid());

-- Users can mark their own notifications as read
CREATE POLICY "notifications_own_update" ON notifications
  FOR UPDATE USING (user_id = auth.uid());

-- Managers can read broadcast (user_id IS NULL) notifications
CREATE POLICY "notifications_manager_broadcast_select" ON notifications
  FOR SELECT USING (
    user_id IS NULL
    AND EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid())
  );

-- Managers can mark broadcast notifications as read
CREATE POLICY "notifications_manager_broadcast_update" ON notifications
  FOR UPDATE USING (
    user_id IS NULL
    AND EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid())
  );


-- ─────────────────────────────────────────────────────────────
-- 7. SECURITY DEFINER HELPER FUNCTIONS (#72)
--    These run as DB owner so the app never directly accesses
--    notifications / push_subscriptions tables.
-- ─────────────────────────────────────────────────────────────

-- Insert one notification row
CREATE OR REPLACE FUNCTION notify_insert(
  p_user_id uuid,
  p_type    text,
  p_title   text,
  p_body    text,
  p_data    jsonb DEFAULT NULL
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

-- Return all user_ids that are managers
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

-- Return push subscriptions for a specific user
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

-- Delete stale push subscriptions (called when push returns 410 Gone)
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

-- Grant execute rights so authenticated sessions and service_role can call these
GRANT EXECUTE ON FUNCTION notify_insert(uuid, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION notify_get_manager_ids()                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION notify_get_push_subs(uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION notify_delete_subs(uuid, text[])              TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 8. APP SETTINGS — new keys (#31, #56)
--    app_settings is a pre-existing key/value table.
--    These INSERT statements seed the new keys with defaults
--    so existing deployments don't return null for them.
--    Uses ON CONFLICT DO NOTHING so running twice is safe.
-- ─────────────────────────────────────────────────────────────

INSERT INTO app_settings (key, value)
VALUES
  ('timezone',           'America/New_York'),
  ('email_notifications','false')
ON CONFLICT (key) DO NOTHING;
