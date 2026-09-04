// v4/admin/finance-categories.js
let currentRole = null;
let categories = [];

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
    document.getElementById('incomeAddForm').classList.remove('hidden');
    document.getElementById('expenseAddForm').classList.remove('hidden');
  }

  await loadCategories();
})();

async function loadCategories() {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  let response;
  try {
    response = await fetch('/api/finance/categories');
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải danh mục';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải danh mục';
    return;
  }
  categories = await response.json();
  renderTable('income', document.querySelector('#incomeTable tbody'));
  renderTable('expense', document.querySelector('#expenseTable tbody'));
}

function renderTable(type, tbody) {
  tbody.innerHTML = '';
  const rows = categories.filter((c) => c.type === type);
  rows.forEach((c, index) => {
    const tr = document.createElement('tr');
    if (!c.isActive) tr.style.opacity = '0.5';

    const tdLabel = document.createElement('td');
    tdLabel.textContent = c.label;

    const tdStatus = document.createElement('td');
    tdStatus.textContent = c.isActive ? 'Đang dùng' : 'Đã ẩn';

    const tdActions = document.createElement('td');
    if (currentRole === 'admin') {
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'btn-secondary table-actions-btn';
      upBtn.textContent = '▲';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => moveHandler(c.id, 'up'));
      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'btn-secondary table-actions-btn';
      downBtn.textContent = '▼';
      downBtn.disabled = index === rows.length - 1;
      downBtn.addEventListener('click', () => moveHandler(c.id, 'down'));
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'table-actions-btn';
      editBtn.textContent = 'Sửa tên';
      editBtn.addEventListener('click', () => editLabel(c));
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn-secondary table-actions-btn';
      toggleBtn.textContent = c.isActive ? 'Ẩn' : 'Hiện lại';
      toggleBtn.addEventListener('click', () => toggleActive(c));
      tdActions.append(upBtn, downBtn, editBtn, toggleBtn);
    }

    tr.append(tdLabel, tdStatus, tdActions);
    tbody.appendChild(tr);
  });
}

async function moveHandler(categoryId, direction) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  const response = await fetch(`/api/finance/categories/${categoryId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi đổi thứ tự danh mục';
    return;
  }
  await loadCategories();
}

async function editLabel(category) {
  const newLabel = window.prompt('Tên danh mục mới:', category.label);
  if (newLabel === null) return;
  const trimmed = newLabel.trim();
  if (!trimmed || trimmed === category.label) return;

  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  const response = await fetch(`/api/finance/categories/${category.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: trimmed }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi sửa tên danh mục';
    return;
  }
  await loadCategories();
}

async function toggleActive(category) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  const response = await fetch(`/api/finance/categories/${category.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive: !category.isActive }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi cập nhật danh mục';
    return;
  }
  await loadCategories();
}

function wireAddForm(formId, errorId, type) {
  const form = document.getElementById(formId);
  const errorEl = document.getElementById(errorId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';
    const label = form.querySelector('[name="label"]').value.trim();
    if (!label) {
      errorEl.textContent = 'Vui lòng nhập tên danh mục';
      return;
    }
    const response = await fetch('/api/finance/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, type }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || 'Có lỗi khi thêm danh mục';
      return;
    }
    form.reset();
    await loadCategories();
  });
}

wireAddForm('incomeAddForm', 'incomeAddError', 'income');
wireAddForm('expenseAddForm', 'expenseAddError', 'expense');
