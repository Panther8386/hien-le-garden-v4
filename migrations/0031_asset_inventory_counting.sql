-- v4/migrations/0031_asset_inventory_counting.sql

CREATE TABLE asset_inventory_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL REFERENCES asset_locations(id),
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'counting', 'pending_close', 'closed')) DEFAULT 'draft',
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT
);
CREATE INDEX idx_asset_inventory_batches_location ON asset_inventory_batches(location_id, status);

CREATE TABLE asset_inventory_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES asset_inventory_batches(id),
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  book_quantity INTEGER,
  actual_quantity INTEGER,
  condition_found TEXT,
  photo_key TEXT,
  photo_filename TEXT,
  photo_uploaded_at TEXT,
  note TEXT,
  suggested_action TEXT,
  updated_by TEXT,
  updated_at TEXT,
  UNIQUE(batch_id, asset_id)
);
CREATE INDEX idx_asset_inventory_lines_batch ON asset_inventory_lines(batch_id);

ALTER TABLE assets ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
