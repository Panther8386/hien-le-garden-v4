PRAGMA foreign_keys=OFF;

CREATE TABLE finance_transactions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category TEXT NOT NULL CHECK (category IN (
    'cay_giong', 'vat_tu', 'nhan_cong', 'van_chuyen', 'bao_tri', 'thuc_pham', 'am_thuc_lien_ket', 'khac',
    'ban_hang', 'dich_vu', 'bep_hien_le', 'hien_le_drinks', 'hh_am_thuc_lien_ket'
  )),
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT,
  transaction_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'paid')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  voided_by TEXT,
  voided_at TEXT,
  receipt_key TEXT,
  receipt_filename TEXT,
  receipt_uploaded_at TEXT
);

INSERT INTO finance_transactions_new
  (id, type, category, amount, note, transaction_date, status, created_by, created_at, updated_by, updated_at, voided_by, voided_at)
  SELECT id, type, category, amount, note, transaction_date, status, created_by, created_at, updated_by, updated_at, voided_by, voided_at
  FROM finance_transactions;

DROP TABLE finance_transactions;
ALTER TABLE finance_transactions_new RENAME TO finance_transactions;

CREATE INDEX idx_finance_transactions_date ON finance_transactions(transaction_date);
CREATE INDEX idx_finance_transactions_status ON finance_transactions(status);

-- Explicitly carry the AUTOINCREMENT high-water mark forward so the next
-- genuinely-new transaction can never reuse an id from the pre-rebuild table.
INSERT OR REPLACE INTO sqlite_sequence (name, seq)
  VALUES ('finance_transactions', (SELECT COALESCE(MAX(id), 0) FROM finance_transactions));

PRAGMA foreign_keys=ON;
