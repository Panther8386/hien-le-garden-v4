// v4/admin/asset-config.js
let currentRole = null;
let categories = [];
let locations = [];
let currentLocationType = 'room';
let roomsById = {};

const MANAGEMENT_TYPE_LABELS = {
  infrastructure: 'Công trình & hạ tầng',
  individual_device: 'Thiết bị riêng lẻ',
  device_set: 'Bộ thiết bị',
  durable_goods: 'Đồ dùng bền theo số lượng',
  linen: 'Đồ vải luân chuyển',
  consumable: 'Vật tư tiêu hao',
  spare_part: 'Phụ tùng',
  food_beverage: 'Thực phẩm, thức uống',
};
const MANAGEMENT_TYPE_ORDER = ['infrastructure', 'individual_device', 'device_set', 'durable_goods', 'linen', 'consumable', 'spare_part', 'food_beverage'];

function showPageError(message) {
  document.getElementById('pageError').textContent = message || '';
}

function populateManagementTypeSelect(select) {
  select.innerHTML = '';
  MANAGEMENT_TYPE_ORDER.forEach((type) => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = MANAGEMENT_TYPE_LABELS[type];
    select.appendChild(opt);
  });
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

  if (currentRole === 'admin') {
    document.getElementById('openAddCategoryBtn').classList.remove('hidden');
    document.getElementById('openAddLocationBtn').classList.remove('hidden');
  }

  populateManagementTypeSelect(document.querySelector('#categoryForm select[name="managementType"]'));

  await loadRooms();
  await loadCategories();
  await loadLocations();
})();

async function loadRooms() {
  let response;
  try {
    response = await fetch('/api/rooms');
  } catch (err) {
    return;
  }
  if (!response.ok) return;
  const rooms = await response.json();
  roomsById = {};
  rooms.forEach((r) => { roomsById[r.id] = r; });
  const select = document.querySelector('#locationForm select[name="roomId"]');
  select.innerHTML = '';
  rooms.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  });
}

async function loadCategories() {
  showPageError('');
  let response;
  try {
    response = await fetch('/api/asset-categories?includeInactive=1');
  } catch (err) {
    showPageError('Có lỗi khi tải danh mục');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showPageError(body.error || 'Có lỗi khi tải danh mục');
    return;
  }
  categories = await response.json();
  renderCategories();
}

function renderCategories() {
  const container = document.getElementById('categoryGroups');
  container.innerHTML = '';
  MANAGEMENT_TYPE_ORDER.forEach((type) => {
    const group = categories.filter((c) => c.managementType === type);
    if (group.length === 0) return;
    const h3 = document.createElement('h3');
    h3.textContent = MANAGEMENT_TYPE_LABELS[type];
    container.appendChild(h3);
    const list = document.createElement('div');
    list.className = 'booking-list';
    group.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'booking-card';
      if (!c.isActive) card.style.opacity = '0.5';
      const p = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = c.name;
      p.append(strong, ` — ${c.defaultUnit}${c.isActive ? '' : ' (đã ngừng dùng)'}`);
      card.appendChild(p);
      if (c.note) {
        const noteP = document.createElement('p');
        noteP.textContent = c.note;
        card.appendChild(noteP);
      }
      if (currentRole === 'admin') {
        const actions = document.createElement('div');
        actions.className = 'booking-actions';
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'table-actions-btn';
        editBtn.textContent = 'Sửa';
        editBtn.addEventListener('click', () => openEditCategory(c));
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn-secondary table-actions-btn';
        toggleBtn.textContent = c.isActive ? 'Ngừng dùng' : 'Dùng lại';
        toggleBtn.addEventListener('click', () => toggleCategoryActive(c));
        actions.append(editBtn, toggleBtn);
        card.appendChild(actions);
      }
      list.appendChild(card);
    });
    container.appendChild(list);
  });
}

function openCategoryFormOverlay() {
  document.getElementById('categoryFormOverlay').classList.remove('hidden');
}
function closeCategoryFormOverlay() {
  document.getElementById('categoryFormOverlay').classList.add('hidden');
}

document.getElementById('openAddCategoryBtn').addEventListener('click', () => {
  const form = document.getElementById('categoryForm');
  form.reset();
  delete form.dataset.editingId;
  form.querySelector('[name="managementType"]').disabled = false;
  document.getElementById('categoryFormTitle').textContent = 'Thêm danh mục';
  document.getElementById('categoryFormError').textContent = '';
  openCategoryFormOverlay();
});

document.getElementById('categoryFormCloseBtn').addEventListener('click', closeCategoryFormOverlay);

function openEditCategory(c) {
  const form = document.getElementById('categoryForm');
  form.reset();
  form.querySelector('[name="managementType"]').value = c.managementType;
  form.querySelector('[name="managementType"]').disabled = true;
  form.querySelector('[name="name"]').value = c.name;
  form.querySelector('[name="defaultUnit"]').value = c.defaultUnit;
  form.querySelector('[name="note"]').value = c.note || '';
  form.dataset.editingId = c.id;
  document.getElementById('categoryFormTitle').textContent = 'Sửa danh mục';
  document.getElementById('categoryFormError').textContent = '';
  openCategoryFormOverlay();
}

