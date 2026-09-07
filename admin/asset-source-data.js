// v4/admin/asset-source-data.js
let currentRole = null;
let categories = [];
let locations = [];
let reconcilingRowId = null;

const INDIVIDUAL_MANAGEMENT_TYPES = ['individual_device', 'device_set'];

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

  if (currentRole === 'admin' || currentRole === 'manager') {
    await loadCategoriesAndLocations();
  }

  await loadDocuments();
})();

async function loadCategoriesAndLocations() {
  try {
    const [categoriesResponse, locationsResponse] = await Promise.all([
      fetch('/api/asset-categories'),
      fetch('/api/asset-locations'),
    ]);
    categories = categoriesResponse.ok ? await categoriesResponse.json() : [];
    locations = locationsResponse.ok ? await locationsResponse.json() : [];
  } catch (err) {
    categories = [];
    locations = [];
  }

  const categorySelect = document.querySelector('#reconcileForm select[name="categoryId"]');
  categorySelect.innerHTML = '';
  categories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    opt.dataset.managementType = c.managementType;
    categorySelect.appendChild(opt);
  });

  const locationSelect = document.querySelector('#reconcileForm select[name="locationId"]');
  locations.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    locationSelect.appendChild(opt);
  });
}

function showPageError(message) {
  document.getElementById('pageError').textContent = message || '';
}

async function loadDocuments() {
  showPageError('');
  let response;
  try {
    response = await fetch('/api/asset-source-documents');
  } catch (err) {
    showPageError('Có lỗi khi tải hồ sơ nguồn');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showPageError(body.error || 'Có lỗi khi tải hồ sơ nguồn');
    return;
  }
  const documents = await response.json();
  const select = document.getElementById('documentSelect');
  select.innerHTML = '';
  documents.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.contractRef ? `${d.title} (${d.contractRef})` : d.title;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => loadSourceRows(select.value));
  if (documents.length > 0) await loadSourceRows(documents[0].id);
}

async function loadSourceRows(documentId) {
  showPageError('');
  let response;
  try {
    response = await fetch(`/api/asset-source-rows?documentId=${documentId}`);
  } catch (err) {
    showPageError('Có lỗi khi tải danh sách hạng mục');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showPageError(body.error || 'Có lỗi khi tải danh sách hạng mục');
    return;
  }
  const rows = await response.json();
  renderRows(rows);
}

function renderRows(rows) {
  const tbody = document.querySelector('#sourceRowsTable tbody');
  tbody.innerHTML = '';
  let currentGroup = null;
  rows.forEach((r) => {
    if (r.sourceGroupLabel !== currentGroup) {
      currentGroup = r.sourceGroupLabel;
      const groupTr = document.createElement('tr');
      const groupTd = document.createElement('td');
      groupTd.colSpan = 8;
      groupTd.style.fontWeight = '600';
      groupTd.textContent = currentGroup;
      groupTr.appendChild(groupTd);
      tbody.appendChild(groupTr);
    }
    const tr = document.createElement('tr');
    const cells = [
      String(r.stt),
      r.rawName,
      r.rawUnit || '',
      r.rawQuantity !== null && r.rawQuantity !== undefined ? r.rawQuantity : 'Chưa xác định',
      r.rawCondition || '',
      r.rawNote || '',
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });

    const reconciledTd = document.createElement('td');
    const knownQuantity = r.rawQuantity !== null && r.rawQuantity !== undefined ? Number(r.rawQuantity) : null;
    const hasKnownQuantity = knownQuantity !== null && Number.isInteger(knownQuantity);
    reconciledTd.textContent = hasKnownQuantity ? `${r.reconciledCount}/${knownQuantity}` : `Đã tạo ${r.reconciledCount}`;
    tr.appendChild(reconciledTd);

    const actionTd = document.createElement('td');
    if (currentRole === 'admin' || currentRole === 'manager') {
      const reconcileBtn = document.createElement('button');
      reconcileBtn.type = 'button';
      reconcileBtn.className = 'table-actions-btn';
      reconcileBtn.textContent = 'Tạo tài sản';
      reconcileBtn.addEventListener('click', () => openReconcileForm(r));
      actionTd.appendChild(reconcileBtn);
    }
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });
}

function openReconcileForm(row) {
  reconcilingRowId = row.id;
  const form = document.getElementById('reconcileForm');
  form.reset();
  document.getElementById('reconcileRowLabel').textContent = `${row.rawName} (STT ${row.stt})`;
  document.getElementById('reconcileFormError').textContent = '';
  updateReconcileFieldVisibility();
  document.getElementById('reconcileFormOverlay').classList.remove('hidden');
}

function updateReconcileFieldVisibility() {
  const categorySelect = document.querySelector('#reconcileForm select[name="categoryId"]');
  const selected = categorySelect.selectedOptions[0];
  const isIndividual = selected && INDIVIDUAL_MANAGEMENT_TYPES.includes(selected.dataset.managementType);
  document.getElementById('reconcileCountWrap').classList.toggle('hidden', !isIndividual);
  document.getElementById('reconcileQuantityWrap').classList.toggle('hidden', isIndividual);
}

document.getElementById('reconcileFormCloseBtn').addEventListener('click', () => {
  document.getElementById('reconcileFormOverlay').classList.add('hidden');
});

document.querySelector('#reconcileForm select[name="categoryId"]').addEventListener('change', updateReconcileFieldVisibility);

document.getElementById('reconcileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const errorEl = document.getElementById('reconcileFormError');
  errorEl.textContent = '';

  const categorySelect = form.querySelector('select[name="categoryId"]');
  const selected = categorySelect.selectedOptions[0];
  const isIndividual = selected && INDIVIDUAL_MANAGEMENT_TYPES.includes(selected.dataset.managementType);

  const payload = {
    categoryId: Number(categorySelect.value),
    locationId: form.querySelector('select[name="locationId"]').value ? Number(form.querySelector('select[name="locationId"]').value) : null,
  };
  if (isIndividual) {
    payload.count = Number(form.querySelector('input[name="count"]').value || 1);
  } else {
    const quantityValue = form.querySelector('input[name="quantity"]').value;
    payload.quantity = quantityValue === '' ? null : Number(quantityValue);
  }

  let response;
  try {
    response = await fetch(`/api/asset-source-rows/${reconcilingRowId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tạo tài sản';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tạo tài sản';
    return;
  }

  document.getElementById('reconcileFormOverlay').classList.add('hidden');
  const documentSelect = document.getElementById('documentSelect');
  await loadSourceRows(documentSelect.value);
});
