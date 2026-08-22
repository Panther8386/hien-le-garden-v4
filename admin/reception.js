// admin/reception.js
let confirmingBooking = null;
let currentRole = null;

const ROOM_TYPE_LABELS = {
  triangle: 'Triangle House',
  circle: 'Circle House',
  ede_cozy: 'Ê Đê Cozy House',
  vip: 'VIP House',
  bungalow: 'Bungalow Gia Đình',
  dormitory: 'Phòng Tập Thể',
};

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('vi-VN');
}

function statusLabel(status) {
  return {
    pending: 'Chờ xử lý',
    confirmed: 'Đã xác nhận',
    checked_in: 'Đang ở',
    checked_out: 'Đã trả phòng',
    cancelled: 'Đã huỷ',
  }[status] || status;
}

function showOpsError(message) {
  document.getElementById('opsError').textContent = message || '';
}

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = 'login.html';
    return;
  }
  const { role } = await res.json();
  currentRole = role;
  await refreshAll();
})();

async function refreshAll() {
  await Promise.all([loadPending(), loadArrivals(), loadDepartures(), loadUpcomingConfirmed(), loadInhouse(), loadRooms()]);
}

async function fetchBookings(query) {
  let response;
  try {
    response = await fetch(`/api/bookings?${query}`);
  } catch (err) {
    showOpsError('Có lỗi khi tải danh sách đặt phòng');
    return [];
  }
  if (!response.ok) {
    showOpsError('Có lỗi khi tải danh sách đặt phòng');
    return [];
  }
  return response.json();
}

function renderBookingCard(b) {
  const card = document.createElement('div');
  card.className = 'booking-card';

  const nameLine = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = b.guestName;
  nameLine.appendChild(strong);
  nameLine.appendChild(document.createTextNode(` — ${b.phone}`));
  card.appendChild(nameLine);

  const detailLine = document.createElement('p');
  detailLine.textContent = `${ROOM_TYPE_LABELS[b.roomType] || b.roomType} — ${formatDate(b.checkIn)} → ${formatDate(b.checkOut)}${b.guestsCount ? ` — ${b.guestsCount} khách` : ''}`;
  card.appendChild(detailLine);

  if (b.notes) {
    const notesLine = document.createElement('p');
    notesLine.textContent = `Ghi chú: ${b.notes}`;
    card.appendChild(notesLine);
  }

  const statusLine = document.createElement('p');
  const badge = document.createElement('span');
  badge.className = `status-badge status-${b.status}`;
  badge.textContent = statusLabel(b.status);
  statusLine.appendChild(badge);
  card.appendChild(statusLine);

  const actions = document.createElement('div');
  actions.className = 'booking-actions';
  card.appendChild(actions);

  return { card, actions };
}

function renderList(containerId, bookings, emptyText, buildActions) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (bookings.length === 0) {
    const p = document.createElement('p');
    p.className = 'booking-empty';
    p.textContent = emptyText;
    container.appendChild(p);
    return;
  }
  bookings.forEach((b) => {
    const { card, actions } = renderBookingCard(b);
    buildActions(actions, b);
    container.appendChild(card);
  });
}

