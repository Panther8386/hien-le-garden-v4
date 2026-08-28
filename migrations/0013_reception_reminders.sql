ALTER TABLE rooms ADD COLUMN needs_cleaning_since TEXT;

CREATE TABLE reminder_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pending_deposit_hours INTEGER NOT NULL DEFAULT 2,
  cleaning_minutes INTEGER NOT NULL DEFAULT 60,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO reminder_settings (pending_deposit_hours, cleaning_minutes, updated_at)
VALUES (2, 60, '2026-08-28T00:00:00Z');
