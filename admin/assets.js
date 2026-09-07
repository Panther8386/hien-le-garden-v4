// v4/admin/assets.js
let currentRole = null;
let categories = [];
let locations = [];
let editingAssetId = null;
let editingManagementType = null;

const PHYSICAL_CONDITION_LABELS = { chua_danh_gia: 'Chưa đánh giá', tot: 'Tốt', kha: 'Khá', trung_binh: 'Trung bình', can_sua: 'Cần sửa' };
const OPERATIONAL_STATUS_LABELS = { san_sang: 'Sẵn sàng', dang_su_dung: 'Đang sử dụng', ngung_su_dung: 'Ngừng sử dụng', dang_sua: 'Đang sửa' };
const SOURCE_TYPE_LABELS = { handover_a: 'Bàn giao (Bên A)', purchased_b: 'Bên B mua mới', other: 'Khác' };
const INDIVIDUAL_MANAGEMENT_TYPES = ['individual_device', 'device_set'];

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
    document.getElementById('openAddAssetBtn').classList.remove('hidden');
  }

  await loadCategories();
  await loadLocations();
  await loadAssets();

  document.getElementById('filterCategory').addEventListener('change', loadAssets);
  document.getElementById('filterLocation').addEventListener('change', loadAssets);
  document.getElementById('filterSourceType').addEventListener('change', loadAssets);
  document.getElementById('filterSearch').addEventListener('input', loadAssets);
})();

async function loadCategories() {
  let response;
  try {
    response = await fetch('/api/asset-categories');
  } catch (err) {
    return;
  }
  if (!response.ok) return;
  categories = await response.json();

  const filterSelect = document.getElementById('filterCategory');
  const formSelect = document.querySelector('#assetForm select[name="categoryId"]');
  [filterSelect].forEach((select) => {
    while (select.options.length > 1) select.remove(1);
  });
  formSelect.innerHTML = '';
  categories.forEach((c) => {
    const filterOpt = document.createElement('option');
    filterOpt.value = c.id;
    filterOpt.textContent = `${c.name} (${c.managementType})`;
    filterSelect.appendChild(filterOpt);

    const formOpt = document.createElement('option');
    formOpt.value = c.id;
    formOpt.textContent = c.name;
    formOpt.dataset.managementType = c.managementType;
    formSelect.appendChild(formOpt);
  });
}

