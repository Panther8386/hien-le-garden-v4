// v4/admin/asset-inventory.js
let currentRole = null;
let locations = [];

let batchesAll = [];
let batchPage = 1;
const BATCH_PAGE_SIZE = 10;

let missingAll = [];
let missingPage = 1;
const MISSING_PAGE_SIZE = 10;

let currentBatch = null;

const BATCH_STATUS_LABELS = { draft: 'Nháp', counting: 'Đang kiểm kê', pending_close: 'Chờ chốt', closed: 'Đã chốt' };
const CONDITION_LABELS = { chua_danh_gia: 'Chưa đánh giá', tot: 'Tốt', kha: 'Khá', trung_binh: 'Trung bình', can_sua: 'Cần sửa' };
const NEXT_STATUS_LABEL = { draft: { next: 'counting', label: 'Bắt đầu kiểm kê' }, counting: { next: 'pending_close', label: 'Gửi chờ chốt' }, pending_close: { next: 'closed', label: 'Chốt đợt' } };

function showPageError(message) {
  document.getElementById('pageError').textContent = message || '';
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

  if (currentRole === 'admin' || currentRole === 'manager') {
    document.getElementById('openCreateBatchBtn').classList.remove('hidden');
  }

  await loadLocations();
  await loadBatches();

  document.getElementById('batchFilterLocation').addEventListener('change', loadBatches);
  document.getElementById('batchFilterStatus').addEventListener('change', loadBatches);
  document.getElementById('batchPrevBtn').addEventListener('click', () => {
    if (batchPage > 1) { batchPage -= 1; renderBatchPage(); }
  });
  document.getElementById('batchNextBtn').addEventListener('click', () => {
    batchPage += 1; renderBatchPage();
  });
  document.getElementById('missingPrevBtn').addEventListener('click', () => {
    if (missingPage > 1) { missingPage -= 1; renderMissingPage(); }
  });
  document.getElementById('missingNextBtn').addEventListener('click', () => {
    missingPage += 1; renderMissingPage();
  });
})();

document.querySelectorAll('#inventoryTabToggle .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#inventoryTabToggle .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('batchesTab').classList.toggle('hidden', tab !== 'batches');
    document.getElementById('missingTab').classList.toggle('hidden', tab !== 'missing');
    if (tab === 'missing' && missingAll.length === 0) loadMissingDevices();
  });
});

async function loadLocations() {
  let response;
  try {
    response = await fetch('/api/asset-locations');
  } catch (err) {
    return;
  }
  if (!response.ok) return;
  locations = await response.json();

  const filterSelect = document.getElementById('batchFilterLocation');
  const formSelect = document.querySelector('#createBatchForm select[name="locationId"]');
  while (filterSelect.options.length > 1) filterSelect.remove(1);
  formSelect.innerHTML = '';
  locations.forEach((l) => {
    const filterOpt = document.createElement('option');
    filterOpt.value = l.id;
    filterOpt.textContent = l.name;
    filterSelect.appendChild(filterOpt);

    const formOpt = document.createElement('option');
    formOpt.value = l.id;
    formOpt.textContent = l.name;
    formSelect.appendChild(formOpt);
  });
}

function locationName(locationId) {
  const loc = locations.find((l) => l.id === locationId);
  return loc ? loc.name : 'Không rõ vị trí';
}

async function loadBatches() {
  showPageError('');
  const params = new URLSearchParams();
  const locationId = document.getElementById('batchFilterLocation').value;
  const status = document.getElementById('batchFilterStatus').value;
  if (locationId) params.set('locationId', locationId);
  if (status) params.set('status', status);

  let response;
  try {
    response = await fetch(`/api/asset-inventory-batches?${params.toString()}`);
  } catch (err) {
    showPageError('Có lỗi khi tải danh sách đợt kiểm kê');
    return;
  }
  if (!response.ok) {
    showPageError('Có lỗi khi tải danh sách đợt kiểm kê');
    return;
  }
  batchesAll = await response.json();
  batchPage = 1;
  renderBatchPage();
}

