// v4/admin/dine-in-menu.js
let currentRole = null;
let menuItems = [];

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

  if (currentRole === 'admin') {
    document.getElementById('monAnAddForm').classList.remove('hidden');
    document.getElementById('doUongAddForm').classList.remove('hidden');
  }

  await loadMenu();
})();

async function loadMenu() {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  let response;
  try {
    response = await fetch('/api/dine-in-menu');
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải menu';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải menu';
    return;
  }
  menuItems = await response.json();
  renderTable('mon_an', document.querySelector('#monAnTable tbody'));
  renderTable('do_uong', document.querySelector('#doUongTable tbody'));
}

function renderTable(category, tbody) {
  tbody.innerHTML = '';
  menuItems.filter((m) => m.category === category).forEach((m) => {
    const tr = document.createElement('tr');
    if (!m.isActive) tr.style.opacity = '0.5';

    const tdName = document.createElement('td');
    tdName.textContent = m.name;

    const tdPrice = document.createElement('td');
    tdPrice.textContent = `${m.price.toLocaleString('vi-VN')}đ`;

    const tdStatus = document.createElement('td');
    tdStatus.textContent = m.isActive ? 'Đang bán' : 'Đã ẩn';

    const tdActions = document.createElement('td');
    if (currentRole === 'admin') {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Sửa';
      editBtn.addEventListener('click', () => editItem(m));
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn-secondary';
      toggleBtn.textContent = m.isActive ? 'Ẩn' : 'Hiện lại';
      toggleBtn.addEventListener('click', () => toggleActive(m));
      tdActions.append(editBtn, toggleBtn);
    }

    tr.append(tdName, tdPrice, tdStatus, tdActions);
    tbody.appendChild(tr);
  });
}

async function editItem(item) {
  const newName = window.prompt('Tên món mới:', item.name);
  if (newName === null) return;
  const trimmedName = newName.trim();
  if (!trimmedName) return;

  const newPriceStr = window.prompt('Giá mới (đ):', String(item.price));
  if (newPriceStr === null) return;
  const newPrice = Number(newPriceStr);
  const errorEl = document.getElementById('pageError');
  if (!Number.isInteger(newPrice) || newPrice <= 0) {
    errorEl.textContent = 'Giá không hợp lệ';
    return;
  }

  errorEl.textContent = '';
  const response = await fetch(`/api/dine-in-menu/${item.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: trimmedName, price: newPrice }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi sửa món';
    return;
  }
  await loadMenu();
}

async function toggleActive(item) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  const response = await fetch(`/api/dine-in-menu/${item.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive: !item.isActive }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi cập nhật món';
    return;
  }
  await loadMenu();
}

function wireAddForm(formId, errorId, category) {
  const form = document.getElementById(formId);
  const errorEl = document.getElementById(errorId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';
    const name = form.querySelector('[name="name"]').value.trim();
    const price = Number(form.querySelector('[name="price"]').value);
    if (!name) {
      errorEl.textContent = 'Vui lòng nhập tên món';
      return;
    }
    if (!Number.isInteger(price) || price <= 0) {
      errorEl.textContent = 'Vui lòng nhập giá hợp lệ';
      return;
    }
    const response = await fetch('/api/dine-in-menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, price }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || 'Có lỗi khi thêm món';
      return;
    }
    form.reset();
    await loadMenu();
  });
}

wireAddForm('monAnAddForm', 'monAnAddError', 'mon_an');
wireAddForm('doUongAddForm', 'doUongAddError', 'do_uong');
