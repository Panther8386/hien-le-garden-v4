CREATE TABLE asset_inventory_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES asset_categories(id),
  location_id INTEGER NOT NULL REFERENCES asset_locations(id),
  lot_id INTEGER REFERENCES asset_inventory_food_lots(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'opening', 'purchase', 'consume', 'serve', 'repair_use', 'repair_return',
    'issue', 'return', 'transfer_out', 'transfer_in',
    'damage', 'loss', 'expired', 'adjustment',
    'soil', 'send_wash', 'return_out_of_scope'
  )),
  linen_status TEXT CHECK (linen_status IN ('sach', 'cap_dung', 'ban', 'dang_giat') OR linen_status IS NULL),
  quantity_delta REAL NOT NULL,
  unit TEXT NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  recipient TEXT,
  reason TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_by TEXT,
  voided_at TEXT
);
CREATE INDEX idx_asset_inventory_transactions_stock ON asset_inventory_transactions(category_id, location_id, voided_at);
CREATE INDEX idx_asset_inventory_transactions_lot ON asset_inventory_transactions(lot_id, voided_at);
CREATE INDEX idx_asset_inventory_transactions_date ON asset_inventory_transactions(created_at);