async function loadPending() {
  const bookings = await fetchBookings('status=pending');
  renderList('pendingList', bookings, 'Không có yêu cầu nào đang chờ.', (actions, b) => {
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Xác nhận';
    confirmBtn.addEventListener('click', () => openConfirmDialog(b));
    actions.appendChild(confirmBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = 'Từ chối';
    rejectBtn.className = 'btn-secondary';
    rejectBtn.addEventListener('click', () => rejectBooking(b.id));
    actions.appendChild(rejectBtn);
  });
}

async function loadArrivals() {
  const bookings = await fetchBookings(`status=confirmed&date=${todayISO()}&view=arrivals`);
  renderList('arrivalsList', bookings, 'Không có khách đến hôm nay.', (actions, b) => {
    const btn = document.createElement('button');
    btn.textContent = 'Check-in';
    btn.addEventListener('click', () => doBookingAction(b.id, 'check-in'));
    actions.appendChild(btn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Hủy đặt phòng';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.addEventListener('click', () => cancelBooking(b.id));
    actions.appendChild(cancelBtn);
  });
}

async function loadUpcomingConfirmed() {
  const bookings = await fetchBookings('status=confirmed');
  const today = todayISO();
  const upcoming = bookings.filter((b) => b.checkIn !== today);
  renderList('upcomingConfirmedList', upcoming, 'Không có đặt phòng đã xác nhận sắp tới.', (actions, b) => {
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Hủy đặt phòng';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.addEventListener('click', () => cancelBooking(b.id));
    actions.appendChild(cancelBtn);
  });
}

async function loadDepartures() {
  const bookings = await fetchBookings(`status=checked_in&date=${todayISO()}&view=departures`);
  renderList('departuresList', bookings, 'Không có khách đi hôm nay.', (actions, b) => {
    const btn = document.createElement('button');
    btn.textContent = 'Check-out';
    btn.addEventListener('click', () => doBookingAction(b.id, 'check-out'));
    actions.appendChild(btn);
  });
}

async function loadInhouse() {
  const bookings = await fetchBookings(`status=checked_in&date=${todayISO()}&view=inhouse`);
  renderList('inhouseList', bookings, 'Không có khách đang lưu trú nhiều đêm.', () => {});
}

async function doBookingAction(id, action) {
  let response;
  try {
    response = await fetch(`/api/bookings/${id}/${action}`, { method: 'POST' });
  } catch (err) {
    showOpsError('Có lỗi xảy ra');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showOpsError(body.error || 'Có lỗi xảy ra');
    return;
  }
  showOpsError('');
  await refreshAll();
}

async function rejectBooking(id) {
  let response;
  try {
    response = await fetch(`/api/bookings/${id}/reject`, { method: 'POST' });
  } catch (err) {
    showOpsError('Có lỗi xảy ra');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showOpsError(body.error || 'Có lỗi xảy ra');
    return;
  }
  showOpsError('');
  await loadPending();
}

async function cancelBooking(id) {
  let response;
  try {
    response = await fetch(`/api/bookings/${id}/cancel`, { method: 'POST' });
  } catch (err) {
    showOpsError('Có lỗi xảy ra');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showOpsError(body.error || 'Có lỗi xảy ra');
    return;
  }
  showOpsError('');
  await refreshAll();
}

let selectedConfirmRooms = [];

function openConfirmDialog(booking) {
  confirmingBooking = booking;
  selectedConfirmRooms = [];
  document.getElementById('confirmError').textContent = '';
  document.getElementById('confirmOverlay').classList.remove('hidden');
  renderSelectedConfirmRooms();

  const typeSelect = document.getElementById('confirmRoomType');
  typeSelect.innerHTML = '';
  Object.entries(ROOM_TYPE_LABELS).forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    typeSelect.appendChild(opt);
  });
  typeSelect.value = booking.roomType;

  loadConfirmRoomOptions(booking, typeSelect.value);
}

function closeConfirmDialog() {
  confirmingBooking = null;
  selectedConfirmRooms = [];
  document.getElementById('confirmOverlay').classList.add('hidden');
}

async function loadConfirmRoomOptions(booking, roomType) {
  const select = document.getElementById('confirmRoomSelect');
  select.innerHTML = '';
  const params = new URLSearchParams({ roomType, checkIn: booking.checkIn, checkOut: booking.checkOut });
  let response;
  try {
    response = await fetch(`/api/availability?${params.toString()}`);
  } catch (err) {
    document.getElementById('confirmError').textContent = 'Có lỗi khi tải danh sách phòng trống';
    return;
  }
  if (!response.ok) {
    document.getElementById('confirmError').textContent = 'Có lỗi khi tải danh sách phòng trống';
    return;
  }
  const data = await response.json();
  const alreadySelectedIds = new Set(selectedConfirmRooms.map((r) => r.roomId));
  const remaining = data.availableRooms.filter((r) => !alreadySelectedIds.has(r.id));
  if (remaining.length === 0) {
    document.getElementById('confirmError').textContent = 'Không còn phòng trống loại này trong khoảng ngày yêu cầu.';
    return;
  }
  remaining.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  });
}

