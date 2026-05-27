-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_settings (key, value) VALUES
  ('first_day_of_week', '6'),
  ('optimal_coverage',  '3'),
  ('minimum_coverage',  '2')
ON CONFLICT (key) DO NOTHING;
