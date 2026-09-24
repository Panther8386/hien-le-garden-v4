// Danh mục mã quyền. Nguồn sự thật lúc chạy là bảng role_permissions +
// user_permission_overrides trong D1; file này định nghĩa mã nào hợp lệ,
// nhãn hiển thị, và mặc định dùng để seed (migration 0042) + test.

export const PERMISSION_GROUPS = [
  { label: 'Vận hành & đặt phòng', permissions: [
    { key: 'bookings.view', label: 'Xem đặt phòng, sơ đồ phòng, nhắc việc' },
    { key: 'bookings.manage', label: 'Tạo / sửa / xác nhận / nhận-trả phòng / huỷ, dịch vụ, thêm cọc, đánh dấu đã dọn' },
    { key: 'bookings.edit_paid_service', label: 'Sửa / xoá dịch vụ đã thanh toán' },
    { key: 'bookings.deposit_delete', label: 'Xoá cọc' },
    { key: 'rooms.layout', label: 'Sắp xếp sơ đồ phòng' },
    { key: 'guests.contact_view', label: 'Xem SĐT / email khách' },
    { key: 'promo.redeem', label: 'Tra mã ưu đãi, đổi mã, nhận quà' },
    { key: 'records.hide', label: 'Ẩn bản ghi khỏi lịch sử, xem bản ghi đã ẩn' },
  ] },
  { label: 'Order ăn uống', permissions: [
    { key: 'dine_in.view', label: 'Xem order' },
    { key: 'dine_in.manage', label: 'Tạo / thêm món / đóng / huỷ order' },
  ] },
  { label: 'Giờ Xanh', permissions: [
    { key: 'gio_xanh.view', label: 'Xem phiên' },
    { key: 'gio_xanh.manage', label: 'Tạo / thêm món / đóng / huỷ phiên' },
  ] },
  { label: 'Khách hàng', permissions: [
    { key: 'customers.view', label: 'Xem danh sách & chi tiết khách' },
    { key: 'customers.send', label: 'Gửi tin nhắn cho khách' },
    { key: 'templates.view', label: 'Xem template tin nhắn' },
    { key: 'templates.manage', label: 'Tạo / sửa / bật-tắt template' },
    { key: 'promo_config.view', label: 'Xem cấu hình khuyến mãi, kho quà, thông báo' },
    { key: 'promo_config.manage', label: 'Sửa cấu hình khuyến mãi, kho quà' },
  ] },
  { label: 'Tài chính', permissions: [
    { key: 'dashboard.view', label: 'Xem tổng quan số liệu' },
    { key: 'finance.view_income', label: 'Xem sổ thu chi — phần thu' },
    { key: 'finance.view_all', label: 'Xem toàn bộ sổ thu chi (phần chi, cân đối, biểu đồ)' },
    { key: 'finance.create', label: 'Thêm giao dịch' },
    { key: 'finance.manage', label: 'Sửa / huỷ giao dịch, chứng từ, số dư đầu kỳ' },
  ] },
  { label: 'Kho & tài sản', permissions: [
    { key: 'assets.view', label: 'Xem tài sản, kho, kiểm kê, hồ sơ nguồn' },
    { key: 'assets.count', label: 'Kiểm kê, ghi phiếu kho' },
    { key: 'assets.manage', label: 'Tạo / sửa tài sản, mở-chốt đợt kiểm kê, đối soát' },
    { key: 'assets.delete', label: 'Xoá tài sản' },
    { key: 'assets.config', label: 'Danh mục, vị trí, lô thực phẩm' },
  ] },
  { label: 'Cài đặt', permissions: [
    { key: 'settings.view', label: 'Xem trang Phòng & giá, Bảng giá dịch vụ, Chính sách hoàn cọc' },
    { key: 'settings.rooms', label: 'Sửa giá phòng, ngày lễ' },
    { key: 'settings.catalog', label: 'Sửa bảng giá dịch vụ, khung giờ, cài đặt đặt trải nghiệm' },
    { key: 'settings.dine_in_menu', label: 'Sửa menu quán' },
    { key: 'settings.cancellation_policy', label: 'Sửa chính sách hoàn cọc' },
    { key: 'settings.finance_categories', label: 'Sửa danh mục thu chi' },
    { key: 'settings.reminders', label: 'Sửa ngưỡng nhắc việc' },
    { key: 'audit.view', label: 'Xem nhật ký thao tác' },
    { key: 'users.manage', label: 'Quản lý tài khoản, khoá tạm, chỉnh quyền riêng' },
    { key: 'users.security', label: 'Đặt lại mật khẩu, tắt 2FA của người khác' },
  ] },
];

export const PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
const KEY_SET = new Set(PERMISSION_KEYS);

export const EDITABLE_ROLES = ['reception', 'manager', 'observer'];

const RECEPTION = [
  'bookings.view', 'bookings.manage', 'guests.contact_view', 'promo.redeem',
  'dine_in.view', 'dine_in.manage', 'gio_xanh.view', 'gio_xanh.manage',
  'customers.view', 'customers.send', 'templates.view', 'promo_config.view',
  'assets.view', 'assets.count', 'settings.view',
];

export const ROLE_DEFAULTS = {
  reception: RECEPTION,
  manager: [
    ...RECEPTION,
    'templates.manage', 'promo_config.manage', 'dashboard.view',
    'finance.view_income', 'finance.view_all', 'finance.create', 'finance.manage',
    'assets.manage', 'audit.view', 'users.manage',
  ],
  observer: ['bookings.view', 'finance.view_income'],
};

export function isValidPermission(key) {
  return KEY_SET.has(key);
}

export function effectivePermissions(role, rolePermissions, overrides) {
  if (role === 'admin') return new Set(PERMISSION_KEYS);
  const set = new Set(rolePermissions.filter(isValidPermission));
  for (const { permission, effect } of overrides) {
    if (!isValidPermission(permission)) continue;
    if (effect === 'grant') set.add(permission);
    else if (effect === 'deny') set.delete(permission);
  }
  return set;
}

export function hasPermission(auth, key) {
  return auth.permissions.has(key);
}
