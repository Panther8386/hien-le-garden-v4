-- v4/migrations/0029_asset_inventory_phase3a_assets.sql

CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES asset_categories(id),
  internal_code TEXT UNIQUE,
  name TEXT NOT NULL,
  brand TEXT,
  serial_number TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('handover_a', 'purchased_b', 'other')),
  source_row_id INTEGER REFERENCES asset_source_rows(id),
  acquired_date TEXT,
  purchase_price INTEGER,
  location_id INTEGER REFERENCES asset_locations(id),
  holder TEXT,
  quantity INTEGER,
  physical_condition TEXT NOT NULL DEFAULT 'chua_danh_gia' CHECK (physical_condition IN ('tot', 'kha', 'trung_binh', 'can_sua', 'chua_danh_gia')),
  operational_status TEXT NOT NULL DEFAULT 'san_sang' CHECK (operational_status IN ('san_sang', 'dang_su_dung', 'ngung_su_dung', 'dang_sua')),
  lifecycle_status TEXT NOT NULL DEFAULT 'dang_quan_ly' CHECK (lifecycle_status IN ('dang_quan_ly', 'da_hoan_tra', 'da_thanh_ly')),
  photo_key TEXT,
  photo_filename TEXT,
  photo_uploaded_at TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
);
CREATE INDEX idx_assets_category ON assets(category_id);
CREATE INDEX idx_assets_location ON assets(location_id);
CREATE INDEX idx_assets_source_row ON assets(source_row_id);
