-- v4/migrations/0023_gio_xanh_sessions.sql

CREATE TABLE gio_xanh_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  guest_name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'voided')) DEFAULT 'open',
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT,
  payment_method TEXT CHECK (payment_method IN ('cash', 'transfer')),
  total_amount INTEGER,
  finance_transaction_id INTEGER REFERENCES finance_transactions(id)
);
CREATE INDEX idx_gio_xanh_sessions_status ON gio_xanh_sessions(status, opened_at);
CREATE INDEX idx_gio_xanh_sessions_room ON gio_xanh_sessions(room_id, status);

CREATE TABLE gio_xanh_session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES gio_xanh_sessions(id),
  source TEXT NOT NULL CHECK (source IN ('gio_combo', 'mon_an_uong')),
  source_id INTEGER,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('posted', 'voided')) DEFAULT 'posted',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_by TEXT,
  voided_at TEXT
);
CREATE INDEX idx_gio_xanh_session_items_session ON gio_xanh_session_items(session_id, status);
