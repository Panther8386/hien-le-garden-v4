// v4/admin/rooms.js
let currentRole = null;
let editingRoomId = null;

const ROOM_TYPE_LABELS = {
  triangle: 'Triangle House',
  circle: 'Circle House',
  ede_cozy: 'Ê Đê Cozy House',
  vip: 'VIP House',
  bungalow: 'Bungalow Gia Đình',
  dormitory: 'Phòng Tập Thể',
};

function formatVnd(n) {
  return n == null ? '—' : `${Number(n).toLocaleString('vi-VN')} đ`;
}

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
  const { role } = await res.json();
  currentRole = role;
  if (currentRole === 'admin') {
    document.getElementById('addHolidayBtn').classList.remove('hidden');
  }
  await loadRooms();
  await loadHolidays();
})();

async function loadRooms() {
  const listError = document.getElementById('roomsListError');
  listError.textContent = '';
  const response = await fetch('/api/rooms');
  if (!response.ok) {
    listError.textContent = 'Có lỗi khi tải danh sách phòng';
    return;
  }
  const rooms = await response.json();
  renderRoomsTable(rooms);
}

function renderRoomsTable(rooms) {
  const tbody = document.querySelector('#roomsTable tbody');
  tbody.innerHTML = '';

  rooms.forEach((room) => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = room.name;

    const tdType = document.createElement('td');
    tdType.textContent = ROOM_TYPE_LABELS[room.roomType] || room.roomType;

    if (editingRoomId === room.id) {
      const tdWeekday = document.createElement('td');
      const weekdayInput = document.createElement('input');
      weekdayInput.type = 'number';
      weekdayInput.min = '0';
      weekdayInput.placeholder = 'Theo loại phòng';
      if (room.priceWeekday != null) weekdayInput.value = room.priceWeekday;
      tdWeekday.appendChild(weekdayInput);

      const tdWeekend = document.createElement('td');
      const weekendInput = document.createElement('input');
      weekendInput.type = 'number';
      weekendInput.min = '0';
      weekendInput.placeholder = 'Theo loại phòng';
      if (room.priceWeekend != null) weekendInput.value = room.priceWeekend;
      tdWeekend.appendChild(weekendInput);

      const tdActions = document.createElement('td');
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'table-actions-btn';
      saveBtn.textContent = 'Lưu';
      saveBtn.addEventListener('click', () => saveRoomPrice(room.id, weekdayInput.value, weekendInput.value));
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'table-actions-btn';
      cancelBtn.textContent = 'Huỷ';
      cancelBtn.addEventListener('click', () => {
        editingRoomId = null;
        loadRooms();
      });
      tdActions.append(saveBtn, cancelBtn);

      tr.append(tdName, tdType, tdWeekday, tdWeekend, tdActions);
    } else {
      const tdWeekday = document.createElement('td');
      tdWeekday.textContent = formatVnd(room.priceWeekday);

      const tdWeekend = document.createElement('td');
      tdWeekend.textContent = formatVnd(room.priceWeekend);

      const tdActions = document.createElement('td');
      if (currentRole === 'admin') {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'table-actions-btn';
        editBtn.textContent = 'Sửa';
        editBtn.addEventListener('click', () => {
          editingRoomId = room.id;
          loadRooms();
        });
        tdActions.appendChild(editBtn);
      }

      tr.append(tdName, tdType, tdWeekday, tdWeekend, tdActions);
    }

    tbody.appendChild(tr);
  });
}

async function saveRoomPrice(roomId, weekdayValue, weekendValue) {
  const listError = document.getElementById('roomsListError');
  listError.textContent = '';
  const payload = {
    priceWeekday: weekdayValue === '' ? null : Number(weekdayValue),
    priceWeekend: weekendValue === '' ? null : Number(weekendValue),
  };
  const response = await fetch(`/api/rooms/${roomId}/price`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi lưu giá phòng';
    return;
  }
  editingRoomId = null;
  await loadRooms();
}

async function loadHolidays() {
  const listError = document.getElementById('holidaysListError');
  listError.textContent = '';
  const response = await fetch('/api/holidays');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải danh sách ngày lễ';
    return;
  }
  const holidays = await response.json();
  renderHolidaysTable(holidays);
}

function renderHolidaysTable(holidays) {
  const tbody = document.querySelector('#holidaysTable tbody');
  tbody.innerHTML = '';
  document.getElementById('holidaysEmptyState').classList.toggle('hidden', holidays.length > 0);

  holidays.forEach((holiday) => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = holiday.name;

    const tdStart = document.createElement('td');
    tdStart.textContent = holiday.startDate;

    const tdEnd = document.createElement('td');
    tdEnd.textContent = holiday.endDate;

    const tdActions = document.createElement('td');
    if (currentRole === 'admin') {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'table-actions-btn';
      editBtn.textContent = 'Sửa';
      editBtn.addEventListener('click', () => openEditHolidayForm(holiday));
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'table-actions-btn';
      deleteBtn.textContent = 'Xoá';
      deleteBtn.addEventListener('click', () => deleteHoliday(holiday.id));
      tdActions.append(editBtn, deleteBtn);
    }

    tr.append(tdName, tdStart, tdEnd, tdActions);
    tbody.appendChild(tr);
  });
}

function resetHolidayForm() {
  const form = document.getElementById('holidayForm');
  form.reset();
  form.querySelector('input[name="id"]').value = '';
  document.getElementById('holidaySubmitBtn').textContent = 'Thêm ngày lễ';
}

document.getElementById('addHolidayBtn').addEventListener('click', () => {
  resetHolidayForm();
  document.getElementById('holidayForm').classList.remove('hidden');
});

document.getElementById('holidayCancelBtn').addEventListener('click', () => {
  document.getElementById('holidayForm').classList.add('hidden');
});

function openEditHolidayForm(holiday) {
  const form = document.getElementById('holidayForm');
  form.classList.remove('hidden');
  form.querySelector('input[name="id"]').value = holiday.id;
  form.querySelector('input[name="name"]').value = holiday.name;
  form.querySelector('input[name="startDate"]').value = holiday.startDate;
  form.querySelector('input[name="endDate"]').value = holiday.endDate;
  document.getElementById('holidaySubmitBtn').textContent = 'Lưu thay đổi';
}

async function deleteHoliday(id) {
  const listError = document.getElementById('holidaysListError');
  const response = await fetch(`/api/holidays/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi xoá ngày lễ';
    return;
  }
  await loadHolidays();
}

document.getElementById('holidayForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const errorEl = document.getElementById('holidayFormError');
  errorEl.textContent = '';

  const id = data.get('id');
  const payload = {
    name: data.get('name'),
    startDate: data.get('startDate'),
    endDate: data.get('endDate'),
  };

  const response = await fetch(id ? `/api/holidays/${id}` : '/api/holidays', {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu ngày lễ';
    return;
  }

  form.classList.add('hidden');
  await loadHolidays();
});
