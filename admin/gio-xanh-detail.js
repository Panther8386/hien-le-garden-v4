// v4/admin/gio-xanh-detail.js
let currentRole = null;
let currentSession = null;
let comboItems = [];
let menuItems = [];

function sessionIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('sessionId');
}

(async () => {
  let res;
  try {
    res = await fetch('/api/auth/me');
  } catch (err) {
    window.location.href = '/admin';
    return;
  }
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
  const { role } = await res.json();
  currentRole = role;

  const sessionId = sessionIdFromQuery();
  if (!sessionId) {
    document.getElementById('pageError').textContent = 'Thiếu mã phiên';
    return;
  }

  if (currentRole !== 'observer') {
    let catalogResponse, menuResponse;
    try {
      [catalogResponse, menuResponse] = await Promise.all([
        fetch('/api/catalog'),
        fetch('/api/dine-in-menu'),
      ]);
    } catch (err) {
      document.getElementById('pageError').textContent = 'Có lỗi khi tải danh sách combo/menu';
      return;
    }
    if (catalogResponse.ok) {
      const catalog = await catalogResponse.json();
      comboItems = catalog.filter((c) => c.category === 'luu_tru' && c.subgroup === 'Giờ Xanh Hiền Lê' && c.isActive);
      populateComboSelect();
    }
    if (menuResponse.ok) {
      menuItems = (await menuResponse.json()).filter((m) => m.isActive);
      populateMenuSelect();
    }
  }

  await loadSession(sessionId);
})();

function populateComboSelect() {
  const select = document.querySelector('#addComboForm select[name="comboId"]');
  select.innerHTML = '<option value="">-- Chọn combo giờ --</option>';
  comboItems.forEach((c) => {
    const option = document.createElement('option');
    option.value = c.id;
    option.textContent = `${c.name} — ${c.priceMin.toLocaleString('vi-VN')}đ`;
    select.appendChild(option);
  });
}

function populateMenuSelect() {
  const select = document.querySelector('#addMenuItemForm select[name="menuItemId"]');
  select.innerHTML = '<option value="">-- Chọn món --</option>';

  ['mon_an', 'do_uong'].forEach((category) => {
    const groupOrder = [];
    const groups = Object.create(null);
    menuItems.filter((m) => m.category === category).forEach((m) => {
      const key = m.subgroup || (category === 'mon_an' ? 'Món ăn khác' : 'Thức uống khác');
      if (!(key in groups)) {
        groups[key] = [];
        groupOrder.push(key);
      }
      groups[key].push(m);
    });

    groupOrder.forEach((key) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = key;
      groups[key].forEach((m) => {
        const option = document.createElement('option');
        option.value = m.id;
        const unitSuffix = m.unit ? `/${m.unit}` : '';
        const preorderSuffix = m.requiresPreorder ? ' ⚠ Đặt trước' : '';
        option.textContent = `${m.name} — ${m.price.toLocaleString('vi-VN')}đ${unitSuffix}${preorderSuffix}`;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });
  });
}

async function loadSession(sessionId) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  let response;
  try {
    response = await fetch(`/api/gio-xanh-sessions/${sessionId}`);
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải phiên';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải phiên';
    return;
  }
  currentSession = await response.json();
  render();
}

