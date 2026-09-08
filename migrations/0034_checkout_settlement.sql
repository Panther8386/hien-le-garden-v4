ALTER TABLE bookings ADD COLUMN checkout_payment_method TEXT;
ALTER TABLE booking_service_items ADD COLUMN finance_transaction_id INTEGER REFERENCES finance_transactions(id);

-- OR IGNORE: production D1 already has a manually-created 'hoan_coc' category
-- (added by the user directly via the admin UI before this migration was written,
-- id 29, display_order 16) — this must be a no-op there, while still seeding the
-- row on any environment (local/test) that doesn't have it yet.
INSERT OR IGNORE INTO finance_categories (slug, label, type, is_active, display_order, created_by, created_at)
VALUES ('hoan_coc', 'Hoàn cọc', 'expense', 1, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM finance_categories WHERE type = 'expense'), 'system', '2026-09-08T00:00:00Z');