function renderSelectedConfirmRooms() {
  const container = document.getElementById('confirmSelectedRooms');
  container.innerHTML = '';
  selectedConfirmRooms.forEach((r, index) => {
    const row = document.createElement('div');
    row.className = 'booking-card';
    const label = document.createElement('span');
    label.textContent = `${ROOM_TYPE_LABELS[r.roomType] || r.roomType} — ${r.roomName}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Bỏ';
    removeBtn.className = 'btn-secondary';
    removeBtn.addEventListener('click', () => {
      selectedConfirmRooms.splice(index, 1);
      renderSelectedConfirmRooms();
      loadConfirmRoomOptions(confirmingBooking, document.getElementById('confirmRoomType').value);
    });
    row.appendChild(label);
    row.appendChild(removeBtn);
    container.appendChild(row);
  });
}

document.getElementById('confirmRoomType').addEventListener('change', (event) => {
  if (confirmingBooking) loadConfirmRoomOptions(confirmingBooking, event.target.value);
});

document.getElementById('confirmAddRoomBtn').addEventListener('click', () => {
  const typeSelect = document.getElementById('confirmRoomType');
  const roomSelect = document.getElementById('confirmRoomSelect');
  const roomId = Number(roomSelect.value);
  const errorEl = document.getElementById('confirmError');
  if (!roomId) {
    errorEl.textContent = 'Vui lòng chọn phòng trước khi thêm';
    return;
  }
  errorEl.textContent = '';
  const roomName = roomSelect.options[roomSelect.selectedIndex].textContent;
  selectedConfirmRooms.push({ roomType: typeSelect.value, roomId, roomName });
  renderSelectedConfirmRooms();
  loadConfirmRoomOptions(confirmingBooking, typeSelect.value);
});

document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirmDialog);

document.getElementById('confirmSubmitBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('confirmError');
  errorEl.textContent = '';

  let rooms = selectedConfirmRooms.map((r) => ({ roomType: r.roomType, roomId: r.roomId }));

  // Fast path: nothing added via "+ Thêm phòng" yet -- use whatever's currently picked in the dropdowns.
  if (rooms.length === 0) {
    const roomSelect = document.getElementById('confirmRoomSelect');
    const roomId = Number(roomSelect.value);
    if (!roomId) {
      errorEl.textContent = 'Vui lòng chọn ít nhất một phòng';
      return;
    }
    rooms = [{ roomType: document.getElementById('confirmRoomType').value, roomId }];
  }

  let response;
  try {
    response = await fetch(`/api/bookings/${confirmingBooking.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rooms }),
    });
  } catch (err) {
    errorEl.textContent = 'Có lỗi xảy ra';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi xảy ra';
    return;
  }
  closeConfirmDialog();
  showOpsError('');
  await refreshAll();
});

async function loadRooms() {
  let response;
  try {
    response = await fetch('/api/rooms');
  } catch (err) {
    showOpsError('Có lỗi khi tải trạng thái phòng');
    return;
  }
  const container = document.getElementById('roomsGrid');
  if (!response.ok) {
    showOpsError('Có lỗi khi tải trạng thái phòng');
    return;
  }
  const rooms = await response.json();
  container.innerHTML = '';
  rooms.forEach((r) => {
    const card = document.createElement('div');
    card.className = `room-card room-${r.status}`;
    card.dataset.roomId = r.id;
    if (currentRole === 'manager') {
      card.classList.add('room-draggable');
      card.style.touchAction = 'none';
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'room-name';
    nameEl.textContent = r.name;
    card.appendChild(nameEl);

    const statusEl = document.createElement('div');
    statusEl.textContent = { empty: 'Trống', occupied: 'Đang có khách', needs_cleaning: 'Cần dọn' }[r.status] || r.status;
    card.appendChild(statusEl);

    if (r.status === 'needs_cleaning') {
      const btn = document.createElement('button');
      btn.textContent = 'Đã dọn xong';
      btn.addEventListener('click', async () => {
        let cleanResponse;
        try {
          cleanResponse = await fetch(`/api/rooms/${r.id}/clean`, { method: 'POST' });
        } catch (err) {
          showOpsError('Có lỗi khi cập nhật trạng thái dọn phòng');
          return;
        }
        if (!cleanResponse.ok) {
          showOpsError('Có lỗi khi cập nhật trạng thái dọn phòng');
          return;
        }
        showOpsError('');
        await loadRooms();
      });
      card.appendChild(btn);
    }

    container.appendChild(card);
  });

  if (currentRole === 'manager') {
    enableRoomDragAndDrop(container);
  }
}

let draggedRoomCard = null;

function enableRoomDragAndDrop(container) {
  container.onpointerdown = (event) => {
    const card = event.target.closest('.room-card');
    if (!card || event.target.closest('button')) return;

    draggedRoomCard = card;
    card.classList.add('room-dragging');
    card.setPointerCapture(event.pointerId);

    container.onpointermove = (moveEvent) => {
      if (!draggedRoomCard) return;
      const cards = [...container.querySelectorAll('.room-card')];
      const draggedIndex = cards.indexOf(draggedRoomCard);
      let closest = null;
      let closestDistance = Infinity;
      cards.forEach((c) => {
        if (c === draggedRoomCard) return;
        const box = c.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const distance = Math.hypot(moveEvent.clientX - cx, moveEvent.clientY - cy);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = c;
        }
      });
      if (!closest) return;
      const closestIndex = cards.indexOf(closest);
      if (closestIndex < draggedIndex) {
        container.insertBefore(draggedRoomCard, closest);
      } else {
        container.insertBefore(draggedRoomCard, closest.nextSibling);
      }
    };

    container.onpointerup = async () => {
      container.onpointermove = null;
      container.onpointerup = null;
      if (draggedRoomCard) {
        draggedRoomCard.classList.remove('room-dragging');
        draggedRoomCard = null;
      }
      const orderedIds = [...container.querySelectorAll('.room-card')].map((c) => Number(c.dataset.roomId));
      await saveRoomOrder(orderedIds);
    };
  };
}

