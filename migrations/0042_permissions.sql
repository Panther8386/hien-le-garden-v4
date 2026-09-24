-- Phân quyền theo mã quyền: bảng quyền vai trò (chỉnh được), chỉnh riêng
-- từng user, khoá tạm tài khoản. Seed = đúng hành vi trước migration, trừ
-- observer bị siết còn bookings.view + finance.view_income. Admin không có
-- dòng nào: code luôn cho admin mọi quyền.

CREATE TABLE role_permissions (
  role TEXT NOT NULL CHECK (role IN ('reception', 'manager', 'observer')),
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

CREATE TABLE user_permission_overrides (
  staff_id INTEGER NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('grant', 'deny')),
  PRIMARY KEY (staff_id, permission)
);

ALTER TABLE staff_accounts ADD COLUMN locked_at TEXT;
ALTER TABLE staff_accounts ADD COLUMN locked_by TEXT;

INSERT INTO role_permissions (role, permission) VALUES
  ('reception', 'bookings.view'), ('reception', 'bookings.manage'), ('reception', 'guests.contact_view'), ('reception', 'promo.redeem'),
  ('reception', 'dine_in.view'), ('reception', 'dine_in.manage'), ('reception', 'gio_xanh.view'), ('reception', 'gio_xanh.manage'),
  ('reception', 'customers.view'), ('reception', 'customers.send'), ('reception', 'templates.view'), ('reception', 'promo_config.view'),
  ('reception', 'assets.view'), ('reception', 'assets.count'), ('reception', 'settings.view'),
  ('manager', 'bookings.view'), ('manager', 'bookings.manage'), ('manager', 'guests.contact_view'), ('manager', 'promo.redeem'),
  ('manager', 'dine_in.view'), ('manager', 'dine_in.manage'), ('manager', 'gio_xanh.view'), ('manager', 'gio_xanh.manage'),
  ('manager', 'customers.view'), ('manager', 'customers.send'), ('manager', 'templates.view'), ('manager', 'promo_config.view'),
  ('manager', 'assets.view'), ('manager', 'assets.count'), ('manager', 'settings.view'),
  ('manager', 'templates.manage'), ('manager', 'promo_config.manage'), ('manager', 'dashboard.view'),
  ('manager', 'finance.view_income'), ('manager', 'finance.view_all'), ('manager', 'finance.create'), ('manager', 'finance.manage'),
  ('manager', 'assets.manage'), ('manager', 'audit.view'), ('manager', 'users.manage'),
  ('observer', 'bookings.view'), ('observer', 'finance.view_income');

INSERT INTO user_permission_overrides (staff_id, permission, effect) SELECT id, 'rooms.layout', 'grant' FROM staff_accounts WHERE can_manage_room_layout = 1 AND role IN ('reception', 'manager');
INSERT INTO user_permission_overrides (staff_id, permission, effect) SELECT id, 'finance.create', 'grant' FROM staff_accounts WHERE can_add_finance_transaction = 1 AND role = 'reception';
INSERT INTO user_permission_overrides (staff_id, permission, effect) SELECT id, 'assets.delete', 'grant' FROM staff_accounts WHERE can_delete_asset = 1 AND role IN ('reception', 'manager');
INSERT INTO user_permission_overrides (staff_id, permission, effect) SELECT id, 'bookings.deposit_delete', 'grant' FROM staff_accounts WHERE can_delete_deposit = 1 AND role IN ('reception', 'manager');