function render() {
  const s = currentSession;
  document.getElementById('pageTitle').textContent = `Phòng: ${s.roomName} — ${s.guestName}`;

  const list = document.getElementById('itemsList');
  list.innerHTML = '';
  s.items.forEach((item) => {
    const line = document.createElement('div');
    line.className = 'service-line';
    if (item.status === 'voided') line.style.textDecoration = 'line-through';

    const icon = item.source === 'gio_combo' ? '🌿' : '🍽️';
    const label = document.createElement('span');
    label.textContent = `${icon} ${item.name} ×${item.quantity} — ${item.amount.toLocaleString('vi-VN')}đ`;
    line.appendChild(label);

    if (item.status === 'posted' && currentSession.status === 'open' && currentRole !== 'observer') {
      const voidBtn = document.createElement('button');
      voidBtn.type = 'button';
      voidBtn.className = 'btn-secondary';
      voidBtn.textContent = 'Huỷ dòng';
      voidBtn.addEventListener('click', () => voidItem(item.id));
      line.appendChild(voidBtn);
    }

    list.appendChild(line);
  });

  const currentTotal = s.items.filter((i) => i.status === 'posted').reduce((sum, i) => sum + i.amount, 0);
  document.getElementById('sessionTotal').textContent = `Tổng: ${currentTotal.toLocaleString('vi-VN')}đ`;

  const addComboForm = document.getElementById('addComboForm');
  const addMenuItemForm = document.getElementById('addMenuItemForm');
  const closeSection = document.getElementById('closeSection');
  const printBtn = document.getElementById('printBtn');

  if (s.status === 'open' && currentRole !== 'observer') {
    addComboForm.classList.remove('hidden');
    addMenuItemForm.classList.remove('hidden');
    closeSection.classList.remove('hidden');
  } else {
    addComboForm.classList.add('hidden');
    addMenuItemForm.classList.add('hidden');
    closeSection.classList.add('hidden');
  }

  if (s.status === 'closed') {
    printBtn.classList.remove('hidden');
  } else {
    printBtn.classList.add('hidden');
  }
}

document.getElementById('addComboForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('addComboError');
  errorEl.textContent = '';
  const form = event.target;
  const comboId = Number(form.querySelector('[name="comboId"]').value);
  const quantity = Number(form.querySelector('[name="quantity"]').value);
  if (!comboId) {
    errorEl.textContent = 'Vui lòng chọn combo giờ';
    return;
  }
  const response = await fetch(`/api/gio-xanh-sessions/${currentSession.id}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'gio_combo', sourceId: comboId, quantity }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi thêm combo giờ';
    return;
  }
  form.reset();
  form.querySelector('[name="quantity"]').value = 1;
  await loadSession(currentSession.id);
});

document.getElementById('addMenuItemForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('addMenuItemError');
  errorEl.textContent = '';
  const form = event.target;
  const menuItemId = Number(form.querySelector('[name="menuItemId"]').value);
  const quantity = Number(form.querySelector('[name="quantity"]').value);
  if (!menuItemId) {
    errorEl.textContent = 'Vui lòng chọn món';
    return;
  }
  const response = await fetch(`/api/gio-xanh-sessions/${currentSession.id}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'mon_an_uong', sourceId: menuItemId, quantity }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi thêm món';
    return;
  }
  form.reset();
  form.querySelector('[name="quantity"]').value = 1;
  await loadSession(currentSession.id);
});

async function voidItem(itemId) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  const response = await fetch(`/api/gio-xanh-sessions/${currentSession.id}/items/${itemId}`, { method: 'PATCH' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi huỷ dòng';
    return;
  }
  await loadSession(currentSession.id);
}

document.querySelectorAll('input[name="paymentMethod"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    document.getElementById('closeBtn').disabled = false;
  });
});

document.getElementById('closeBtn').addEventListener('click', async () => {
  document.getElementById('closeBtn').disabled = true;
  const errorEl = document.getElementById('closeError');
  errorEl.textContent = '';
  const selected = document.querySelector('input[name="paymentMethod"]:checked');
  if (!selected) {
    errorEl.textContent = 'Vui lòng chọn hình thức thanh toán';
    document.getElementById('closeBtn').disabled = false;
    return;
  }
  const response = await fetch(`/api/gio-xanh-sessions/${currentSession.id}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentMethod: selected.value }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi chốt phiên';
    document.getElementById('closeBtn').disabled = false;
    return;
  }
  await loadSession(currentSession.id);
});

document.getElementById('voidBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('closeError');
  errorEl.textContent = '';
  const response = await fetch(`/api/gio-xanh-sessions/${currentSession.id}/void`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi huỷ phiên';
    return;
  }
  window.location.href = '/admin/gio-xanh.html';
});

document.getElementById('printBtn').addEventListener('click', () => {
  window.open(`/admin/gio-xanh-print.html?sessionId=${currentSession.id}`, '_blank');
});
