-- v4/migrations/0009_service_catalog_and_cancellation_policy.sql

CREATE TABLE service_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('luu_tru', 'fnb_hoat_dong', 'su_kien_team_building')),
  subgroup TEXT,
  name TEXT NOT NULL,
  price_type TEXT NOT NULL CHECK (price_type IN ('range', 'fixed', 'label')),
  price_min INTEGER,
  price_max INTEGER,
  price_label TEXT,
  unit_capacity TEXT,
  note TEXT,
  room_type_key TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_service_catalog_category ON service_catalog(category, is_active, display_order);

CREATE TABLE cancellation_policy_tier (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  min_days_before_checkin INTEGER NOT NULL CHECK (min_days_before_checkin >= 0),
  refund_percent INTEGER NOT NULL CHECK (refund_percent >= 0 AND refund_percent <= 100),
  label TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_cancellation_policy_days ON cancellation_policy_tier(min_days_before_checkin);

ALTER TABLE bookings ADD COLUMN refund_percent_applied INTEGER;

INSERT INTO service_catalog (category, subgroup, name, price_type, price_min, price_max, price_label, unit_capacity, note, room_type_key, display_order, is_active, updated_by, updated_at) VALUES
('luu_tru', 'Lưu Trú Theo Đêm', 'Triangle House (Tiêu Chuẩn)', 'fixed', 300000, NULL, NULL, '2–3 người', 'View vườn, giường đôi', 'triangle', 1, 1, 'system', '2026-08-28T00:00:00Z'),
('luu_tru', 'Lưu Trú Theo Đêm', 'Circle House — Superior', 'fixed', 600000, NULL, NULL, '2–4 người', 'View hồ, tiện nghi cao cấp hơn', 'circle', 2, 1, 'system', '2026-08-28T00:00:00Z'),
('luu_tru', 'Lưu Trú Theo Đêm', 'E Đê Cozy — Deluxe', 'fixed', 600000, NULL, NULL, '2–4 người', 'Bao gồm bữa sáng', 'ede_cozy', 3, 1, 'system', '2026-08-28T00:00:00Z'),
('luu_tru', 'Lưu Trú Theo Đêm', 'VIP House — Premium Garden View', 'fixed', 900000, NULL, NULL, '3–5 người', 'Sân hiên riêng, view tốt nhất', 'vip', 4, 1, 'system', '2026-08-28T00:00:00Z'),
('luu_tru', 'Lưu Trú Theo Đêm', 'Bungalow Gia Đình', 'fixed', 700000, NULL, NULL, '4–6 người', 'Phòng rộng, full amenities', 'bungalow', 5, 1, 'system', '2026-08-28T00:00:00Z'),
('luu_tru', 'Lưu Trú Theo Đêm', 'Phòng Tập Thể', 'fixed', 1200000, NULL, NULL, '4–8 người', 'Giá trọn phòng theo đêm, giường tầng', 'dormitory', 6, 1, 'system', '2026-08-28T00:00:00Z'),
('luu_tru', 'Thuê Theo Giờ', 'Giờ Đầu Tiên', 'fixed', 130000, NULL, NULL, '1 giờ', 'Áp dụng toàn bộ loại phòng', NULL, 7, 1, 'system', '2026-08-28T00:00:00Z'),
('luu_tru', 'Thuê Theo Giờ', 'Combo 2 Giờ', 'fixed', 200000, NULL, NULL, '2 giờ', 'Tiết kiệm hơn giờ lẻ', NULL, 8, 1, 'system', '2026-08-28T00:00:00Z'),
('luu_tru', 'Thuê Theo Giờ', 'Giờ Phát Sinh Thêm', 'fixed', 60000, NULL, NULL, '/ giờ thêm', 'Sau combo 2H', NULL, 9, 1, 'system', '2026-08-28T00:00:00Z'),
('fnb_hoat_dong', NULL, 'Cà phê & Nước uống', 'range', 30000, 80000, NULL, '/ phần', 'Quán cà phê tại chỗ', NULL, 1, 1, 'system', '2026-08-28T00:00:00Z'),
('fnb_hoat_dong', NULL, 'Ăn uống theo yêu cầu', 'range', 120000, 300000, NULL, '/ người / bữa', 'Đặt trước 24h', NULL, 2, 1, 'system', '2026-08-28T00:00:00Z'),
('fnb_hoat_dong', NULL, 'Đốt lửa trại (Campfire)', 'range', 500000, 1000000, NULL, '/ buổi nhóm', 'Bao gồm củi, setup, 10–50 người', NULL, 3, 1, 'system', '2026-08-28T00:00:00Z'),
('fnb_hoat_dong', NULL, 'Hái trái cây tại vườn', 'range', 50000, 100000, NULL, '/ người', 'Theo mùa', NULL, 4, 1, 'system', '2026-08-28T00:00:00Z'),
('fnb_hoat_dong', NULL, 'Chụp ảnh / Check-in', 'range', 200000, 500000, NULL, '/ buổi', 'Sử dụng cảnh quan nông trại', NULL, 5, 1, 'system', '2026-08-28T00:00:00Z'),
('fnb_hoat_dong', NULL, 'Cắm trại qua đêm', 'range', 200000, 400000, NULL, '/ đêm / người', 'Lều tự mang hoặc thuê', NULL, 6, 1, 'system', '2026-08-28T00:00:00Z'),
('fnb_hoat_dong', NULL, 'Nông nghiệp trải nghiệm', 'range', 100000, 200000, NULL, '/ người', 'Trồng rau, chăm sóc cây', NULL, 7, 1, 'system', '2026-08-28T00:00:00Z'),
('fnb_hoat_dong', NULL, 'Khu vui chơi trẻ em', 'label', NULL, NULL, 'Miễn phí', '—', 'Tiện ích kèm theo', NULL, 8, 1, 'system', '2026-08-28T00:00:00Z'),
('su_kien_team_building', NULL, 'Team Building / Sự kiện nhỏ', 'range', 3000000, 5000000, NULL, '20–50 người', 'Cần đặt trước, tùy chỉnh theo yêu cầu', NULL, 1, 1, 'system', '2026-08-28T00:00:00Z'),
('su_kien_team_building', NULL, 'Sự kiện doanh nghiệp lớn', 'range', 5000000, 10000000, NULL, '50–100 người', 'Setup đầy đủ, tùy chỉnh theo công ty', NULL, 2, 1, 'system', '2026-08-28T00:00:00Z'),
('su_kien_team_building', NULL, 'Bán nông sản & sản phẩm', 'label', NULL, NULL, 'Theo giá thị trường', '—', 'Cà phê, rau củ, trái cây tươi', NULL, 3, 1, 'system', '2026-08-28T00:00:00Z');
