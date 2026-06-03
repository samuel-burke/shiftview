-- Geofence settings for enforced clock-in location radius
INSERT INTO app_settings (key, value) VALUES
  ('geofence_enabled', 'false'),
  ('geofence_lat',     ''),
  ('geofence_lng',     ''),
  ('geofence_radius',  '100'),
  ('geofence_address', '')
ON CONFLICT (key) DO NOTHING;
