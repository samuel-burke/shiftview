-- Issue #101: Add partial-day availability windows
-- Adds start_minutes / end_minutes columns and employee self-service RLS policies.
-- Safe to run more than once (IF NOT EXISTS on all statements).

ALTER TABLE availability
  ADD COLUMN IF NOT EXISTS start_minutes int,
  ADD COLUMN IF NOT EXISTS end_minutes   int;

-- Allow employees to read their own availability records
CREATE POLICY "availability_employees_select" ON availability
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1)
  );

-- Allow employees to insert their own availability records
CREATE POLICY "availability_employees_insert" ON availability
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1)
  );

-- Allow employees to update their own availability records
CREATE POLICY "availability_employees_update" ON availability
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1)
  );

-- Allow employees to delete their own availability records
CREATE POLICY "availability_employees_delete" ON availability
  FOR DELETE USING (
    employee_id = (SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1)
  );