function renderBatchPage() {
  const totalPages = Math.max(1, Math.ceil(batchesAll.length / BATCH_PAGE_SIZE));
  if (batchPage > totalPages) batchPage = totalPages;
  const offset = (batchPage - 1) * BATCH_PAGE_SIZE;
  const pageItems = batchesAll.slice(offset, offset + BATCH_PAGE_SIZE);

  const container = document.getElementById('batchList');
  container.innerHTML = '';
  if (pageItems.length === 0) {
    const p = document.createElement('p');
    p.className = 'booking-empty';
    p.textContent = 'Chưa có đợt kiểm kê nào phù hợp bộ lọc.';
    container.appendChild(p);
  } else {
    pageItems.forEach((b) => {
      const card = document.createElement('div');
      card.className = 'booking-card';
      const line1 = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = b.label;
      line1.appendChild(strong);
      line1.append(` — ${locationName(b.locationId)}`);
      card.appendChild(line1);

      const line2 = document.createElement('p');
      const badge = document.createElement('span');
      badge.className = `status-badge status-${b.status}`;
      badge.textContent = BATCH_STATUS_LABELS[b.status] || b.status;
      line2.appendChild(badge);
      card.appendChild(line2);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'table-actions-btn';
      openBtn.textContent = 'Xem chi tiết';
      openBtn.addEventListener('click', () => openBatchDetail(b.id));
      card.appendChild(openBtn);

      container.appendChild(card);
    });
  }

  document.getElementById('batchPageInfo').textContent = `Trang ${batchPage}/${totalPages} (${batchesAll.length} kết quả)`;
  document.getElementById('batchPrevBtn').disabled = batchPage <= 1;
  document.getElementById('batchNextBtn').disabled = batchPage >= totalPages;
}

async function loadMissingDevices() {
  let response;
  try {
    response = await fetch('/api/asset-inventory-lines/missing-devices');
  } catch (err) {
    showPageError('Có lỗi khi tải danh sách thiết bị không tìm thấy');
    return;
  }
  if (!response.ok) {
    showPageError('Có lỗi khi tải danh sách thiết bị không tìm thấy');
    return;
  }
  missingAll = await response.json();
  missingPage = 1;
  renderMissingPage();
}

function renderMissingPage() {
  const totalPages = Math.max(1, Math.ceil(missingAll.length / MISSING_PAGE_SIZE));
  if (missingPage > totalPages) missingPage = totalPages;
  const offset = (missingPage - 1) * MISSING_PAGE_SIZE;
  const pageItems = missingAll.slice(offset, offset + MISSING_PAGE_SIZE);

  const container = document.getElementById('missingList');
  container.innerHTML = '';
  if (pageItems.length === 0) {
    const p = document.createElement('p');
    p.className = 'booking-empty';
    p.textContent = 'Không có thiết bị nào được ghi nhận "không tìm thấy".';
    container.appendChild(p);
  } else {
    pageItems.forEach((m) => {
      const card = document.createElement('div');
      card.className = 'booking-card';
      const line1 = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = m.assetName;
      line1.appendChild(strong);
      line1.append(m.internalCode ? ` — ${m.internalCode}` : '');
      card.appendChild(line1);
      const line2 = document.createElement('p');
      line2.textContent = `${m.locationName} — ${m.batchLabel} — chốt ${new Date(m.closedAt).toLocaleDateString('vi-VN')}`;
      card.appendChild(line2);
      if (m.note) {
        const line3 = document.createElement('p');
        line3.textContent = `Ghi chú: ${m.note}`;
        card.appendChild(line3);
      }
      container.appendChild(card);
    });
  }

  document.getElementById('missingPageInfo').textContent = `Trang ${missingPage}/${totalPages} (${missingAll.length} kết quả)`;
  document.getElementById('missingPrevBtn').disabled = missingPage <= 1;
  document.getElementById('missingNextBtn').disabled = missingPage >= totalPages;
}

