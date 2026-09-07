-- v4/migrations/0027_asset_inventory_phase2_catalogs.sql

CREATE TABLE asset_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  management_type TEXT NOT NULL CHECK (management_type IN (
    'infrastructure', 'individual_device', 'device_set', 'durable_goods',
    'linen', 'consumable', 'spare_part', 'food_beverage'
  )),
  name TEXT NOT NULL,
  default_unit TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
);

CREATE TABLE asset_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_type TEXT NOT NULL CHECK (location_type IN ('room', 'warehouse', 'common_area')),
  room_id INTEGER REFERENCES rooms(id),
  code TEXT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  CHECK (
    (location_type = 'room' AND room_id IS NOT NULL) OR
    (location_type != 'room' AND room_id IS NULL)
  )
);
CREATE UNIQUE INDEX idx_asset_locations_room_id ON asset_locations(room_id) WHERE room_id IS NOT NULL;

CREATE TABLE asset_source_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  contract_ref TEXT,
  document_date TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE asset_source_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_document_id INTEGER NOT NULL REFERENCES asset_source_documents(id),
  source_group_label TEXT NOT NULL,
  stt INTEGER NOT NULL,
  raw_name TEXT NOT NULL,
  raw_unit TEXT,
  raw_quantity TEXT,
  raw_condition TEXT,
  raw_note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_document_id, stt)
);
