-- v4/migrations/0010_booking_service_items.sql

CREATE TABLE booking_service_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  service_catalog_id INTEGER REFERENCES service_catalog(id),
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('posted', 'voided')) DEFAULT 'posted',
  created_by TEXT,
  created_at TEXT NOT NULL,
  voided_by TEXT,
  voided_at TEXT
);

CREATE INDEX idx_booking_service_items_booking ON booking_service_items(booking_id, status);
