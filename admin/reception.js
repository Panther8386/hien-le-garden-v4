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

let canManageRoomLayout = false;
let catalogItems = [];

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
  const { role, canManageRoomLayout: layoutFlag } = await res.json();
  currentRole = role;
  canManageRoomLayout = !!layoutFlag;
  catalogItems = await fetch('/api/catalog').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  if (currentRole === 'observer') {
    document.getElementById('newBookingSection').classList.add('hidden');
    document.getElementById('promoLookupSection').classList.add('hidden');
  }
  document.getElementById('roomDateFilter').value = todayISO();
  document.getElementById('roomDateFilter').addEventListener('change', loadRooms);
  document.getElementById('roomStatusFilter').addEventListener('change', applyRoomStatusFilter);
  if (currentRole === 'admin') {
    document.getElementById('showHiddenBookingsWrap').classList.remove('hidden');
  }
  document.getElementById('showHiddenBookings').addEventListener('change', loadBookingHistory);
  await refreshAll();
  await loadLayoutHistory();
})();

async function refreshAll() {
  await Promise.all([loadPending(), loadArrivals(), loadDepartures(), loadUpcomingConfirmed(), loadInhouse(), loadBookingHistory(), loadRooms(), loadReminders()]);
}

async function loadReminders() {
  const container = document.getElementById('remindersSection');
  container.innerHTML = '';
  let response;
  try {
    response = await fetch('/api/reception/reminders');
  } catch (err) {
    const errLine = document.createElement('p');
    errLine.textContent = 'Không tải được nhắc việc.';
    container.appendChild(errLine);
    return;
  }
  if (!response.ok) {
    const errLine = document.createElement('p');
    errLine.textContent = 'Không tải được nhắc việc.';
    container.appendChild(errLine);
    return;
  }
  const data = await response.json();

  const { pendingNoDeposit, arrivingToday, roomsNotCleaned, thresholds } = data;

  if (pendingNoDeposit.length === 0 && arrivingToday.length === 0 && roomsNotCleaned.length === 0) {
    const okLine = document.createElement('p');
    okLine.textContent = '✅ Không có việc cần nhắc.';
    container.appendChild(okLine);
    return;
  }

  if (pendingNoDeposit.length > 0) {
    const heading = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `Chờ cọc quá ${thresholds.pendingDepositHours} giờ (${pendingNoDeposit.length})`;
    heading.appendChild(strong);
    container.appendChild(heading);
    pendingNoDeposit.forEach((b) => {
      const p = document.createElement('p');
      p.textContent = `${b.guestName} — ${b.phone} — chờ ${b.hoursWaiting} giờ`;
      container.appendChild(p);
    });
  }

  if (arrivingToday.length > 0) {
    const heading = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `Khách sắp đến hôm nay (${arrivingToday.length})`;
    heading.appendChild(strong);
    container.appendChild(heading);
    arrivingToday.forEach((b) => {
      const p = document.createElement('p');
      p.textContent = `${b.guestName} — ${b.phone} — ${ROOM_TYPE_LABELS[b.roomType] || b.roomType}`;
      container.appendChild(p);
    });
  }

  if (roomsNotCleaned.length > 0) {
    const heading = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `Phòng chưa dọn quá ${thresholds.cleaningMinutes} phút (${roomsNotCleaned.length})`;
    heading.appendChild(strong);
    container.appendChild(heading);
    roomsNotCleaned.forEach((r) => {
      const p = document.createElement('p');
      p.textContent = `${r.name} — ${ROOM_TYPE_LABELS[r.roomType] || r.roomType} — ${r.minutesWaiting} phút`;
      container.appendChild(p);
    });
  }
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

function formatVnd(n) {
  return `${Number(n).toLocaleString('vi-VN')} đ`;
}

function renderServicesSection(b, card) {
  const services = b.services || [];
  if (services.length === 0 && b.status !== 'confirmed' && b.status !== 'checked_in') return;

  const section = document.createElement('div');
  section.className = 'services-section';

  services.forEach((item) => {
    const line = document.createElement('p');
    line.className = 'service-line';
    const text = document.createElement('span');
    const paymentSuffix = item.paymentStatus === 'paid'
      ? ` · Đã thanh toán (${item.paymentMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'})`
      : ' · Chưa thanh toán';
    let slotSuffix = '';
    if (item.experienceDate) {
      const [y, m, d] = item.experienceDate.split('-');
      slotSuffix = ` · ${d}/${m} ${item.experienceStartTime || ''}`.trimEnd();
      if (item.experienceSlotLabel) slotSuffix += ` (${item.experienceSlotLabel})`;
    }
    text.textContent = `${item.name} ×${item.quantity} — ${formatVnd(item.amount)}${slotSuffix}${paymentSuffix}`;
    if (item.status === 'voided') {
      text.style.textDecoration = 'line-through';
      text.style.opacity = '0.5';
    }
    line.appendChild(text);
    if (item.status === 'posted' && currentRole !== 'observer') {
      const voidBtn = document.createElement('button');
      voidBtn.type = 'button';
      voidBtn.className = 'btn-secondary';
      voidBtn.textContent = 'Huỷ';
      voidBtn.addEventListener('click', async () => {
        let response;
        try {
          response = await fetch(`/api/bookings/${b.id}/services/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        } catch (err) {
          showOpsError('Có lỗi khi huỷ dịch vụ');
          return;
        }
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          showOpsError(errBody.error || 'Có lỗi khi huỷ dịch vụ');
          return;
        }
        showOpsError('');
        await refreshAll();
      });
      line.appendChild(voidBtn);
    }
    section.appendChild(line);
  });

  if (services.length > 0) {
    const postedTotal = services.filter((s) => s.status === 'posted').reduce((sum, s) => sum + s.amount, 0);
    const totalLine = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `Tổng dịch vụ: ${formatVnd(postedTotal)}`;
    totalLine.appendChild(strong);
    section.appendChild(totalLine);
  }

  if ((b.status === 'confirmed' || b.status === 'checked_in') && currentRole !== 'observer') {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-secondary';
    addBtn.textContent = '+ Thêm dịch vụ';
    addBtn.addEventListener('click', () => openAddServiceForm(b.id, section));
    section.appendChild(addBtn);
  }

  card.appendChild(section);
}

function openAddServiceForm(bookingId, section) {
  document.querySelectorAll('.add-service-form').forEach((el) => el.remove());

  const form = document.createElement('div');
  form.className = 'add-service-form';

  const select = document.createElement('select');
  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = '-- Chọn dịch vụ --';
  select.appendChild(placeholderOpt);
  catalogItems.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.name;
    opt.dataset.priceMin = item.priceMin != null ? item.priceMin : '';
    opt.dataset.isScheduled = item.isScheduled ? '1' : '';
    opt.dataset.termsAndConditions = item.termsAndConditions || '';
    select.appendChild(opt);
  });

  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.step = '1000';
  priceInput.placeholder = 'Giá';

  const qtyLabel = document.createElement('span');
  qtyLabel.textContent = 'Số lượng:';
  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.step = '1';
  qtyInput.value = '1';

  const experienceDateInput = document.createElement('input');
  experienceDateInput.type = 'date';
  experienceDateInput.style.display = 'none';

  const slotTemplateSelect = document.createElement('select');
  slotTemplateSelect.style.display = 'none';
  const slotPlaceholderOpt = document.createElement('option');
  slotPlaceholderOpt.value = '';
  slotPlaceholderOpt.textContent = '-- Chọn ngày trước --';
  slotTemplateSelect.appendChild(slotPlaceholderOpt);

  const termsDisplay = document.createElement('blockquote');
  termsDisplay.style.display = 'none';

  const termsLabel = document.createElement('label');
  termsLabel.className = 'checkbox-label';
  termsLabel.style.display = 'none';
  const termsAcceptedCheckbox = document.createElement('input');
  termsAcceptedCheckbox.type = 'checkbox';
  termsLabel.append(termsAcceptedCheckbox, ' Đã giải thích & khách đồng ý điều khoản trên');

  async function refreshSlotAvailability() {
    const catalogId = select.value;
    const date = experienceDateInput.value;
    slotTemplateSelect.innerHTML = '';
    if (!catalogId || !date) {
      slotTemplateSelect.appendChild(slotPlaceholderOpt.cloneNode(true));
      return;
    }
    let response;
    try {
      response = await fetch(`/api/catalog/${catalogId}/slot-availability?date=${encodeURIComponent(date)}`);
    } catch (err) {
      return;
    }
    if (!response.ok) return;
    const slots = await response.json();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Chọn khung giờ --';
    slotTemplateSelect.appendChild(placeholder);
    slots.forEach((slot) => {
      const opt = document.createElement('option');
      opt.value = slot.id;
      if (slot.remaining <= 0) {
        opt.textContent = `${slot.startTime} — Hết chỗ`;
        opt.disabled = true;
      } else {
        opt.textContent = `${slot.startTime} — còn ${slot.remaining}/${slot.capacity} chỗ`;
      }
      slotTemplateSelect.appendChild(opt);
    });
  }

  select.addEventListener('change', () => {
    const selectedOpt = select.options[select.selectedIndex];
    priceInput.value = selectedOpt.dataset.priceMin || '';
    const isScheduled = selectedOpt.dataset.isScheduled === '1';
    experienceDateInput.style.display = isScheduled ? '' : 'none';
    slotTemplateSelect.style.display = isScheduled ? '' : 'none';
    qtyLabel.textContent = isScheduled ? 'Số khách:' : 'Số lượng:';
    if (isScheduled) {
      refreshSlotAvailability();
    } else {
      termsDisplay.style.display = 'none';
      termsLabel.style.display = 'none';
      termsAcceptedCheckbox.checked = false;
    }
  });

  experienceDateInput.addEventListener('change', refreshSlotAvailability);

  slotTemplateSelect.addEventListener('change', () => {
    const selectedOpt = select.options[select.selectedIndex];
    const terms = selectedOpt.dataset.termsAndConditions;
    if (slotTemplateSelect.value && terms) {
      termsDisplay.textContent = terms;
      termsDisplay.style.display = '';
      termsLabel.style.display = '';
    } else {
      termsDisplay.style.display = 'none';
      termsLabel.style.display = 'none';
      termsAcceptedCheckbox.checked = false;
    }
  });

  const paidLabel = document.createElement('label');
  paidLabel.className = 'checkbox-label';
  const paidCheckbox = document.createElement('input');
  paidCheckbox.type = 'checkbox';
  paidLabel.append(paidCheckbox, ' Đã thanh toán');

  const methodLabel = document.createElement('label');
  methodLabel.className = 'checkbox-label';
  const methodCheckbox = document.createElement('input');
  methodCheckbox.type = 'checkbox';
  methodCheckbox.checked = true;
  methodLabel.append(methodCheckbox, ' Tiền mặt');
  methodLabel.style.display = 'none';

  paidCheckbox.addEventListener('change', () => {
    methodLabel.style.display = paidCheckbox.checked ? '' : 'none';
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.textContent = 'Thêm';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Huỷ';

  const errorEl = document.createElement('p');
  errorEl.className = 'error';

  const alternativesEl = document.createElement('div');

  function renderAlternatives(alternatives) {
    alternativesEl.innerHTML = '';
    if (!Array.isArray(alternatives) || alternatives.length === 0) return;
    const heading = document.createElement('p');
    heading.textContent = 'Gợi ý khung giờ khác:';
    alternativesEl.appendChild(heading);
    alternatives.forEach((alt) => {
      const line = document.createElement('p');
      const [y, m, d] = alt.date.split('-');
      line.textContent = `· ${d}/${m} — ${alt.startTime} (còn ${alt.remaining} chỗ) `;
      const chooseBtn = document.createElement('button');
      chooseBtn.type = 'button';
      chooseBtn.className = 'btn-secondary';
      chooseBtn.textContent = 'chọn';
      chooseBtn.addEventListener('click', async () => {
        experienceDateInput.value = alt.date;
        await refreshSlotAvailability();
        slotTemplateSelect.value = String(alt.slotTemplateId);
        slotTemplateSelect.dispatchEvent(new Event('change'));
        alternativesEl.innerHTML = '';
      });
      line.appendChild(chooseBtn);
      alternativesEl.appendChild(line);
    });
  }

  confirmBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    alternativesEl.innerHTML = '';
    const serviceCatalogId = Number(select.value);
    if (!serviceCatalogId) {
      errorEl.textContent = 'Vui lòng chọn dịch vụ';
      return;
    }
    const unitPrice = Number(priceInput.value);
    if (priceInput.value.trim() === '' || !Number.isInteger(unitPrice) || unitPrice < 0) {
      errorEl.textContent = 'Vui lòng nhập giá hợp lệ';
      return;
    }
    const quantity = Number(qtyInput.value);
    if (!Number.isInteger(quantity) || quantity < 1) {
      errorEl.textContent = 'Số lượng phải là số nguyên lớn hơn 0';
      return;
    }

    const selectedOpt = select.options[select.selectedIndex];
    const isScheduled = selectedOpt.dataset.isScheduled === '1';
    let experienceDate, slotTemplateId, termsAccepted;
    if (isScheduled) {
      if (!experienceDateInput.value || !slotTemplateSelect.value) {
        errorEl.textContent = 'Vui lòng chọn ngày và khung giờ';
        return;
      }
      experienceDate = experienceDateInput.value;
      slotTemplateId = Number(slotTemplateSelect.value);
      if (termsLabel.style.display !== 'none') {
        if (!termsAcceptedCheckbox.checked) {
          errorEl.textContent = 'Vui lòng xác nhận đã thông báo điều khoản dịch vụ cho khách';
          return;
        }
        termsAccepted = true;
      }
    }

    const paid = paidCheckbox.checked;
    const paymentMethod = paid ? (methodCheckbox.checked ? 'cash' : 'transfer') : undefined;
    let response;
    try {
      response = await fetch(`/api/bookings/${bookingId}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceCatalogId, unitPrice, quantity, paid, paymentMethod, experienceDate, slotTemplateId, termsAccepted }),
      });
    } catch (err) {
      errorEl.textContent = 'Có lỗi khi thêm dịch vụ';
      return;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || 'Có lỗi khi thêm dịch vụ';
      renderAlternatives(body.alternatives);
      return;
    }
    await refreshAll();
  });
  cancelBtn.addEventListener('click', () => form.remove());

  form.append(select, priceInput, qtyLabel, qtyInput, experienceDateInput, slotTemplateSelect, termsDisplay, termsLabel, paidLabel, methodLabel, confirmBtn, cancelBtn, errorEl, alternativesEl);
  section.appendChild(form);
}

function renderBookingCard(b) {
  const card = document.createElement('div');
  card.className = 'booking-card';

  const nameLine = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = b.guestName;
  nameLine.appendChild(strong);
  nameLine.appendChild(document.createTextNode(` — ${b.phone || '—'}`));
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

  if ((b.status === 'pending' || b.status === 'confirmed') && currentRole !== 'observer') {
    const depositLine = document.createElement('p');
    const depositInput = document.createElement('input');
    depositInput.type = 'number';
    depositInput.min = '0';
    depositInput.step = '1000';
    depositInput.value = b.depositAmount || 0;
    depositInput.style.width = '120px';
    const depositBtn = document.createElement('button');
    depositBtn.type = 'button';
    depositBtn.textContent = 'Lưu cọc';
    depositBtn.className = 'btn-secondary';
    depositBtn.addEventListener('click', async () => {
      if (depositInput.value.trim() === '') {
        showOpsError('Vui lòng nhập số tiền cọc');
        return;
      }
      const amount = Number(depositInput.value);
      if (!Number.isInteger(amount) || amount < 0) {
        showOpsError('Số tiền cọc phải là số nguyên không âm');
        return;
      }
      let response;
      try {
        response = await fetch(`/api/bookings/${b.id}/deposit`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ depositAmount: amount }),
        });
      } catch (err) {
        showOpsError('Có lỗi khi lưu tiền cọc');
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        showOpsError(body.error || 'Có lỗi khi lưu tiền cọc');
        return;
      }
      showOpsError('');
      await loadRooms();
    });
    depositLine.appendChild(document.createTextNode('Cọc: '));
    depositLine.appendChild(depositInput);
    depositLine.appendChild(document.createTextNode(' đ '));
    depositLine.appendChild(depositBtn);
    card.appendChild(depositLine);
  }

  renderServicesSection(b, card);

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
    if (b.isHidden) card.style.opacity = '0.5';
    container.appendChild(card);
  });
}

