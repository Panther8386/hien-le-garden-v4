// v4/admin/audit-log.js
const ACTION_TYPE_LABELS = {
  deposit_change: 'Đổi tiền cọc',
  booking_cancel: 'Huỷ đặt phòng',
  booking_reject: 'Từ chối đặt phòng',
  service_void: 'Huỷ dịch vụ',
  account_role_change: 'Đổi vai trò tài khoản',
  account_permission_change: 'Đổi quyền sắp xếp phòng',
  account_password_reset: 'Đặt lại mật khẩu',
  account_delete: 'Xoá tài khoản',
};

function formatVnd(n) {
  return `${Number(n).toLocaleString('vi-VN')} đ`;
}

function formatValue(actionType, value) {
  if (value == null) return '';
  if (actionType === 'deposit_change' && /^\d+$/.test(value)) return formatVnd(value);
  return value;
}

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
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
    tdType.textContent = ACTION_TYPE_LABELS[entry.actionType] || entry.actionType;

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
