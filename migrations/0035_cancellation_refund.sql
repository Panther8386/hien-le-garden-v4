ALTER TABLE bookings ADD COLUMN refund_finance_transaction_id INTEGER REFERENCES finance_transactions(id);
ALTER TABLE bookings ADD COLUMN cancel_refund_payment_method TEXT;
