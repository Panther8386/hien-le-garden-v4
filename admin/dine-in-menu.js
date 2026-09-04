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
  populateSubgroupDatalist('mon_an', document.getElementById('monAnSubgroupList'));
  populateSubgroupDatalist('do_uong', document.getElementById('doUongSubgroupList'));
}

function populateSubgroupDatalist(category, datalistEl) {
  datalistEl.innerHTML = '';
  const seen = new Set();
  menuItems.filter((m) => m.category === category && m.subgroup).forEach((m) => {
    if (seen.has(m.subgroup)) return;
    seen.add(m.subgroup);
    const option = document.createElement('option');
    option.value = m.subgroup;
    datalistEl.appendChild(option);
  });
}

function groupByOrder(category) {
  const groupOrder = [];
  const groups = Object.create(null);
  menuItems.filter((m) => m.category === category).forEach((m) => {
    const key = m.subgroup || '';
    if (!(key in groups)) {
      groups[key] = [];
      groupOrder.push(key);
    }
    groups[key].push(m);
  });
  return { groupOrder, groups };
}

function renderTable(category, tbody) {
  tbody.innerHTML = '';
  const { groupOrder, groups } = groupByOrder(category);
  const isMonAn = category === 'mon_an';

  groupOrder.forEach((subgroup, groupIndex) => {
    if (subgroup) {
      const headerRow = document.createElement('tr');
      const headerCell = document.createElement('td');
      headerCell.colSpan = 4;
      headerCell.style.fontWeight = '600';
      headerCell.append(subgroup + ' ');

      if (currentRole === 'admin') {
        const upGroupBtn = document.createElement('button');
        upGroupBtn.type = 'button';
        upGroupBtn.className = 'btn-secondary';
        upGroupBtn.textContent = '▲';
        upGroupBtn.disabled = groupIndex === 0;
        upGroupBtn.addEventListener('click', () => moveGroupHandler(category, subgroup, 'up'));
        const downGroupBtn = document.createElement('button');
        downGroupBtn.type = 'button';
        downGroupBtn.className = 'btn-secondary';
        downGroupBtn.textContent = '▼';
        downGroupBtn.disabled = groupIndex === groupOrder.length - 1;
        downGroupBtn.addEventListener('click', () => moveGroupHandler(category, subgroup, 'down'));
        headerCell.append(upGroupBtn, downGroupBtn);
      }

      headerRow.appendChild(headerCell);
      tbody.appendChild(headerRow);
    }

    const items = groups[subgroup];
    items.forEach((m, itemIndex) => {
      const tr = document.createElement('tr');
      if (!m.isActive) tr.style.opacity = '0.5';

      const tdName = document.createElement('td');
      tdName.textContent = m.name;

      const tdPrice = document.createElement('td');
      const unitSuffix = m.unit ? `/${m.unit}` : '';
      tdPrice.textContent = `${m.price.toLocaleString('vi-VN')}đ${unitSuffix}`;
      if (isMonAn && m.requiresPreorder) {
        const badge = document.createElement('span');
        badge.textContent = ' ⚠ Đặt trước';
        tdPrice.appendChild(badge);
      }

      const tdStatus = document.createElement('td');
      tdStatus.textContent = m.isActive ? 'Đang bán' : 'Đã ẩn';

      const tdActions = document.createElement('td');
      if (currentRole === 'admin') {
        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'btn-secondary';
        upBtn.textContent = '▲';
        upBtn.disabled = itemIndex === 0;
        upBtn.addEventListener('click', () => moveItemHandler(m.id, 'up'));
        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'btn-secondary';
        downBtn.textContent = '▼';
        downBtn.disabled = itemIndex === items.length - 1;
        downBtn.addEventListener('click', () => moveItemHandler(m.id, 'down'));
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'Sửa';
        editBtn.addEventListener('click', () => startEdit(m));
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn-secondary';
        toggleBtn.textContent = m.isActive ? 'Ẩn' : 'Hiện lại';
        toggleBtn.addEventListener('click', () => toggleActive(m));
        tdActions.append(upBtn, downBtn, editBtn, toggleBtn);
      }

      tr.append(tdName, tdPrice, tdStatus, tdActions);
      tbody.appendChild(tr);
    });
  });
}

async function moveItemHandler(itemId, direction) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  const response = await fetch(`/api/dine-in-menu/${itemId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi đổi thứ tự món';
    return;
  }
  await loadMenu();
}

async function moveGroupHandler(category, subgroup, direction) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  const response = await fetch('/api/dine-in-menu/move-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, subgroup, direction }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi đổi thứ tự nhóm';
    return;
  }
  await loadMenu();
}

const formsByCategory = {};

function startEdit(item) {
  const config = formsByCategory[item.category];
  if (!config) return;
  const { form, submitBtn, cancelBtn, includePreorder, errorId } = config;
  form.querySelector('[name="name"]').value = item.name;
  form.querySelector('[name="subgroup"]').value = item.subgroup || '';
  form.querySelector('[name="price"]').value = item.price;
  form.querySelector('[name="unit"]').value = item.unit || '';
  if (includePreorder) {
    form.querySelector('[name="requiresPreorder"]').checked = !!item.requiresPreorder;
  }
  form.dataset.editingId = String(item.id);
  submitBtn.textContent = 'Lưu thay đổi';
  cancelBtn.classList.remove('hidden');
  document.getElementById(errorId).textContent = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEdit(category) {
  const config = formsByCategory[category];
  if (!config) return;
  const { form, submitBtn, cancelBtn, addLabel, errorId } = config;
  form.reset();
  delete form.dataset.editingId;
  submitBtn.textContent = addLabel;
  cancelBtn.classList.add('hidden');
  document.getElementById(errorId).textContent = '';
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

function wireAddForm(formId, errorId, category, includePreorder, addLabel) {
  const form = document.getElementById(formId);
  const errorEl = document.getElementById(errorId);
  const submitBtn = form.querySelector('button[type="submit"]');
  const cancelBtn = form.querySelector('.cancel-edit-btn');
  formsByCategory[category] = { form, submitBtn, cancelBtn, includePreorder, addLabel, errorId };

  cancelBtn.addEventListener('click', () => cancelEdit(category));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';
    const name = form.querySelector('[name="name"]').value.trim();
    const subgroup = form.querySelector('[name="subgroup"]').value.trim();
    const price = Number(form.querySelector('[name="price"]').value);
    const unit = form.querySelector('[name="unit"]').value.trim();
    const requiresPreorder = includePreorder ? form.querySelector('[name="requiresPreorder"]').checked : false;
    if (!name) {
      errorEl.textContent = 'Vui lòng nhập tên món';
      return;
    }
    if (!Number.isInteger(price) || price <= 0) {
      errorEl.textContent = 'Vui lòng nhập giá hợp lệ';
      return;
    }

    const editingId = form.dataset.editingId;
    const response = editingId
      ? await fetch(`/api/dine-in-menu/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, subgroup: subgroup || null, price, unit: unit || null, requiresPreorder }),
        })
      : await fetch('/api/dine-in-menu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, category, price, subgroup: subgroup || undefined, unit: unit || undefined, requiresPreorder }),
        });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || (editingId ? 'Có lỗi khi sửa món' : 'Có lỗi khi thêm món');
      return;
    }

    if (editingId) {
      cancelEdit(category);
    } else {
      form.reset();
    }
    await loadMenu();
  });
}

wireAddForm('monAnAddForm', 'monAnAddError', 'mon_an', true, '+ Thêm món');
wireAddForm('doUongAddForm', 'doUongAddError', 'do_uong', false, '+ Thêm thức uống');
