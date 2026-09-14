// v4/admin/asset-inventory-stock.js
let currentRole = null;
let categories = [];
let locations = [];
let currentStockRows = [];

const MANAGEMENT_TYPE_LABELS = {
  consumable: 'Vật tư tiêu hao',
  spare_part: 'Phụ tùng',
  food_beverage: 'Thực phẩm/thức uống',
  linen: 'Đồ vải luân chuyển',
};

const MOVEMENT_TYPE_LABELS = {
  opening: 'Nhập đầu kỳ', purchase: 'Nhập mua', consume: 'Xuất tiêu dùng', serve: 'Xuất phục vụ ăn uống',
  repair_use: 'Xuất sửa chữa', repair_return: 'Vật tư sửa chữa trả lại', damage: 'Hỏng/vỡ', loss: 'Hao hụt',
  expired: 'Hết hạn', adjustment: 'Điều chỉnh', return_out_of_scope: 'Trả ngoài phạm vi',
  transfer_out: 'Chuyển kho (đi)', transfer_in: 'Chuyển kho (đến)',
  issue: 'Cấp dùng', soil: 'Chuyển bẩn', send_wash: 'Gửi giặt', return: 'Nhận về (sạch)',
};

const LINEN_PREVIOUS_STATUS = { cap_dung: 'sach', ban: 'cap_dung', dang_giat: 'ban', sach: 'dang_giat' };

function formatQty(n) {
  return Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

function showPageError(message) {
  document.getElementById('stockError').textContent = message;
}

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
  const { role } = await res.json();
  currentRole = role;
  if (currentRole !== 'observer') {
    document.getElementById('openTransactionFormBtn').classList.remove('hidden');
  }
  if (currentRole === 'admin') {
    document.getElementById('openLotFormBtn').classList.remove('hidden');
  }

  categories = await fetch('/api/asset-categories').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  categories = categories.filter((c) => ['consumable', 'spare_part', 'food_beverage', 'linen'].includes(c.managementType));
  locations = await fetch('/api/asset-locations').then((r) => (r.ok ? r.json() : [])).catch(() => []);

  populateLocationFilter();
  populateTransactionFormSelects();
  populateLotFormSelects();
  await loadStock();

  document.getElementById('filterManagementType').addEventListener('change', loadStock);
  document.getElementById('filterLocation').addEventListener('change', loadStock);
  document.getElementById('searchBox').addEventListener('input', renderStockTable);
})();

function populateLocationFilter() {
  const select = document.getElementById('filterLocation');
  locations.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    select.appendChild(opt);
  });
}

async function loadStock() {
  showPageError('');
  const managementType = document.getElementById('filterManagementType').value;
  const locationId = document.getElementById('filterLocation').value;
  const params = new URLSearchParams();
  if (managementType) params.set('managementType', managementType);
  if (locationId) params.set('locationId', locationId);

  const response = await fetch(`/api/asset-inventory-stock?${params}`);
  if (!response.ok) {
    showPageError('Có lỗi khi tải tồn kho');
    return;
  }
  currentStockRows = await response.json();
  renderStockTable();

  const showingFood = managementType === 'food_beverage';
  document.getElementById('foodLotsSection').classList.toggle('hidden', !showingFood);
  if (showingFood) await loadFoodLots();
}

function renderStockTable() {
  const query = document.getElementById('searchBox').value.trim().toLowerCase();
  const tbody = document.querySelector('#stockTable tbody');
  tbody.innerHTML = '';

  currentStockRows
    .filter((r) => !query || r.categoryName.toLowerCase().includes(query))
    .forEach((r) => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => openTransactionHistory(r));

      const tdCategory = document.createElement('td');
      tdCategory.textContent = r.categoryName;
      const tdLocation = document.createElement('td');
      tdLocation.textContent = r.locationName;
      const tdQty = document.createElement('td');
      tdQty.textContent = formatQty(r.quantity);
      const tdUnit = document.createElement('td');
      tdUnit.textContent = r.unit;
      const tdSach = document.createElement('td');
      const tdCapDung = document.createElement('td');
      const tdBan = document.createElement('td');
      const tdDangGiat = document.createElement('td');
      if (r.managementType === 'linen') {
        tdSach.textContent = formatQty(r.sach);
        tdCapDung.textContent = formatQty(r.capDung);
        tdBan.textContent = formatQty(r.ban);
        tdDangGiat.textContent = formatQty(r.dangGiat);
      }

      tr.append(tdCategory, tdLocation, tdQty, tdUnit, tdSach, tdCapDung, tdBan, tdDangGiat);
      tbody.appendChild(tr);
    });
}