async function toggleCategoryActive(c) {
  showPageError('');
  const response = await fetch(`/api/asset-categories/${c.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive: !c.isActive }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showPageError(body.error || 'Có lỗi khi cập nhật danh mục');
    return;
  }
  await loadCategories();
}

document.getElementById('categoryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const errorEl = document.getElementById('categoryFormError');
  errorEl.textContent = '';

  const editingId = form.dataset.editingId;
  const payload = editingId
    ? {
        name: form.querySelector('[name="name"]').value,
        defaultUnit: form.querySelector('[name="defaultUnit"]').value,
        note: form.querySelector('[name="note"]').value,
      }
    : {
        managementType: form.querySelector('[name="managementType"]').value,
        name: form.querySelector('[name="name"]').value,
        defaultUnit: form.querySelector('[name="defaultUnit"]').value,
        note: form.querySelector('[name="note"]').value,
      };

  let response;
  try {
    response = await fetch(editingId ? `/api/asset-categories/${editingId}` : '/api/asset-categories', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi lưu danh mục';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu danh mục';
    return;
  }

  closeCategoryFormOverlay();
  await loadCategories();
});

async function loadLocations() {
  showPageError('');
  let response;
  try {
    response = await fetch('/api/asset-locations?includeInactive=1');
  } catch (err) {
    showPageError('Có lỗi khi tải vị trí');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showPageError(body.error || 'Có lỗi khi tải vị trí');
    return;
  }
  locations = await response.json();
  renderLocations();
}

function renderLocations() {
  const container = document.getElementById('locationList');
  container.innerHTML = '';
  const filtered = locations.filter((l) => l.locationType === currentLocationType);
  if (filtered.length === 0) {
    const p = document.createElement('p');
    p.className = 'booking-empty';
    p.textContent = 'Chưa có vị trí nào.';
    container.appendChild(p);
    return;
  }
  filtered.forEach((l) => {
    const card = document.createElement('div');
    card.className = 'booking-card';
    if (!l.isActive) card.style.opacity = '0.5';
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = l.name;
    p.append(strong, ` — ${l.code || ''}${l.isActive ? '' : ' (đã ngừng dùng)'}`);
    card.appendChild(p);
    if (l.locationType === 'room' && roomsById[l.roomId]) {
      const roomNameP = document.createElement('p');
      roomNameP.style.opacity = '0.75';
      roomNameP.style.fontStyle = 'italic';
      roomNameP.textContent = `Tên phòng gốc (dùng cho đặt phòng): ${roomsById[l.roomId].name}`;
      card.appendChild(roomNameP);
    }
    if (l.note) {
      const noteP = document.createElement('p');
      noteP.textContent = l.note;
      card.appendChild(noteP);
    }
    if (currentRole === 'admin') {
      const actions = document.createElement('div');
      actions.className = 'booking-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'table-actions-btn';
      editBtn.textContent = 'Sửa';
      editBtn.addEventListener('click', () => openEditLocation(l));
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn-secondary table-actions-btn';
      toggleBtn.textContent = l.isActive ? 'Ngừng dùng' : 'Dùng lại';
      toggleBtn.addEventListener('click', () => toggleLocationActive(l));
      actions.append(editBtn, toggleBtn);
      card.appendChild(actions);
    }
    container.appendChild(card);
  });
}

document.querySelectorAll('#locationTypeToggle .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#locationTypeToggle .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentLocationType = btn.dataset.locationType;
    renderLocations();
  });
});

function openLocationFormOverlay() {
  document.getElementById('locationFormOverlay').classList.remove('hidden');
}
function closeLocationFormOverlay() {
  document.getElementById('locationFormOverlay').classList.add('hidden');
}

document.getElementById('openAddLocationBtn').addEventListener('click', () => {
  const form = document.getElementById('locationForm');
  form.reset();
  delete form.dataset.editingId;
  document.getElementById('locationRoomWrap').classList.toggle('hidden', currentLocationType !== 'room');
  document.getElementById('locationFormTitle').textContent = 'Thêm vị trí';
  document.getElementById('locationFormError').textContent = '';
  openLocationFormOverlay();
});

document.getElementById('locationFormCloseBtn').addEventListener('click', closeLocationFormOverlay);

function openEditLocation(l) {
  const form = document.getElementById('locationForm');
  form.reset();
  form.querySelector('[name="code"]').value = l.code || '';
  form.querySelector('[name="name"]').value = l.name;
  form.querySelector('[name="note"]').value = l.note || '';
  form.dataset.editingId = l.id;
  document.getElementById('locationRoomWrap').classList.add('hidden');
  document.getElementById('locationFormTitle').textContent = 'Sửa vị trí';
  document.getElementById('locationFormError').textContent = '';
  openLocationFormOverlay();
}

async function toggleLocationActive(l) {
  showPageError('');
  const response = await fetch(`/api/asset-locations/${l.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive: !l.isActive }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showPageError(body.error || 'Có lỗi khi cập nhật vị trí');
    return;
  }
  await loadLocations();
}

document.getElementById('locationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const errorEl = document.getElementById('locationFormError');
  errorEl.textContent = '';

  const editingId = form.dataset.editingId;
  let response;
  try {
    if (editingId) {
      response = await fetch(`/api/asset-locations/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.querySelector('[name="code"]').value,
          name: form.querySelector('[name="name"]').value,
          note: form.querySelector('[name="note"]').value,
        }),
      });
    } else {
      const payload = {
        locationType: currentLocationType,
        code: form.querySelector('[name="code"]').value,
        name: form.querySelector('[name="name"]').value,
        note: form.querySelector('[name="note"]').value,
      };
      if (currentLocationType === 'room') {
        payload.roomId = Number(form.querySelector('[name="roomId"]').value);
      }
      response = await fetch('/api/asset-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi lưu vị trí';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu vị trí';
    return;
  }

  closeLocationFormOverlay();
  await loadLocations();
});
