ALTER TABLE bookings ADD COLUMN checkout_payment_method TEXT;
ALTER TABLE booking_service_items ADD COLUMN finance_transaction_id INTEGER REFERENCES finance_transactions(id);

INSERT INTO finance_categories (slug, label, type, is_active, created_by, created_at)
VALUES ('hoan_coc', 'Hoàn cọc', 'expense', 1, 'system', '2026-09-08T00:00:00Z');
