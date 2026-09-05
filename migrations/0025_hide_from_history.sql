-- v4/migrations/0025_hide_from_history.sql

ALTER TABLE gio_xanh_sessions ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dine_in_orders ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
