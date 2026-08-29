// v4/admin/catalog.js
let currentRole = null;
let catalogItems = [];
let activeCategory = 'luu_tru';

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
  const { role } = await res.json();
  currentRole = role;
  if (currentRole === 'admin') {
    document.getElementById('addServiceBtn').classList.remove('hidden');
  }
  await loadCatalog();
})();

async function loadCatalog() {
  const listError = document.getElementById('listError');
  listError.textContent = '';
  const response = await fetch('/api/catalog?all=1');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải bảng giá';
    return;
  }
  catalogItems = await response.json();
  renderTable();
}

function formatPrice(item) {
  if (item.priceType === 'label') return { a: item.priceLabel, b: '' };
  if (item.priceType === 'fixed') return { a: `${item.priceMin.toLocaleString('vi-VN')} đ`, b: '' };
  return { a: `${item.priceMin.toLocaleString('vi-VN')} đ`, b: `${item.priceMax.toLocaleString('vi-VN')} đ` };
}

function renderTable() {
  const tbody = document.querySelector('#catalogTable tbody');
  tbody.innerHTML = '';
  const items = catalogItems.filter((i) => i.category === activeCategory);

  let lastSubgroup;
  items.forEach((item, index) => {
    if (index === 0 || item.subgroup !== lastSubgroup) {
      lastSubgroup = item.subgroup;
      if (item.subgroup) {
        const trHead = document.createElement('tr');
        const tdHead = document.createElement('td');
        tdHead.colSpan = 6;
        tdHead.textContent = item.subgroup;
        tdHead.style.fontWeight = 'bold';
        trHead.appendChild(tdHead);
        tbody.appendChild(trHead);
      }
    }

    const tr = document.createElement('tr');
    if (!item.isActive) tr.style.opacity = '0.5';

    const tdName = document.createElement('td');
    tdName.textContent = item.name;

    const price = formatPrice(item);
    const tdA = document.createElement('td');
    tdA.textContent = price.a;
    const tdB = document.createElement('td');
    tdB.textContent = price.b;

    const tdUnit = document.createElement('td');
    tdUnit.textContent = item.unitCapacity || '';

    const tdNote = document.createElement('td');
    tdNote.textContent = item.note || '';

    const tdActions = document.createElement('td');
    if (currentRole === 'admin') {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Sửa';
      editBtn.addEventListener('click', () => openEditForm(item));
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Xoá';
      deleteBtn.addEventListener('click', () => deleteItem(item.id));
      tdActions.append(editBtn, deleteBtn);
    }

    tr.append(tdName, tdA, tdB, tdUnit, tdNote, tdActions);
    tbody.appendChild(tr);
  });
}

document.querySelectorAll('#catalogTabs .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#catalogTabs .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeCategory = btn.dataset.category;
    renderTable();
  });
});

function updatePriceTypeFields() {
  const isLabel = document.querySelector('#catalogForm input[name="isLabelPrice"]').checked;
  document.getElementById('priceRangeFields').classList.toggle('hidden', isLabel);
  document.getElementById('priceLabelField').classList.toggle('hidden', !isLabel);
}

document.querySelector('#catalogForm input[name="isLabelPrice"]').addEventListener('change', updatePriceTypeFields);

function updateScheduledFields() {
  const isScheduled = document.querySelector('#catalogForm input[name="isScheduled"]').checked;
  document.getElementById('termsField').classList.toggle('hidden', !isScheduled);
}

document.querySelector('#catalogForm input[name="isScheduled"]').addEventListener('change', updateScheduledFields);

function resetForm() {
  const form = document.getElementById('catalogForm');
  form.reset();
  form.querySelector('input[name="id"]').value = '';
  form.querySelector('input[name="category"]').value = activeCategory;
  document.getElementById('roomTypeField').classList.toggle('hidden', activeCategory !== 'luu_tru');
  document.getElementById('catalogSubmitBtn').textContent = 'Thêm dịch vụ';
  updatePriceTypeFields();
  updateScheduledFields();
}

