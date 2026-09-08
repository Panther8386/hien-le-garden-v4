-- v4/migrations/0033_booking_deposits.sql

CREATE TABLE booking_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer')),
  note TEXT,
  finance_transaction_id INTEGER REFERENCES finance_transactions(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_booking_deposits_booking ON booking_deposits(booking_id);
