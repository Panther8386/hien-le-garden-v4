CREATE TABLE asset_inventory_food_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES asset_categories(id),
  location_id INTEGER NOT NULL REFERENCES asset_locations(id),
  received_date TEXT,
  expiry_date TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_asset_inventory_food_lots_category ON asset_inventory_food_lots(category_id, location_id);
CREATE INDEX idx_asset_inventory_food_lots_expiry ON asset_inventory_food_lots(expiry_date);
