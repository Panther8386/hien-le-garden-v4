ALTER TABLE staff_accounts ADD COLUMN can_delete_deposit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE booking_deposits ADD COLUMN voided_by TEXT;
ALTER TABLE booking_deposits ADD COLUMN voided_at TEXT;
