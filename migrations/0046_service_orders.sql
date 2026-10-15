-- Service orders (catering on request, events, parties) with deposits recorded
-- in each revenue line, and a versioned quote template. Additive only.

CREATE TABLE service_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creation_key TEXT NOT NULL UNIQUE,
  order_type TEXT NOT NULL CHECK (order_type IN ('an_uong_theo_yeu_cau', 'su_kien', 'dat_tiec', 'khac')),
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  organization TEXT,
  note TEXT,
  event_date TEXT NOT NULL,
  event_time TEXT,
  guest_count INTEGER CHECK (guest_count IS NULL OR guest_count > 0),
  venue_note TEXT,
  booking_id INTEGER REFERENCES bookings(id),
  primary_category TEXT NOT NULL,
  deposit_amount INTEGER NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  quote_valid_days INTEGER NOT NULL CHECK (quote_valid_days BETWEEN 1 AND 365),
  requested_deposit INTEGER NOT NULL DEFAULT 0 CHECK (requested_deposit >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'settled', 'cancelled')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT,
  settled_by TEXT,
  settled_at TEXT,
  settlement_payment_method TEXT CHECK (settlement_payment_method IN ('cash', 'transfer')),
  cancelled_by TEXT,
  cancelled_at TEXT,
  cancellation_origin TEXT CHECK (cancellation_origin IN ('hotel', 'guest')),
  cancel_reason TEXT,
  refund_amount INTEGER CHECK (refund_amount IS NULL OR refund_amount >= 0),
  refund_payment_method TEXT CHECK (refund_payment_method IN ('cash', 'transfer')),
  refund_finance_transaction_id INTEGER REFERENCES finance_transactions(id),
  is_hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_service_orders_status_date ON service_orders(status, event_date);
CREATE INDEX idx_service_orders_booking ON service_orders(booking_id);

CREATE TABLE service_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES service_orders(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  finance_category TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_service_order_items_order ON service_order_items(order_id);

CREATE TABLE service_order_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES service_orders(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer')),
  note TEXT,
  finance_transaction_id INTEGER REFERENCES finance_transactions(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_by TEXT,
  voided_at TEXT
);
CREATE INDEX idx_service_order_deposits_order ON service_order_deposits(order_id);

ALTER TABLE finance_transactions ADD COLUMN service_order_id INTEGER REFERENCES service_orders(id);
CREATE INDEX idx_finance_transactions_service_order ON finance_transactions(service_order_id);

CREATE TABLE quote_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL,
  address TEXT NOT NULL,
  hotline TEXT NOT NULL,
  email TEXT,
  website TEXT,
  default_valid_days INTEGER NOT NULL CHECK (default_valid_days BETWEEN 1 AND 365),
  default_deposit_percent INTEGER NOT NULL CHECK (default_deposit_percent BETWEEN 0 AND 100),
  tax_note TEXT,
  cancellation_terms TEXT,
  footer_note TEXT,
  bank_name TEXT,
  bank_account TEXT,
  bank_holder TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO quote_settings (business_name, address, hotline, email, website, default_valid_days, default_deposit_percent,
  tax_note, cancellation_terms, footer_note, bank_name, bank_account, bank_holder, updated_by, updated_at)
VALUES ('Hiền Lê Garden', 'Tổ Dân Phố 6 Bờ Đập, Nam Gia Nghĩa, Lâm Đồng', '0968 987 311', 'hello@hienlegarden.vn', 'hienlegarden.vn',
  7, 30, 'Giá trên chưa bao gồm thuế VAT',
  'Tiền cọc được hoàn hoặc giữ lại theo thoả thuận khi huỷ dịch vụ; vui lòng báo trước tối thiểu 7 ngày.',
  NULL, NULL, NULL, NULL, 'system', '2026-10-15T00:00:00Z');

INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
  ('reception', 'service_orders.view'), ('reception', 'service_orders.manage'),
  ('manager', 'service_orders.view'), ('manager', 'service_orders.manage'), ('manager', 'service_orders.refund'),
  ('manager', 'settings.quote_template'),
  ('observer', 'service_orders.view');