document.getElementById('openCreateBatchBtn').addEventListener('click', () => {
  document.getElementById('createBatchForm').reset();
  document.getElementById('createBatchError').textContent = '';
  document.getElementById('createBatchOverlay').classList.remove('hidden');
});

document.getElementById('createBatchCancelBtn').addEventListener('click', () => {
  document.getElementById('createBatchOverlay').classList.add('hidden');
});

document.getElementById('createBatchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const errorEl = document.getElementById('createBatchError');
  errorEl.textContent = '';

  const locationId = Number(form.querySelector('select[name="locationId"]').value);
  if (!locationId) {
    errorEl.textContent = 'Vui lòng chọn vị trí';
    return;
  }
  const label = form.querySelector('input[name="label"]').value.trim();
  const note = form.querySelector('input[name="note"]').value.trim();

  let response;
  try {
    response = await fetch('/api/asset-inventory-batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, label: label || undefined, note: note || undefined }),
    });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tạo đợt kiểm kê';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tạo đợt kiểm kê';
    return;
  }
  const { id } = await response.json();
  document.getElementById('createBatchOverlay').classList.add('hidden');
  await loadBatches();
  await openBatchDetail(id);
});

function canTransition(status, role) {
  if (status === 'draft') return role === 'admin' || role === 'manager';
  if (status === 'counting') return role === 'admin' || role === 'manager' || role === 'reception';
  if (status === 'pending_close') return role === 'admin' || role === 'manager';
  return false;
}

function canWriteLine(status, role) {
  if (status === 'counting') return true;
  if (status === 'pending_close') return role === 'admin' || role === 'manager';
  return false;
}

async function openBatchDetail(batchId) {
  document.getElementById('batchDetailError').textContent = '';
  let response;
  try {
    response = await fetch(`/api/asset-inventory-batches/${batchId}`);
  } catch (err) {
    showPageError('Có lỗi khi tải chi tiết đợt kiểm kê');
    return;
  }
  if (!response.ok) {
    showPageError('Có lỗi khi tải chi tiết đợt kiểm kê');
    return;
  }
  currentBatch = await response.json();
  renderBatchDetail();
  document.getElementById('batchDetailOverlay').classList.remove('hidden');
}

