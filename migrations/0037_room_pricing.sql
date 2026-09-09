ALTER TABLE rooms ADD COLUMN price_weekday INTEGER;
ALTER TABLE rooms ADD COLUMN price_weekend INTEGER;

CREATE TABLE holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_holidays_range ON holidays(start_date, end_date);
