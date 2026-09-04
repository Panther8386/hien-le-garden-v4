-- v4/migrations/0021_dine_in_orders.sql

CREATE TABLE dine_in_menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('mon_an', 'do_uong')),
  price INTEGER NOT NULL CHECK (price > 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_dine_in_menu_items_active ON dine_in_menu_items(is_active, category, display_order);

CREATE TABLE dine_in_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_label TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'voided')) DEFAULT 'open',
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT,
  payment_method TEXT CHECK (payment_method IN ('cash', 'transfer')),
  total_amount INTEGER,
  finance_transaction_id INTEGER REFERENCES finance_transactions(id)
);
CREATE INDEX idx_dine_in_orders_status ON dine_in_orders(status, opened_at);

CREATE TABLE dine_in_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES dine_in_orders(id),
  menu_item_id INTEGER REFERENCES dine_in_menu_items(id),
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
CREATE INDEX idx_dine_in_order_items_order ON dine_in_order_items(order_id, status);

INSERT OR IGNORE INTO finance_categories (slug, label, type, is_active, created_by, created_at, updated_by, updated_at)
VALUES ('khach_vang_lai', 'Khách vãng lai', 'income', 1, 'system', '2026-09-04T00:00:00Z', 'system', '2026-09-04T00:00:00Z');