async function loadPending() {
  const bookings = await fetchBookings('status=pending');
  renderList('pendingList', bookings, 'Không có yêu cầu nào đang chờ.', (actions, b) => {
    if (currentRole === 'observer') return;
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
    if (currentRole === 'observer') return;
    const btn = document.createElement('button');
    btn.textContent = 'Check-in';
    btn.addEventListener('click', () => doBookingAction(b.id, 'check-in'));
    actions.appendChild(btn);

    const printBtn = document.createElement('button');
    printBtn.textContent = '🖨 In phiếu';
    printBtn.className = 'btn-secondary';
    printBtn.addEventListener('click', () => window.open(`/admin/stay-registration-print.html?bookingId=${b.id}`, '_blank'));
    actions.appendChild(printBtn);

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
    if (currentRole === 'observer') return;
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
    if (currentRole === 'observer') return;
    const btn = document.createElement('button');
    btn.textContent = 'Check-out';
    btn.addEventListener('click', () => doBookingAction(b.id, 'check-out'));
    actions.appendChild(btn);
  });
}

async function loadInhouse() {
  const bookings = await fetchBookings(`status=checked_in&date=${todayISO()}&view=inhouse`);
  renderList('inhouseList', bookings, 'Không có khách đang lưu trú nhiều đêm.', (actions, b) => {
    if (currentRole === 'observer') return;
    const printBtn = document.createElement('button');
    printBtn.textContent = '🖨 In phiếu';
    printBtn.className = 'btn-secondary';
    printBtn.addEventListener('click', () => window.open(`/admin/stay-registration-print.html?bookingId=${b.id}`, '_blank'));
    actions.appendChild(printBtn);
  });
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
  const result = await response.json().catch(() => ({}));
  if (result.refundAmount > 0) {
    showOpsError(`Đã huỷ đặt phòng. Hoàn cọc đề xuất: ${result.refundPercentApplied}% (~${result.refundAmount.toLocaleString('vi-VN')} đ)`);
  } else {
    showOpsError('');
  }
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

let currentRoomsData = [];

async function loadRooms() {
  const date = document.getElementById('roomDateFilter').value || todayISO();
  let response;
  try {
    response = await fetch(`/api/rooms?date=${date}`);
  } catch (err) {
    showOpsError('Có lỗi khi tải trạng thái phòng');
    return;
  }
  if (!response.ok) {
    showOpsError('Có lỗi khi tải trạng thái phòng');
    return;
  }
  currentRoomsData = await response.json();
  renderRoomsGrid();
}

const ROOM_STATUS_LABELS = {
  empty: 'Trống',
  booked: 'Đã có khách đặt',
  booked_deposited: 'Đã đặt & có cọc',
  occupied: 'Đang có khách',
  used: 'Đã sử dụng',
  needs_cleaning: 'Cần dọn',
};

let roomOrderDirty = false;

function renderRoomsGrid() {
  const container = document.getElementById('roomsGrid');
  const statusFilter = document.getElementById('roomStatusFilter').value;
  const dateFilter = document.getElementById('roomDateFilter').value || todayISO();
  const isToday = dateFilter === todayISO();
  container.innerHTML = '';

  const visible = statusFilter ? currentRoomsData.filter((r) => r.status === statusFilter) : currentRoomsData;

  visible.forEach((r) => {
    const card = document.createElement('div');
    card.className = `room-card room-${r.status}`;
    card.dataset.roomId = r.id;
    if (canManageRoomLayout && isToday) {
      card.classList.add('room-draggable');
      card.style.touchAction = 'none';
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'room-name';
    nameEl.textContent = r.name;
    card.appendChild(nameEl);

    const statusEl = document.createElement('div');
    statusEl.textContent = ROOM_STATUS_LABELS[r.status] || r.status;
    if (isToday && r.needsCleaning) {
      const badge = document.createElement('span');
      badge.className = 'room-needs-cleaning-badge';
      badge.title = 'Cần dọn';
      badge.textContent = '🧹';
      statusEl.appendChild(badge);
    }
    card.appendChild(statusEl);

    if (isToday && r.needsCleaning && currentRole !== 'observer') {
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

  roomOrderDirty = false;
  document.getElementById('saveRoomOrderBtn').classList.add('hidden');

  if (canManageRoomLayout && isToday) {
    enableRoomDragAndDrop(container);
  }
}

function applyRoomStatusFilter() {
  renderRoomsGrid();
}

async function loadLayoutHistory() {
  const container = document.getElementById('roomLayoutHistory');
  container.innerHTML = '';
  let response;
  try {
    response = await fetch('/api/rooms/layout-log?limit=5');
  } catch (err) {
    return;
  }
  if (!response.ok) return;
  const entries = await response.json();
  if (!Array.isArray(entries) || entries.length === 0) return;
  const title = document.createElement('p');
  title.innerHTML = '<strong>Lịch sử sắp xếp gần đây</strong>';
  container.appendChild(title);
  entries.forEach((e) => {
    const p = document.createElement('p');
    p.textContent = `${e.changedBy} đã cập nhật bố cục — ${new Date(e.changedAt).toLocaleString('vi-VN')}`;
    container.appendChild(p);
  });
}

let draggedRoomCard = null;

function enableRoomDragAndDrop(container) {
  container.onpointerdown = (event) => {
    if (document.getElementById('roomStatusFilter').value) return;
    const card = event.target.closest('.room-draggable');
    if (!card || event.target.closest('button')) return;

    draggedRoomCard = card;
    const orderAtDragStart = [...container.querySelectorAll('.room-card')].map((c) => Number(c.dataset.roomId));
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

    container.onpointerup = () => {
      container.onpointermove = null;
      container.onpointerup = null;
      if (draggedRoomCard) {
        draggedRoomCard.classList.remove('room-dragging');
        draggedRoomCard = null;
      }
      const orderAtDragEnd = [...container.querySelectorAll('.room-card')].map((c) => Number(c.dataset.roomId));
      const orderChanged = orderAtDragEnd.length !== orderAtDragStart.length
        || orderAtDragEnd.some((id, i) => id !== orderAtDragStart[i]);
      if (orderChanged) {
        roomOrderDirty = true;
        document.getElementById('saveRoomOrderBtn').classList.remove('hidden');
      }
    };
  };
}

document.getElementById('saveRoomOrderBtn').addEventListener('click', async () => {
  if (!roomOrderDirty) return;
  const container = document.getElementById('roomsGrid');
  const orderedIds = [...container.querySelectorAll('.room-card')].map((c) => Number(c.dataset.roomId));
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
  roomOrderDirty = false;
  document.getElementById('saveRoomOrderBtn').classList.add('hidden');
  await loadRooms();
  await loadLayoutHistory();
});

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

async function loadBookingHistory() {
  const showHidden = currentRole === 'admin' && document.getElementById('showHiddenBookings').checked;
  const suffix = showHidden ? '&includeHidden=1' : '';
  const [checkedOut, cancelled] = await Promise.all([
    fetchBookings(`status=checked_out${suffix}`),
    fetchBookings(`status=cancelled${suffix}`),
  ]);
  const all = [...checkedOut, ...cancelled].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  renderList('bookingHistoryList', all, 'Chưa có đặt phòng nào đã trả phòng/huỷ.', (actions, b) => {
    if (currentRole !== 'admin') return;
    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'btn-secondary table-actions-btn';
    hideBtn.textContent = b.isHidden ? 'Hiện' : 'Ẩn';
    hideBtn.addEventListener('click', async () => {
      let response;
      try {
        response = await fetch(`/api/bookings/${b.id}/hide`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hidden: !b.isHidden }),
        });
      } catch (err) {
        showOpsError('Có lỗi khi ẩn/hiện đặt phòng');
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        showOpsError(body.error || 'Có lỗi khi ẩn/hiện đặt phòng');
        return;
      }
      showOpsError('');
      await loadBookingHistory();
    });
    actions.appendChild(hideBtn);
  });
}