document.getElementById('addServiceBtn').addEventListener('click', () => {
  resetForm();
  document.getElementById('catalogForm').classList.remove('hidden');
});

document.getElementById('catalogCancelBtn').addEventListener('click', () => {
  document.getElementById('catalogForm').classList.add('hidden');
});

function openEditForm(item) {
  const form = document.getElementById('catalogForm');
  form.classList.remove('hidden');
  form.querySelector('input[name="id"]').value = item.id;
  form.querySelector('input[name="category"]').value = item.category;
  form.querySelector('input[name="subgroup"]').value = item.subgroup || '';
  form.querySelector('input[name="name"]').value = item.name;
  const isLabel = item.priceType === 'label';
  form.querySelector('input[name="isLabelPrice"]').checked = isLabel;
  form.querySelector('input[name="priceMin"]').value = !isLabel ? item.priceMin : '';
  form.querySelector('input[name="priceMax"]').value = item.priceType === 'range' ? item.priceMax : '';
  form.querySelector('input[name="priceLabel"]').value = isLabel ? item.priceLabel : '';
  form.querySelector('input[name="unitCapacity"]').value = item.unitCapacity || '';
  form.querySelector('input[name="note"]').value = item.note || '';
  form.querySelector('input[name="isScheduled"]').checked = item.isScheduled;
  form.querySelector('textarea[name="termsAndConditions"]').value = item.termsAndConditions || '';
  const roomTypeSelect = form.querySelector('select[name="roomTypeKey"]');
  if (roomTypeSelect) roomTypeSelect.value = item.roomTypeKey || '';
  document.getElementById('roomTypeField').classList.toggle('hidden', item.category !== 'luu_tru');
  document.getElementById('catalogSubmitBtn').textContent = 'Lưu thay đổi';
  updatePriceTypeFields();
  updateScheduledFields();
}

async function deleteItem(id) {
  const listError = document.getElementById('listError');
  const response = await fetch(`/api/catalog/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi xoá dịch vụ';
    return;
  }
  await loadCatalog();
}

document.getElementById('catalogForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const errorEl = document.getElementById('formError');
  errorEl.textContent = '';

  const id = data.get('id');
  const isLabel = form.querySelector('input[name="isLabelPrice"]').checked;
  const payload = {
    category: data.get('category'),
    subgroup: data.get('subgroup') || null,
    name: data.get('name'),
    unitCapacity: data.get('unitCapacity') || null,
    note: data.get('note') || null,
    roomTypeKey: data.get('roomTypeKey') || null,
    isScheduled: form.querySelector('input[name="isScheduled"]').checked,
    termsAndConditions: data.get('termsAndConditions') || null,
  };

  if (isLabel) {
    payload.priceType = 'label';
    payload.priceLabel = data.get('priceLabel');
  } else {
    const priceMinRaw = data.get('priceMin');
    const priceMaxRaw = data.get('priceMax');
    if (priceMinRaw === '' || priceMinRaw === null) {
      errorEl.textContent = 'Vui lòng nhập Giá A';
      return;
    }
    const priceMin = Number(priceMinRaw);
    if (priceMaxRaw !== '' && priceMaxRaw !== null) {
      const priceMax = Number(priceMaxRaw);
      if (priceMax <= priceMin) {
        errorEl.textContent = 'Giá B phải lớn hơn Giá A — để trống Giá B nếu đây là giá cố định';
        return;
      }
      payload.priceType = 'range';
      payload.priceMin = priceMin;
      payload.priceMax = priceMax;
    } else {
      payload.priceType = 'fixed';
      payload.priceMin = priceMin;
    }
  }

  const response = await fetch(id ? `/api/catalog/${id}` : '/api/catalog', {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu dịch vụ';
    return;
  }

  form.classList.add('hidden');
  await loadCatalog();
});
