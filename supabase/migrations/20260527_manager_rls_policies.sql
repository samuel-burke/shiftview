-- Run this in the Supabase SQL editor
-- Grants managers write access to employees, schedules, app_settings, and store_hours

-- Helper function: returns true if the current user is in the managers table
CREATE OR REPLACE FUNCTION is_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM managers WHERE user_id = auth.uid()
  );
$$;

-- employees: anyone authenticated can read; only managers can insert/update/delete
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employees_select" ON employees
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "employees_insert" ON employees
  FOR INSERT WITH CHECK (is_manager());

CREATE POLICY "employees_update" ON employees
  FOR UPDATE USING (is_manager());

CREATE POLICY "employees_delete" ON employees
  FOR DELETE USING (is_manager());

-- schedules: authenticated users can read; managers can write
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedules_select" ON schedules
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "schedules_insert" ON schedules
  FOR INSERT WITH CHECK (is_manager());

CREATE POLICY "schedules_update" ON schedules
  FOR UPDATE USING (is_manager());

CREATE POLICY "schedules_delete" ON schedules
  FOR DELETE USING (is_manager());

-- app_settings: authenticated users can read; only managers can write
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_select" ON app_settings
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "managers_write_app_settings" ON app_settings
  FOR ALL
  USING (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM managers WHERE user_id = auth.uid()));

-- store_hours: authenticated users can read; only managers can write
ALTER TABLE store_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_hours_select" ON store_hours
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "store_hours_insert" ON store_hours
  FOR INSERT WITH CHECK (is_manager());

CREATE POLICY "store_hours_update" ON store_hours
  FOR UPDATE USING (is_manager());
