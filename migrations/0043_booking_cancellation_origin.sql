ALTER TABLE bookings ADD COLUMN cancellation_origin TEXT CHECK (cancellation_origin IN ('hotel', 'guest'));
ALTER TABLE bookings ADD COLUMN cancellation_request_source TEXT CHECK (cancellation_request_source IN ('phone', 'zalo', 'in_person', 'unknown'));
ALTER TABLE bookings ADD COLUMN cancellation_requested_at TEXT;
ALTER TABLE bookings ADD COLUMN cancelled_at TEXT;
ALTER TABLE bookings ADD COLUMN cancelled_by TEXT;