async function openTransactionHistory(stockRow) {
  const section = document.getElementById('transactionHistorySection');
  section.classList.remove('hidden');
  const params = new URLSearchParams({ categoryId: stockRow.categoryId, locationId: stockRow.locationId });
  const response = await fetch(`/api/asset-inventory-transactions?${params}`);
  if (!response.ok) return;
  const entries = await response.json();
  const tbody = document.querySelector('#transactionHistoryTable tbody');
  tbody.innerHTML = '';
  entries.forEach((entry) => {
    const tr = document.createElement('tr');
    if (entry.voidedAt) tr.style.opacity = '0.5';

    const tdTime = document.createElement('td');
    tdTime.textContent = new Date(entry.createdAt).toLocaleString('vi-VN');
    const tdType = document.createElement('td');
    tdType.textContent = MOVEMENT_TYPE_LABELS[entry.movementType] || entry.movementType;
    const tdQty = document.createElement('td');
    tdQty.textContent = `${entry.quantityDelta > 0 ? '+' : ''}${formatQty(entry.quantityDelta)} ${entry.unit}`;
    const tdReason = document.createElement('td');
    tdReason.textContent = entry.reason || entry.note || '';
    const tdActor = document.createElement('td');
    tdActor.textContent = entry.createdBy;
    const tdActions = document.createElement('td');
    if (currentRole !== 'observer' && !entry.voidedAt) {
      const voidBtn = document.createElement('button');
      voidBtn.type = 'button';
      voidBtn.className = 'table-actions-btn';
      voidBtn.textContent = 'Huỷ';
      voidBtn.addEventListener('click', async () => {
        const r = await fetch(`/api/asset-inventory-transactions/${entry.id}`, { method: 'DELETE' });
        if (r.ok) {
          await openTransactionHistory(stockRow);
          await loadStock();
        }
      });
      tdActions.appendChild(voidBtn);
    }

    tr.append(tdTime, tdType, tdQty, tdReason, tdActor, tdActions);
    tbody.appendChild(tr);
  });
}

document.getElementById('closeHistoryBtn').addEventListener('click', () => {
  document.getElementById('transactionHistorySection').classList.add('hidden');
});

async function loadFoodLots() {
  const foodCategoryIds = categories.filter((c) => c.managementType === 'food_beverage').map((c) => c.id);
  const rows = [];
  for (const categoryId of foodCategoryIds) {
    const response = await fetch(`/api/asset-inventory-food-lots?categoryId=${categoryId}`);
    if (response.ok) rows.push(...(await response.json()));
  }
  const tbody = document.querySelector('#foodLotsTable tbody');
  tbody.innerHTML = '';
  rows.forEach((lot) => {
    const tr = document.createElement('tr');
    const category = categories.find((c) => c.id === lot.categoryId);
    const location = locations.find((l) => l.id === lot.locationId);
    const tdCategory = document.createElement('td');
    tdCategory.textContent = category ? category.name : lot.categoryId;
    const tdLocation = document.createElement('td');
    tdLocation.textContent = location ? location.name : lot.locationId;
    const tdReceived = document.createElement('td');
    tdReceived.textContent = lot.receivedDate || '—';
    const tdExpiry = document.createElement('td');
    tdExpiry.textContent = lot.expiryDate || 'Chưa xác định';
    const tdNote = document.createElement('td');
    tdNote.textContent = lot.note || '';
    tr.append(tdCategory, tdLocation, tdReceived, tdExpiry, tdNote);
    tbody.appendChild(tr);
  });
}

// ---- Ghi phiếu form ----