async function saveRoomOrder(orderedIds) {
  let response;
  try {
    response = await fetch('/api/rooms/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderedIds }),
    });
  } catch (err) {
    showOpsError('Có lỗi khi lưu thứ tự phòng');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showOpsError(body.error || 'Có lỗi khi lưu thứ tự phòng');
    return;
  }
  showOpsError('');
}

async function refreshNewBookingRoomOptions() {
  const form = document.getElementById('newBookingForm');
  const roomType = form.roomType.value;
  const checkIn = form.checkIn.value;
  const checkOut = form.checkOut.value;
  const roomIdSelect = document.getElementById('newBookingRoomId');
  roomIdSelect.innerHTML = '';

  if (!roomType || !checkIn || !checkOut) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Chọn ngày và loại phòng trước --';
    roomIdSelect.appendChild(opt);
    return;
  }

  const params = new URLSearchParams({ roomType, checkIn, checkOut });
  let response;
  try {
    response = await fetch(`/api/availability?${params.toString()}`);
  } catch (err) {
    return;
  }
  if (!response.ok) return;
  const data = await response.json();

  if (data.availableRooms.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Hết phòng loại này trong khoảng ngày đã chọn';
    roomIdSelect.appendChild(opt);
    return;
  }
  data.availableRooms.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    roomIdSelect.appendChild(opt);
  });
}

['roomType', 'checkIn', 'checkOut'].forEach((name) => {
  document.getElementById('newBookingForm')[name].addEventListener('change', refreshNewBookingRoomOptions);
});

document.getElementById('newBookingForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const errorEl = document.getElementById('newBookingError');
  errorEl.textContent = '';

  const roomId = Number(data.get('roomId'));
  if (!roomId) {
    errorEl.textContent = 'Vui lòng chọn phòng cụ thể';
    return;
  }

  let response;
  try {
    response = await fetch('/api/bookings/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestName: data.get('guestName'),
        phone: data.get('phone'),
        roomType: data.get('roomType'),
        roomId,
        checkIn: data.get('checkIn'),
        checkOut: data.get('checkOut'),
        guestsCount: data.get('guestsCount') ? Number(data.get('guestsCount')) : null,
        notes: data.get('notes') || null,
        source: data.get('source'),
      }),
    });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tạo đặt phòng';
    return;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tạo đặt phòng';
    return;
  }

  form.reset();
  refreshNewBookingRoomOptions();
  await refreshAll();
});

/* ---- Existing promo lookup (unchanged behavior) ---- */
let currentCode = null;

document.getElementById('lookupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = new FormData(event.target).get('code');
  const response = await fetch(`/api/promo/${encodeURIComponent(code)}`);
  const errorEl = document.getElementById('lookupError');
  errorEl.textContent = '';

  if (!response.ok) {
    const body = await response.json();
    errorEl.textContent = body.error || 'Có lỗi xảy ra';
    document.getElementById('result').classList.add('hidden');
    return;
  }

  currentCode = code;
  const data = await response.json();
  document.getElementById('guestName').textContent = data.guestName;
  document.getElementById('discountPercent').textContent = data.discountPercent;
  document.getElementById('expiresAt').textContent = new Date(data.expiresAt).toLocaleDateString('vi-VN');
  document.getElementById('status').textContent = data.status;
  document.getElementById('claimGiftBtn').style.display = data.giftOffered && !data.giftClaimed ? 'inline-block' : 'none';
  document.getElementById('result').classList.remove('hidden');
});

document.getElementById('redeemBtn').addEventListener('click', async () => {
  const response = await fetch(`/api/promo/${encodeURIComponent(currentCode)}/redeem`, { method: 'POST' });
  const errorEl = document.getElementById('actionError');
  if (!response.ok) {
    errorEl.textContent = (await response.json()).error;
    return;
  }
  document.getElementById('status').textContent = 'used';
  errorEl.textContent = '';
});

document.getElementById('claimGiftBtn').addEventListener('click', async () => {
  const response = await fetch(`/api/promo/${encodeURIComponent(currentCode)}/claim-gift`, { method: 'POST' });
  const errorEl = document.getElementById('actionError');
  if (!response.ok) {
    errorEl.textContent = (await response.json()).error;
    return;
  }
  document.getElementById('claimGiftBtn').style.display = 'none';
  errorEl.textContent = '';
});
