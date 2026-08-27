// crm/public/admin/manager.js
let currentRole = null;

function policyStatus(p) {
  const today = new Date().toISOString().slice(0, 10);
  if (!p.isActive) return { label: 'Đã tắt', className: 'status-policy-off' };
  if (p.validFrom > today) return { label: 'Sắp diễn ra', className: 'status-policy-pending' };
  if (p.validTo < today) return { label: 'Đã kết thúc', className: 'status-policy-ended' };
  return { label: 'Đang áp dụng', className: 'status-policy-active' };
}

async function loadPolicies() {
  const response = await fetch('/api/policy');
  const errorEl = document.getElementById('policyLoadError');
  errorEl.textContent = '';

  if (!response.ok) {
    const body = await response.json();
    errorEl.textContent = body.error || 'Có lỗi khi tải chương trình';
    return;
  }

  const policies = await response.json();
  if (!Array.isArray(policies)) {
    errorEl.textContent = 'Dữ liệu chương trình không hợp lệ';
    return;
  }

  const tbody = document.querySelector('#policyTable tbody');
  tbody.innerHTML = '';
  policies.forEach((p) => {
    const tr = document.createElement('tr');
    const tdDiscount = document.createElement('td');
    tdDiscount.textContent = p.discountPercent + '%';
    const tdFrom = document.createElement('td');
    tdFrom.textContent = p.validFrom;
    const tdTo = document.createElement('td');
    tdTo.textContent = p.validTo;
    const tdGift = document.createElement('td');
    tdGift.textContent = p.giftEnabled ? 'Có' : 'Không';
    const tdStatus = document.createElement('td');
    const status = policyStatus(p);
    const statusSpan = document.createElement('span');
    statusSpan.className = `status-badge ${status.className}`;
    statusSpan.textContent = status.label;
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdDiscount);
    tr.appendChild(tdFrom);
    tr.appendChild(tdTo);
    tr.appendChild(tdGift);
    tr.appendChild(tdStatus);

    if (currentRole === 'manager') {
      const tdDelete = document.createElement('td');
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Xoá';
      deleteBtn.className = 'btn-secondary';
      deleteBtn.addEventListener('click', () => deletePolicy(p.id));
      tdDelete.appendChild(deleteBtn);
      tr.appendChild(tdDelete);
    }

    tbody.appendChild(tr);
  });
}

async function deletePolicy(id) {
  const errorEl = document.getElementById('policyLoadError');
  errorEl.textContent = '';

  let response;
  try {
    response = await fetch(`/api/policy/${id}`, { method: 'DELETE' });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi xoá chương trình';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi xoá chương trình';
    return;
  }
  await loadPolicies();
}

async function loadGiftInventory() {
  const response = await fetch('/api/gift-inventory');
  if (!response.ok) {
    return;
  }
  const data = await response.json();
  if (data && data.name && data.stockCount !== undefined) {
    document.getElementById('giftInventoryDisplay').textContent = `Hiện có: ${data.stockCount} ${data.name}`;
  }
}

async function loadNotifySettings() {
  const statusEl = document.getElementById('notifyStatus');
  let response;
  try {
    response = await fetch('/api/notification-settings');
  } catch (err) {
    statusEl.textContent = 'Có lỗi khi tải trạng thái kết nối';
    return;
  }
  if (!response.ok) {
    statusEl.textContent = 'Có lỗi khi tải trạng thái kết nối';
    return;
  }
  const data = await response.json();
  statusEl.textContent = data.connected ? '✅ Đã kết nối' : 'Chưa kết nối';
}

document.getElementById('policyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const errorEl = document.getElementById('policyError');
  errorEl.textContent = '';

  const response = await fetch('/api/policy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      discountPercent: Number(data.get('discountPercent')),
      validFrom: data.get('validFrom'),
      validTo: data.get('validTo'),
      giftEnabled: data.get('giftEnabled') === 'on',
    }),
  });

  if (!response.ok) {
    const body = await response.json();
    errorEl.textContent = body.error || 'Có lỗi khi lưu chương trình';
    return;
  }

  event.target.reset();
  await loadPolicies();
});

document.getElementById('giftForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const errorEl = document.getElementById('giftError');
  errorEl.textContent = '';

  const response = await fetch('/api/gift-inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: data.get('name'), stockCount: Number(data.get('stockCount')) }),
  });

  if (!response.ok) {
    const body = await response.json();
    errorEl.textContent = body.error || 'Có lỗi khi cập nhật kho';
    return;
  }

  event.target.reset();
  await loadGiftInventory();
});

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = 'login.html';
    return;
  }
  const { role } = await res.json();
  currentRole = role;

  if (currentRole === 'manager') {
    document.getElementById('policyForm').classList.remove('hidden');
    document.getElementById('policyDeleteHeader').classList.remove('hidden');
    document.getElementById('giftInventorySection').classList.remove('hidden');
    document.getElementById('notifySettingsSection').classList.remove('hidden');
    loadNotifySettings();
  }

  loadPolicies();
  loadGiftInventory();
})();