async function loadLocations() {
  let response;
  try {
    response = await fetch('/api/asset-locations');
  } catch (err) {
    return;
  }
  if (!response.ok) return;
  locations = await response.json();

  const filterSelect = document.getElementById('filterLocation');
  const formSelect = document.querySelector('#assetForm select[name="locationId"]');
  while (filterSelect.options.length > 1) filterSelect.remove(1);
  while (formSelect.options.length > 1) formSelect.remove(1);
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

function categoryById(id) {
  return categories.find((c) => c.id === Number(id));
}

async function loadAssets() {
  showPageError('');
  const params = new URLSearchParams();
  const categoryId = document.getElementById('filterCategory').value;
  const locationId = document.getElementById('filterLocation').value;
  const sourceType = document.getElementById('filterSourceType').value;
  const q = document.getElementById('filterSearch').value.trim();
  if (categoryId) params.set('categoryId', categoryId);
  if (locationId) params.set('locationId', locationId);
  if (sourceType) params.set('sourceType', sourceType);
  if (q) params.set('q', q);

  let response;
  try {
    response = await fetch(`/api/assets?${params.toString()}`);
  } catch (err) {
    showPageError('Có lỗi khi tải danh sách tài sản');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showPageError(body.error || 'Có lỗi khi tải danh sách tài sản');
    return;
  }
  const assets = await response.json();
  renderAssetList(assets);
}

function locationName(locationId) {
  const loc = locations.find((l) => l.id === locationId);
  return loc ? loc.name : 'Chưa phân bổ vị trí';
}

function renderAssetList(assets) {
  const container = document.getElementById('assetList');
  container.innerHTML = '';
  if (assets.length === 0) {
    const p = document.createElement('p');
    p.className = 'booking-empty';
    p.textContent = 'Chưa có tài sản nào phù hợp bộ lọc.';
    container.appendChild(p);
    return;
  }
  assets.forEach((a) => {
    const card = document.createElement('div');
    card.className = 'booking-card';
    const line1 = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = a.name;
    line1.appendChild(strong);
    line1.append(a.internalCode ? ` — ${a.internalCode}` : '');
    card.appendChild(line1);

    const line2 = document.createElement('p');
    const category = categoryById(a.categoryId);
    line2.textContent = `${category ? category.name : a.managementType} — ${locationName(a.locationId)} — ${SOURCE_TYPE_LABELS[a.sourceType]}`;
    card.appendChild(line2);

    const line3 = document.createElement('p');
    line3.textContent = `${a.quantity !== null ? `Số lượng: ${a.quantity}` : 'Số lượng: Chưa xác định'} — ${PHYSICAL_CONDITION_LABELS[a.physicalCondition]} — ${OPERATIONAL_STATUS_LABELS[a.operationalStatus]}`;
    card.appendChild(line3);

    if (currentRole === 'admin' || currentRole === 'manager') {
      const actions = document.createElement('div');
      actions.className = 'booking-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'table-actions-btn';
      editBtn.textContent = 'Sửa';
      editBtn.addEventListener('click', () => openEditAsset(a));
      actions.appendChild(editBtn);
      card.appendChild(actions);
    }

    container.appendChild(card);
  });
}

function isIndividualManagementType(managementType) {
  return INDIVIDUAL_MANAGEMENT_TYPES.includes(managementType);
}

function toggleQuantityField(managementType) {
  document.getElementById('assetQuantityWrap').classList.toggle('hidden', isIndividualManagementType(managementType));
}

function openFormOverlay() {
  document.getElementById('assetFormOverlay').classList.remove('hidden');
}
function closeFormOverlay() {
  document.getElementById('assetFormOverlay').classList.add('hidden');
}

document.getElementById('openAddAssetBtn').addEventListener('click', () => {
  editingAssetId = null;
  editingManagementType = null;
  const form = document.getElementById('assetForm');
  form.reset();
  form.querySelector('select[name="categoryId"]').disabled = false;
  document.getElementById('assetFormTitle').textContent = 'Thêm tài sản';
  document.getElementById('assetFormError').textContent = '';
  document.getElementById('assetQrSection').classList.add('hidden');
  document.getElementById('assetPhotoSection').classList.add('hidden');
  const firstCategory = categories[0];
  toggleQuantityField(firstCategory ? firstCategory.managementType : 'durable_goods');
  openFormOverlay();
});

document.querySelector('#assetForm select[name="categoryId"]').addEventListener('change', (event) => {
  if (editingAssetId) return;
  const selected = event.target.selectedOptions[0];
  toggleQuantityField(selected ? selected.dataset.managementType : '');
});

document.getElementById('assetFormCloseBtn').addEventListener('click', closeFormOverlay);

function renderQrCode(internalCode) {
  const qrContainer = document.getElementById('assetQrCode');
  qrContainer.innerHTML = '';
  // eslint-disable-next-line no-undef
  new QRCode(qrContainer, { text: internalCode, width: 128, height: 128 });
}

document.getElementById('downloadQrBtn').addEventListener('click', () => {
  const canvas = document.querySelector('#assetQrCode canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `${document.getElementById('assetInternalCode').textContent}.png`;
  link.click();
});

function openEditAsset(asset) {
  editingAssetId = asset.id;
  editingManagementType = asset.managementType;
  const form = document.getElementById('assetForm');
  form.reset();
  form.querySelector('select[name="categoryId"]').value = asset.categoryId;
  form.querySelector('select[name="categoryId"]').disabled = true;
  form.querySelector('input[name="name"]').value = asset.name;
  form.querySelector('input[name="brand"]').value = asset.brand || '';
  form.querySelector('input[name="serialNumber"]').value = asset.serialNumber || '';
  form.querySelector('select[name="sourceType"]').value = asset.sourceType;
  form.querySelector('input[name="acquiredDate"]').value = asset.acquiredDate || '';
  form.querySelector('input[name="purchasePrice"]').value = asset.purchasePrice ?? '';
  form.querySelector('select[name="locationId"]').value = asset.locationId || '';
  form.querySelector('input[name="holder"]').value = asset.holder || '';
  form.querySelector('input[name="quantity"]').value = asset.quantity ?? '';
  form.querySelector('select[name="physicalCondition"]').value = asset.physicalCondition;
  form.querySelector('select[name="operationalStatus"]').value = asset.operationalStatus;
  form.querySelector('select[name="lifecycleStatus"]').value = asset.lifecycleStatus;
  form.querySelector('input[name="note"]').value = asset.note || '';

  toggleQuantityField(asset.managementType);
  document.getElementById('assetFormTitle').textContent = 'Sửa tài sản';
  document.getElementById('assetFormError').textContent = '';

  if (isIndividualManagementType(asset.managementType)) {
    document.getElementById('assetQrSection').classList.remove('hidden');
    document.getElementById('assetInternalCode').textContent = asset.internalCode || '';
    renderQrCode(asset.internalCode);
  } else {
    document.getElementById('assetQrSection').classList.add('hidden');
  }

  document.getElementById('assetPhotoSection').classList.remove('hidden');
  document.getElementById('assetPhotoInfo').textContent = asset.photoFilename ? `Ảnh hiện tại: ${asset.photoFilename}` : 'Chưa có ảnh đính kèm.';
  document.getElementById('deletePhotoBtn').classList.toggle('hidden', !asset.photoFilename);

  openFormOverlay();
}

document.getElementById('uploadPhotoBtn').addEventListener('click', async () => {
  if (!editingAssetId) return;
  const fileInput = document.getElementById('assetPhotoInput');
  if (!fileInput.files[0]) return;
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  const errorEl = document.getElementById('assetFormError');
  let response;
  try {
    response = await fetch(`/api/assets/${editingAssetId}/photo`, { method: 'POST', body: formData });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải ảnh lên';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải ảnh lên';
    return;
  }
  const { photoFilename } = await response.json();
  document.getElementById('assetPhotoInfo').textContent = `Ảnh hiện tại: ${photoFilename}`;
  document.getElementById('deletePhotoBtn').classList.remove('hidden');
  errorEl.textContent = '';
});

document.getElementById('deletePhotoBtn').addEventListener('click', async () => {
  if (!editingAssetId) return;
  const errorEl = document.getElementById('assetFormError');
  let response;
  try {
    response = await fetch(`/api/assets/${editingAssetId}/photo`, { method: 'DELETE' });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi xoá ảnh';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi xoá ảnh';
    return;
  }
  document.getElementById('assetPhotoInfo').textContent = 'Chưa có ảnh đính kèm.';
  document.getElementById('deletePhotoBtn').classList.add('hidden');
  errorEl.textContent = '';
});

document.getElementById('assetForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const errorEl = document.getElementById('assetFormError');
  errorEl.textContent = '';

  const purchasePriceValue = form.querySelector('input[name="purchasePrice"]').value;
  const quantityValue = form.querySelector('input[name="quantity"]').value;

  const payload = {
    name: form.querySelector('input[name="name"]').value,
    brand: form.querySelector('input[name="brand"]').value,
    serialNumber: form.querySelector('input[name="serialNumber"]').value,
    sourceType: form.querySelector('select[name="sourceType"]').value,
    acquiredDate: form.querySelector('input[name="acquiredDate"]').value || null,
    purchasePrice: purchasePriceValue === '' ? null : Number(purchasePriceValue),
    locationId: form.querySelector('select[name="locationId"]').value ? Number(form.querySelector('select[name="locationId"]').value) : null,
    holder: form.querySelector('input[name="holder"]').value,
    physicalCondition: form.querySelector('select[name="physicalCondition"]').value,
    operationalStatus: form.querySelector('select[name="operationalStatus"]').value,
    lifecycleStatus: form.querySelector('select[name="lifecycleStatus"]').value,
    note: form.querySelector('input[name="note"]').value,
  };
  if (!editingAssetId || !isIndividualManagementType(editingManagementType)) {
    payload.quantity = quantityValue === '' ? null : Number(quantityValue);
  }

  let response;
  try {
    if (editingAssetId) {
      response = await fetch(`/api/assets/${editingAssetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      payload.categoryId = Number(form.querySelector('select[name="categoryId"]').value);
      response = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi lưu tài sản';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu tài sản';
    return;
  }

  closeFormOverlay();
  await loadAssets();
});
