// v4/admin/dine-in-order-detail.js
let currentRole = null;
let currentOrder = null;
let menuItems = [];

function orderIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('orderId');
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

  const orderId = orderIdFromQuery();
  if (!orderId) {
    document.getElementById('pageError').textContent = 'Thiếu mã order';
    return;
  }

  if (currentRole !== 'observer') {
    let menuResponse;
    try {
      menuResponse = await fetch('/api/dine-in-menu');
    } catch (err) {
      document.getElementById('pageError').textContent = 'Có lỗi khi tải menu';
      return;
    }
    if (menuResponse.ok) {
      menuItems = (await menuResponse.json()).filter((m) => m.isActive);
      populateMenuSelect();
    }
  }

  await loadOrder(orderId);
})();

function populateMenuSelect() {
  const select = document.querySelector('#addItemForm select[name="menuItemId"]');
  select.innerHTML = '<option value="">-- Chọn món --</option>';

  ['mon_an', 'do_uong'].forEach((category) => {
    const groupOrder = [];
    const groups = {};
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

async function loadOrder(orderId) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  let response;
  try {
    response = await fetch(`/api/dine-in-orders/${orderId}`);
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải order';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải order';
    return;
  }
  currentOrder = await response.json();
  render();
}

function render() {
  const o = currentOrder;
  document.getElementById('pageTitle').textContent = `Bàn: ${o.tableLabel}`;

  const list = document.getElementById('itemsList');
  list.innerHTML = '';
  o.items.forEach((item) => {
    const line = document.createElement('div');
    line.className = 'service-line';
    if (item.status === 'voided') line.style.textDecoration = 'line-through';

    const label = document.createElement('span');
    label.textContent = `${item.name} ×${item.quantity} — ${item.amount.toLocaleString('vi-VN')}đ`;
    line.appendChild(label);

    if (item.status === 'posted' && currentOrder.status === 'open' && currentRole !== 'observer') {
      const voidBtn = document.createElement('button');
      voidBtn.type = 'button';
      voidBtn.className = 'btn-secondary';
      voidBtn.textContent = 'Huỷ dòng';
      voidBtn.addEventListener('click', () => voidItem(item.id));
      line.appendChild(voidBtn);
    }

    list.appendChild(line);
  });

  const currentTotal = o.items.filter((i) => i.status === 'posted').reduce((sum, i) => sum + i.amount, 0);
  document.getElementById('orderTotal').textContent = `Tổng: ${currentTotal.toLocaleString('vi-VN')}đ`;

  const addForm = document.getElementById('addItemForm');
  const closeSection = document.getElementById('closeSection');
  const printBtn = document.getElementById('printBtn');

  if (o.status === 'open' && currentRole !== 'observer') {
    addForm.classList.remove('hidden');
    closeSection.classList.remove('hidden');
  } else {
    addForm.classList.add('hidden');
    closeSection.classList.add('hidden');
  }

  if (o.status === 'closed') {
    printBtn.classList.remove('hidden');
  } else {
    printBtn.classList.add('hidden');
  }
}

document.getElementById('addItemForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('addItemError');
  errorEl.textContent = '';
  const form = event.target;
  const menuItemId = Number(form.querySelector('[name="menuItemId"]').value);
  const quantity = Number(form.querySelector('[name="quantity"]').value);
  if (!menuItemId) {
    errorEl.textContent = 'Vui lòng chọn món';
    return;
  }
  const response = await fetch(`/api/dine-in-orders/${currentOrder.id}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menuItemId, quantity }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi thêm món';
    return;
  }
  form.reset();
  form.querySelector('[name="quantity"]').value = 1;
  await loadOrder(currentOrder.id);
});

async function voidItem(itemId) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  const response = await fetch(`/api/dine-in-orders/${currentOrder.id}/items/${itemId}`, { method: 'PATCH' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi huỷ dòng';
    return;
  }
  await loadOrder(currentOrder.id);
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
  const response = await fetch(`/api/dine-in-orders/${currentOrder.id}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentMethod: selected.value }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi chốt order';
    document.getElementById('closeBtn').disabled = false;
    return;
  }
  await loadOrder(currentOrder.id);
});

document.getElementById('voidBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('closeError');
  errorEl.textContent = '';
  const response = await fetch(`/api/dine-in-orders/${currentOrder.id}/void`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi huỷ bàn';
    return;
  }
  window.location.href = '/admin/dine-in-orders.html';
});

document.getElementById('printBtn').addEventListener('click', () => {
  window.open(`/admin/dine-in-order-print.html?orderId=${currentOrder.id}`, '_blank');
});
