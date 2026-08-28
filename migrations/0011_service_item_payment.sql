ALTER TABLE booking_service_items ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE booking_service_items ADD COLUMN payment_method TEXT;
