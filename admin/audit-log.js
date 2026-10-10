// v4/admin/audit-log.js
const ACTION_TYPE_LABELS = {
  booking_create: 'Tạo đặt phòng',
  account_create: 'Tạo tài khoản',
  deposit_change: 'Đổi tiền cọc',
  booking_cancel: 'Huỷ đặt phòng',
  booking_reject: 'Từ chối đặt phòng',
  booking_checkout: 'Trả phòng và thanh toán',
  sale_close: 'Chốt và thanh toán order / Giờ Xanh',
  service_void: 'Huỷ dịch vụ',
  account_role_change: 'Đổi vai trò tài khoản',
  account_permission_change: 'Đổi quyền sắp xếp phòng',
  account_password_reset: 'Đặt lại mật khẩu',
  account_password_change: 'Tự đổi mật khẩu và đăng xuất mọi phiên',
  account_delete: 'Xoá tài khoản',
  finance_transaction_create: 'Tạo giao dịch thu chi',
  finance_transaction_update: 'Sửa giao dịch thu chi',
  finance_transaction_void: 'Huỷ giao dịch thu chi',
  finance_transaction_attachment_upload: 'Tải lên chứng từ thu chi',
  finance_transaction_attachment_delete: 'Xoá chứng từ thu chi',
  finance_opening_balance_set: 'Đặt số dư đầu kỳ',
  finance_category_create: 'Tạo danh mục thu chi',
  finance_category_update: 'Sửa danh mục thu chi',
  guest_identity_update: 'Cập nhật giấy tờ khách',
  dine_in_menu_item_create: 'Tạo món trong menu',
  dine_in_menu_item_update: 'Sửa món trong menu',
  dine_in_order_void: 'Huỷ bàn order ăn uống',
  gio_xanh_session_void: 'Huỷ phiên Giờ Xanh',
  record_hide: 'Ẩn/hiện bản ghi',
  asset_category_create: 'Tạo danh mục tài sản',
  asset_category_update: 'Sửa danh mục tài sản',
  asset_location_create: 'Tạo vị trí tài sản',
  asset_location_update: 'Sửa vị trí tài sản',
  asset_create: 'Tạo tài sản',
  asset_update: 'Sửa tài sản',
  asset_delete: 'Xoá tài sản',
  asset_inventory_adjustment: 'Điều chỉnh số lượng qua kiểm kê',
  deposit_delete: 'Xoá cọc',
  role_permissions_change: 'Sửa bảng quyền vai trò',
  user_permissions_change: 'Sửa quyền riêng của tài khoản',
  account_lock: 'Khoá tài khoản',
  account_unlock: 'Mở khoá tài khoản',
  '2fa_enable': 'Bật 2FA',
  '2fa_disable': 'Tắt 2FA',
  '2fa_admin_disable': 'Quản trị tắt 2FA',
  notification_destination_change: 'Đổi nơi nhận thông báo đặt phòng',
};

const RECORD_HIDE_ENTITY_LABELS = {
  gio_xanh_session: 'Ẩn/hiện phiên Giờ Xanh',
  dine_in_order: 'Ẩn/hiện bàn Order ăn uống',
  booking: 'Ẩn/hiện đặt phòng',
  finance_transaction: 'Ẩn/hiện giao dịch thu chi',
};

function formatVnd(n) {
  return `${Number(n).toLocaleString('vi-VN')} đ`;
}

function formatValue(actionType, value) {
  if (value == null) return '';
  if (actionType === 'booking_checkout' || actionType === 'sale_close') {
    if (value === 'checked_in') return 'Đang lưu trú';
    if (value === 'open') return 'Đang mở';
    try {
      const settlement = JSON.parse(value);
      if (actionType === 'booking_checkout') return `Đã trả phòng · Thu phòng ${formatVnd(settlement.roomDue)} · Thu dịch vụ ${formatVnd(settlement.servicesDue)} · Hoàn cọc ${formatVnd(settlement.refundAmount)}`;
      return `Đã thanh toán ${formatVnd(settlement.total)} · ${settlement.paymentMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}`;
    } catch { return value; }
  }
  if ((actionType === 'deposit_change' || actionType === 'deposit_delete') && /^\d+$/.test(value)) return formatVnd(value);
  return value;
}

function populateTypeFilter() {
  const select = document.getElementById('typeFilter');
  for (const [value, label] of Object.entries(ACTION_TYPE_LABELS)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
}

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
  populateTypeFilter();
  await loadLog();
})();

async function loadLog() {
  const listError = document.getElementById('listError');
  listError.textContent = '';
  const type = document.getElementById('typeFilter').value;
  const url = type ? `/api/audit-log?type=${encodeURIComponent(type)}&limit=50` : '/api/audit-log?limit=50';

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải nhật ký thao tác';
    return;
  }
  const entries = await response.json();
  renderTable(entries);
}

function renderTable(entries) {
  const tbody = document.querySelector('#logTable tbody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').classList.toggle('hidden', entries.length > 0);

  entries.forEach((entry) => {
    const tr = document.createElement('tr');

    const tdTime = document.createElement('td');
    tdTime.textContent = new Date(entry.createdAt).toLocaleString('vi-VN');

    const tdType = document.createElement('td');
    tdType.textContent = entry.actionType === 'record_hide'
      ? (RECORD_HIDE_ENTITY_LABELS[entry.entityType] || ACTION_TYPE_LABELS[entry.actionType])
      : (ACTION_TYPE_LABELS[entry.actionType] || entry.actionType);

    const tdActor = document.createElement('td');
    tdActor.textContent = entry.actor;

    const tdEntity = document.createElement('td');
    tdEntity.textContent = entry.entityLabel;

    const tdChange = document.createElement('td');
    tdChange.textContent = `${formatValue(entry.actionType, entry.oldValue)} → ${formatValue(entry.actionType, entry.newValue)}`;

    tr.append(tdTime, tdType, tdActor, tdEntity, tdChange);
    tbody.appendChild(tr);
  });
}

document.getElementById('typeFilter').addEventListener('change', loadLog);
