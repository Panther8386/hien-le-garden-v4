CREATE TABLE finance_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
);

CREATE INDEX idx_finance_categories_type ON finance_categories(type);

INSERT INTO finance_categories (slug, label, type, is_active, created_by, created_at) VALUES
  ('cay_giong', 'Cây giống', 'expense', 1, 'system', '2026-09-03T00:00:00Z'),
  ('vat_tu', 'Vật tư', 'expense', 1, 'system', '2026-09-03T00:00:00Z'),
  ('nhan_cong', 'Nhân công', 'expense', 1, 'system', '2026-09-03T00:00:00Z'),
  ('van_chuyen', 'Vận chuyển', 'expense', 1, 'system', '2026-09-03T00:00:00Z'),
  ('bao_tri', 'Bảo trì', 'expense', 1, 'system', '2026-09-03T00:00:00Z'),
  ('thuc_pham', 'Thực phẩm', 'expense', 1, 'system', '2026-09-03T00:00:00Z'),
  ('am_thuc_lien_ket', 'Ẩm thực liên kết', 'expense', 1, 'system', '2026-09-03T00:00:00Z'),
  ('khac', 'Chi phí khác', 'expense', 1, 'system', '2026-09-03T00:00:00Z'),
  ('ban_hang', 'Dịch vụ khác', 'income', 1, 'system', '2026-09-03T00:00:00Z'),
  ('dich_vu', 'Lưu trú Hiền Lê', 'income', 1, 'system', '2026-09-03T00:00:00Z'),
  ('bep_hien_le', 'Bếp Hiền Lê', 'income', 1, 'system', '2026-09-03T00:00:00Z'),
  ('hien_le_drinks', 'Hiền Lê Drinks', 'income', 1, 'system', '2026-09-03T00:00:00Z'),
  ('hh_am_thuc_lien_ket', 'HH Ẩm thực liên kết', 'income', 1, 'system', '2026-09-03T00:00:00Z'),
  ('gio_xanh_hien_le', 'Giờ xanh Hiền Lê', 'income', 1, 'system', '2026-09-03T00:00:00Z');
