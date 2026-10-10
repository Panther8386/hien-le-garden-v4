-- Explicit checkout provenance; historical manual receipts stay unlinked.
ALTER TABLE finance_transactions ADD COLUMN checkout_booking_id INTEGER REFERENCES bookings(id);
CREATE INDEX idx_finance_checkout_booking ON finance_transactions(checkout_booking_id);
