ALTER TABLE bookings ADD COLUMN checkout_payment_method TEXT;
ALTER TABLE booking_service_items ADD COLUMN finance_transaction_id INTEGER REFERENCES finance_transactions(id);

INSERT INTO finance_categories (slug, label, type, is_active, display_order, created_by, created_at)
VALUES ('hoan_coc', 'Hoàn cọc', 'expense', 1, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM finance_categories WHERE type = 'expense'), 'system', '2026-09-08T00:00:00Z');
