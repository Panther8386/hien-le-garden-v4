// v4/admin/dine-in-orders.js
let currentRole = null;

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

  if (currentRole !== 'observer') {
    document.getElementById('openTableForm').classList.remove('hidden');
  }

  await loadOrders();
})();

async function loadOrders() {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  let response;
  try {
    response = await fetch('/api/dine-in-orders?status=open');
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải danh sách bàn';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải danh sách bàn';
    return;
  }
  const orders = await response.json();
  renderGrid(orders);
}

function renderGrid(orders) {
  const grid = document.getElementById('ordersGrid');
  const emptyState = document.getElementById('emptyState');
  grid.innerHTML = '';
  if (orders.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  orders.forEach((o) => {
    const card = document.createElement('div');
    card.className = 'dine-order-card';

    const tableLabel = document.createElement('div');
    tableLabel.className = 'table-label';
    tableLabel.textContent = o.tableLabel;

    const total = document.createElement('div');
    total.className = 'order-total';
    total.textContent = `${o.currentTotal.toLocaleString('vi-VN')}đ`;

    const opened = document.createElement('div');
    opened.textContent = `Mở lúc: ${new Date(o.openedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;

    card.append(tableLabel, total, opened);
    card.addEventListener('click', () => {
      window.location.href = `/admin/dine-in-order-detail.html?orderId=${o.id}`;
    });
    grid.appendChild(card);
  });
}

document.getElementById('openTableForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('openTableError');
  errorEl.textContent = '';
  const form = event.target;
  const tableLabel = form.querySelector('[name="tableLabel"]').value.trim();
  const note = form.querySelector('[name="note"]').value.trim();
  if (!tableLabel) {
    errorEl.textContent = 'Vui lòng nhập số bàn';
    return;
  }
  const response = await fetch('/api/dine-in-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableLabel, note: note || undefined }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi mở bàn';
    return;
  }
  const result = await response.json();
  window.location.href = `/admin/dine-in-order-detail.html?orderId=${result.id}`;
});
