-- v4/migrations/0014_experience_slots.sql
ALTER TABLE service_catalog ADD COLUMN is_scheduled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE service_catalog ADD COLUMN terms_and_conditions TEXT;

CREATE TABLE service_slot_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_catalog_id INTEGER NOT NULL REFERENCES service_catalog(id),
  label TEXT,
  days_of_week TEXT NOT NULL,
  start_time TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_service_slot_template_catalog ON service_slot_template(service_catalog_id, is_active);

CREATE TABLE experience_booking_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_window_days INTEGER NOT NULL DEFAULT 14,
  max_suggestions INTEGER NOT NULL DEFAULT 5,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO experience_booking_settings (suggestion_window_days, max_suggestions, updated_at)
VALUES (14, 5, '2026-08-29T00:00:00Z');

ALTER TABLE booking_service_items ADD COLUMN experience_date TEXT;
ALTER TABLE booking_service_items ADD COLUMN slot_template_id INTEGER REFERENCES service_slot_template(id);
ALTER TABLE booking_service_items ADD COLUMN experience_slot_label TEXT;
ALTER TABLE booking_service_items ADD COLUMN experience_start_time TEXT;
ALTER TABLE booking_service_items ADD COLUMN terms_accepted_at TEXT;