function renderBatchDetail() {
  const b = currentBatch;
  document.getElementById('batchDetailTitle').textContent = b.label;
  document.getElementById('batchDetailMeta').textContent = `${locationName(b.locationId)} — ${BATCH_STATUS_LABELS[b.status]} — tạo bởi ${b.createdBy}${b.closedBy ? ` — chốt bởi ${b.closedBy}` : ''}`;

  const actions = document.getElementById('batchDetailActions');
  actions.innerHTML = '';

  if (canTransition(b.status, currentRole)) {
    const info = NEXT_STATUS_LABEL[b.status];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = info.label;
    btn.addEventListener('click', () => transitionBatch(info.next));
    actions.appendChild(btn);
  }

  if (b.status !== 'closed' && (currentRole === 'admin' || currentRole === 'manager')) {
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'btn-secondary';
    refreshBtn.textContent = 'Làm mới danh sách dòng';
    refreshBtn.addEventListener('click', refreshLines);
    actions.appendChild(refreshBtn);
  }

  const tbody = document.querySelector('#batchLinesTable tbody');
  tbody.innerHTML = '';
  const writable = canWriteLine(b.status, currentRole);
  b.lines.forEach((line) => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = `${line.assetName}${line.internalCode ? ' (' + line.internalCode + ')' : ''}`;
    tr.appendChild(nameTd);

    const bookTd = document.createElement('td');
    bookTd.textContent = line.bookQuantity ?? 'Chưa xác định';
    tr.appendChild(bookTd);

    const actualTd = document.createElement('td');
    const actualInput = document.createElement('input');
    actualInput.type = 'number';
    actualInput.min = '0';
    actualInput.step = '1';
    actualInput.value = line.actualQuantity ?? '';
    actualInput.disabled = !writable;
    actualTd.appendChild(actualInput);
    tr.appendChild(actualTd);

    const conditionTd = document.createElement('td');
    const conditionSelect = document.createElement('select');
    Object.entries(CONDITION_LABELS).forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      opt.selected = line.conditionFound === value;
      conditionSelect.appendChild(opt);
    });
    conditionSelect.disabled = !writable;
    conditionTd.appendChild(conditionSelect);
    tr.appendChild(conditionTd);

    const photoTd = document.createElement('td');
    const photoInfo = document.createElement('span');
    photoInfo.textContent = line.photoFilename || '—';
    photoTd.appendChild(photoInfo);
    if (writable) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/jpeg,image/png,image/webp,application/pdf';
      fileInput.style.display = 'none';
      const uploadBtn = document.createElement('button');
      uploadBtn.type = 'button';
      uploadBtn.className = 'table-actions-btn';
      uploadBtn.textContent = 'Tải ảnh';
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        if (!fileInput.files[0]) return;
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        const errorEl = document.getElementById('batchDetailError');
        let uploadResponse;
        try {
          uploadResponse = await fetch(`/api/asset-inventory-lines/${line.id}/photo`, { method: 'POST', body: formData });
        } catch (err) {
          errorEl.textContent = 'Có lỗi khi tải ảnh lên';
          return;
        }
        if (!uploadResponse.ok) {
          const body = await uploadResponse.json().catch(() => ({}));
          errorEl.textContent = body.error || 'Có lỗi khi tải ảnh lên';
          return;
        }
        await openBatchDetail(currentBatch.id);
      });
      photoTd.appendChild(uploadBtn);
      photoTd.appendChild(fileInput);
    }
    tr.appendChild(photoTd);

    const noteTd = document.createElement('td');
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.value = line.note || '';
    noteInput.disabled = !writable;
    noteTd.appendChild(noteInput);
    tr.appendChild(noteTd);

    const suggestedTd = document.createElement('td');
    const suggestedInput = document.createElement('input');
    suggestedInput.type = 'text';
    suggestedInput.value = line.suggestedAction || '';
    suggestedInput.disabled = !writable;
    suggestedTd.appendChild(suggestedInput);
    tr.appendChild(suggestedTd);

    const saveTd = document.createElement('td');
    if (writable) {
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'table-actions-btn';
      saveBtn.textContent = 'Lưu';
      saveBtn.addEventListener('click', () => saveLine(line.id, actualInput, conditionSelect, noteInput, suggestedInput));
      saveTd.appendChild(saveBtn);
    }
    tr.appendChild(saveTd);

    tbody.appendChild(tr);
  });
}

async function saveLine(lineId, actualInput, conditionSelect, noteInput, suggestedInput) {
  const errorEl = document.getElementById('batchDetailError');
  errorEl.textContent = '';
  const payload = {
    actualQuantity: actualInput.value === '' ? null : Number(actualInput.value),
    conditionFound: conditionSelect.value,
    note: noteInput.value,
    suggestedAction: suggestedInput.value,
  };
  let response;
  try {
    response = await fetch(`/api/asset-inventory-lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi lưu dòng kiểm kê';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu dòng kiểm kê';
    return;
  }
  await openBatchDetail(currentBatch.id);
}

async function transitionBatch(nextStatus) {
  const errorEl = document.getElementById('batchDetailError');
  errorEl.textContent = '';
  let response;
  try {
    response = await fetch(`/api/asset-inventory-batches/${currentBatch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi chuyển trạng thái';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi chuyển trạng thái';
    return;
  }
  await openBatchDetail(currentBatch.id);
  await loadBatches();
}

async function refreshLines() {
  const errorEl = document.getElementById('batchDetailError');
  errorEl.textContent = '';
  let response;
  try {
    response = await fetch(`/api/asset-inventory-batches/${currentBatch.id}/refresh-lines`, { method: 'POST' });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi làm mới danh sách dòng';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi làm mới danh sách dòng';
    return;
  }
  await openBatchDetail(currentBatch.id);
}

document.getElementById('batchDetailCloseBtn').addEventListener('click', () => {
  currentBatch = null;
  document.getElementById('batchDetailOverlay').classList.add('hidden');
});