function populateTransactionFormSelects() {
  const movementSelect = document.getElementById('movementTypeSelect');
  const shapes = [
    { value: 'single:opening', label: 'Nhập đầu kỳ' },
    { value: 'single:purchase', label: 'Nhập mua' },
    { value: 'single:consume', label: 'Xuất tiêu dùng' },
    { value: 'single:serve', label: 'Xuất phục vụ ăn uống' },
    { value: 'single:repair_use', label: 'Xuất sửa chữa' },
    { value: 'single:repair_return', label: 'Vật tư sửa chữa trả lại' },
    { value: 'single:damage', label: 'Hỏng/vỡ' },
    { value: 'single:loss', label: 'Hao hụt' },
    { value: 'single:expired', label: 'Hết hạn' },
    { value: 'single:adjustment', label: 'Điều chỉnh sau kiểm kê' },
    { value: 'single:return_out_of_scope', label: 'Trả ngoài phạm vi' },
    { value: 'transfer', label: 'Chuyển kho' },
    { value: 'linenTransition', label: 'Chuyển trạng thái đồ vải' },
  ];
  shapes.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.label;
    movementSelect.appendChild(opt);
  });
  movementSelect.addEventListener('change', updateTransactionFormFields);

  const categorySelect = document.getElementById('transactionCategorySelect');
  categories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name} (${MANAGEMENT_TYPE_LABELS[c.managementType]})`;
    categorySelect.appendChild(opt);
  });
  categorySelect.addEventListener('change', updateTransactionFormFields);

  [document.getElementById('transactionLocationSelect'), document.getElementById('toLocationSelect')].forEach((select) => {
    locations.forEach((l) => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      select.appendChild(opt);
    });
  });

  updateTransactionFormFields();
}

async function updateTransactionFormFields() {
  const shape = document.getElementById('movementTypeSelect').value;
  const isTransfer = shape === 'transfer';
  const isLinen = shape === 'linenTransition';
  const isAdjustment = shape === 'single:adjustment';

  document.getElementById('toLocationField').classList.toggle('hidden', !isTransfer);
  document.getElementById('linenStatusField').classList.toggle('hidden', !isLinen);
  document.getElementById('directionField').classList.toggle('hidden', !isAdjustment);

  const categoryId = Number(document.getElementById('transactionCategorySelect').value);
  const category = categories.find((c) => c.id === categoryId);
  const isFood = category && category.managementType === 'food_beverage' && !isTransfer && !isLinen;
  document.getElementById('lotField').classList.toggle('hidden', !isFood);
  if (isFood) {
    const lotSelect = document.getElementById('lotSelect');
    lotSelect.innerHTML = '<option value="">Không dùng lô</option>';
    const response = await fetch(`/api/asset-inventory-food-lots?categoryId=${categoryId}`);
    if (response.ok) {
      const lots = await response.json();
      lots.forEach((lot) => {
        const opt = document.createElement('option');
        opt.value = lot.id;
        opt.textContent = `Hạn: ${lot.expiryDate || 'Chưa xác định'}${lot.note ? ' — ' + lot.note : ''}`;
        lotSelect.appendChild(opt);
      });
    }
  }
}

document.getElementById('openTransactionFormBtn').addEventListener('click', () => {
  document.getElementById('transactionForm').reset();
  document.getElementById('transactionFormError').textContent = '';
  updateTransactionFormFields();
  document.getElementById('transactionFormOverlay').classList.remove('hidden');
});
document.getElementById('transactionFormCloseBtn').addEventListener('click', () => {
  document.getElementById('transactionFormOverlay').classList.add('hidden');
});

document.getElementById('transactionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const errorEl = document.getElementById('transactionFormError');
  errorEl.textContent = '';

  const shape = document.getElementById('movementTypeSelect').value;
  const categoryId = Number(form.querySelector('[name="categoryId"]').value);
  const locationId = Number(form.querySelector('[name="locationId"]').value);
  const quantity = Number(form.querySelector('[name="quantity"]').value);
  const recipient = form.querySelector('[name="recipient"]').value || undefined;
  const reason = form.querySelector('[name="reason"]').value || undefined;
  const note = form.querySelector('[name="note"]').value || undefined;

  let payload;
  if (shape === 'transfer') {
    payload = { action: 'transfer', categoryId, fromLocationId: locationId, toLocationId: Number(form.querySelector('[name="toLocationId"]').value), quantity, note };
  } else if (shape === 'linenTransition') {
    const toStatus = form.querySelector('[name="toStatus"]').value;
    payload = { action: 'linenTransition', categoryId, locationId, fromStatus: LINEN_PREVIOUS_STATUS[toStatus], toStatus, quantity, note };
  } else {
    const movementType = shape.split(':')[1];
    const lotIdRaw = form.querySelector('[name="lotId"]').value;
    payload = { action: 'single', categoryId, locationId, movementType, quantity, recipient, reason, note };
    if (lotIdRaw) payload.lotId = Number(lotIdRaw);
    if (movementType === 'adjustment') payload.direction = form.querySelector('[name="direction"]').value;
  }

  const response = await fetch('/api/asset-inventory-transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi ghi phiếu';
    return;
  }
  document.getElementById('transactionFormOverlay').classList.add('hidden');
  await loadStock();
});

// ---- Nhập lô mới form ----

function populateLotFormSelects() {
  const categorySelect = document.getElementById('lotCategorySelect');
  categories.filter((c) => c.managementType === 'food_beverage').forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    categorySelect.appendChild(opt);
  });
  const locationSelect = document.getElementById('lotLocationSelect');
  locations.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    locationSelect.appendChild(opt);
  });
}

document.getElementById('openLotFormBtn').addEventListener('click', () => {
  document.getElementById('lotForm').reset();
  document.getElementById('lotFormError').textContent = '';
  document.getElementById('lotFormOverlay').classList.remove('hidden');
});
document.getElementById('lotFormCloseBtn').addEventListener('click', () => {
  document.getElementById('lotFormOverlay').classList.add('hidden');
});

document.getElementById('lotForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const errorEl = document.getElementById('lotFormError');
  errorEl.textContent = '';

  const payload = {
    categoryId: Number(form.querySelector('[name="categoryId"]').value),
    locationId: Number(form.querySelector('[name="locationId"]').value),
    receivedDate: form.querySelector('[name="receivedDate"]').value || undefined,
    expiryDate: form.querySelector('[name="expiryDate"]').value || undefined,
    note: form.querySelector('[name="note"]').value || undefined,
  };

  const response = await fetch('/api/asset-inventory-food-lots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu lô';
    return;
  }
  document.getElementById('lotFormOverlay').classList.add('hidden');
  await loadFoodLots();
});
