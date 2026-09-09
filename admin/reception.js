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

const ROOM_TYPE_PRICES = {
  triangle: 300000,
  circle: 600000,
  ede_cozy: 600000,
  vip: 900000,
  bungalow: 700000,
  dormitory: 1200000,
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
let dineMenuItems = [];

const CATALOG_CATEGORY_LABELS = {
  luu_tru: 'Lưu trú',
  fnb_hoat_dong: 'F&B & Hoạt động',
  su_kien_team_building: 'Sự kiện & Team Building',
};
const CATALOG_CATEGORY_ORDER = ['luu_tru', 'fnb_hoat_dong', 'su_kien_team_building'];

let bookingHistoryAll = [];
let bookingHistoryPage = 1;
const BOOKING_HISTORY_PAGE_SIZE = 10;

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
  const dineMenuRaw = await fetch('/api/dine-in-menu').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  dineMenuItems = dineMenuRaw.filter((m) => m.isActive);
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
  document.getElementById('bookingHistorySearch').addEventListener('input', () => {
    bookingHistoryPage = 1;
    renderBookingHistoryPage();
  });
  document.getElementById('bookingHistoryPrevBtn').addEventListener('click', () => {
    if (bookingHistoryPage > 1) {
      bookingHistoryPage -= 1;
      renderBookingHistoryPage();
    }
  });
  document.getElementById('bookingHistoryNextBtn').addEventListener('click', () => {
    bookingHistoryPage += 1;
    renderBookingHistoryPage();
  });
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
    if (item.status === 'posted' && currentRole !== 'observer' && (item.paymentStatus !== 'paid' || currentRole === 'admin')) {
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

function buildServiceGroups() {
  const groups = [];
  CATALOG_CATEGORY_ORDER.forEach((catKey) => {
    if (catalogItems.some((c) => c.category === catKey)) {
      groups.push({ kind: 'catalog', key: catKey, label: CATALOG_CATEGORY_LABELS[catKey] });
    }
  });
  const seenSubgroups = new Set();
  dineMenuItems.forEach((m) => {
    if (m.subgroup && !seenSubgroups.has(m.subgroup)) {
      seenSubgroups.add(m.subgroup);
      groups.push({ kind: 'menu', key: m.subgroup, label: m.subgroup });
    }
  });
  return groups;
}

function openAddServiceForm(bookingId, section) {
  document.querySelectorAll('.add-service-form').forEach((el) => el.remove());

  const form = document.createElement('div');
  form.className = 'add-service-form';

  const groupSelect = document.createElement('select');
  const groupPlaceholderOpt = document.createElement('option');
  groupPlaceholderOpt.value = '';
  groupPlaceholderOpt.textContent = '-- Chọn nhóm --';
  groupSelect.appendChild(groupPlaceholderOpt);
  buildServiceGroups().forEach((g, index) => {
    const opt = document.createElement('option');
    opt.value = String(index);
    opt.textContent = g.label;
    opt.dataset.kind = g.kind;
    opt.dataset.key = g.key;
    groupSelect.appendChild(opt);
  });

  const itemSelect = document.createElement('select');

  function populateItemSelect() {
    const groupOpt = groupSelect.options[groupSelect.selectedIndex];
    itemSelect.innerHTML = '';
    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = '-- Chọn món/dịch vụ --';
    itemSelect.appendChild(placeholderOpt);
    if (!groupOpt || !groupOpt.dataset.kind) return;

    if (groupOpt.dataset.kind === 'catalog') {
      catalogItems.filter((c) => c.category === groupOpt.dataset.key).forEach((item) => {
        const opt = document.createElement('option');
        opt.value = `catalog:${item.id}`;
        opt.textContent = item.name;
        opt.dataset.source = 'catalog';
        opt.dataset.sourceId = item.id;
        opt.dataset.priceMin = item.priceMin != null ? item.priceMin : '';
        opt.dataset.isScheduled = item.isScheduled ? '1' : '';
        opt.dataset.termsAndConditions = item.termsAndConditions || '';
        itemSelect.appendChild(opt);
      });
    } else {
      dineMenuItems.filter((m) => m.subgroup === groupOpt.dataset.key).forEach((item) => {
        const opt = document.createElement('option');
        opt.value = `menu:${item.id}`;
        opt.textContent = item.name;
        opt.dataset.source = 'menu';
        opt.dataset.sourceId = item.id;
        opt.dataset.priceMin = item.price != null ? item.price : '';
        opt.dataset.isScheduled = '';
        opt.dataset.termsAndConditions = '';
        itemSelect.appendChild(opt);
      });
    }
  }
  populateItemSelect();

  const groupLabel = document.createElement('label');
  groupLabel.append('Nhóm', groupSelect);

  const itemLabel = document.createElement('label');
  itemLabel.append('Món/Dịch vụ', itemSelect);

  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.step = '1000';
  priceInput.placeholder = 'Giá';
  const priceLabel = document.createElement('label');
  priceLabel.append('Giá', priceInput);

  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.step = '1';
  qtyInput.value = '1';
  const qtyLabelTextNode = document.createTextNode('Số lượng');
  const qtyLabel = document.createElement('label');
  qtyLabel.append(qtyLabelTextNode, qtyInput);

  const fieldsRow = document.createElement('div');
  fieldsRow.className = 'form-row-4';
  fieldsRow.append(groupLabel, itemLabel, priceLabel, qtyLabel);

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
    const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
    const catalogId = selectedOpt && selectedOpt.dataset.source === 'catalog' ? selectedOpt.dataset.sourceId : '';
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

  function resetItemDependentFields() {
    const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
    priceInput.value = (selectedOpt && selectedOpt.dataset.priceMin) || '';
    const isScheduled = !!selectedOpt && selectedOpt.dataset.isScheduled === '1';
    experienceDateInput.style.display = isScheduled ? '' : 'none';
    slotTemplateSelect.style.display = isScheduled ? '' : 'none';
    qtyLabelTextNode.data = isScheduled ? 'Số khách' : 'Số lượng';
    if (isScheduled) {
      refreshSlotAvailability();
    } else {
      termsDisplay.style.display = 'none';
      termsLabel.style.display = 'none';
      termsAcceptedCheckbox.checked = false;
    }
  }

  groupSelect.addEventListener('change', () => {
    populateItemSelect();
    resetItemDependentFields();
  });

  itemSelect.addEventListener('change', resetItemDependentFields);

  experienceDateInput.addEventListener('change', refreshSlotAvailability);

  slotTemplateSelect.addEventListener('change', () => {
    const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
    const terms = selectedOpt && selectedOpt.dataset.termsAndConditions;
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

  const tmLabel = document.createElement('label');
  tmLabel.className = 'checkbox-label';
  const tmCheckbox = document.createElement('input');
  tmCheckbox.type = 'checkbox';
  tmLabel.append(tmCheckbox, ' Đã thanh toán TM');

  const ckLabel = document.createElement('label');
  ckLabel.className = 'checkbox-label';
  const ckCheckbox = document.createElement('input');
  ckCheckbox.type = 'checkbox';
  ckLabel.append(ckCheckbox, ' Đã thanh toán CK');

  tmCheckbox.addEventListener('change', () => {
    if (tmCheckbox.checked) ckCheckbox.checked = false;
  });
  ckCheckbox.addEventListener('change', () => {
    if (ckCheckbox.checked) tmCheckbox.checked = false;
  });

  const paymentRow = document.createElement('div');
  paymentRow.className = 'payment-row';
  paymentRow.append(tmLabel, ckLabel);

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
    const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
    if (!selectedOpt || !selectedOpt.dataset.sourceId) {
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

    const isCatalog = selectedOpt.dataset.source === 'catalog';
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

    const paid = tmCheckbox.checked || ckCheckbox.checked;
    const paymentMethod = tmCheckbox.checked ? 'cash' : (ckCheckbox.checked ? 'transfer' : undefined);
    const payload = { unitPrice, quantity, paid, paymentMethod, experienceDate, slotTemplateId, termsAccepted };
    if (isCatalog) {
      payload.serviceCatalogId = Number(selectedOpt.dataset.sourceId);
    } else {
      payload.dineInMenuItemId = Number(selectedOpt.dataset.sourceId);
    }

    let response;
    try {
      response = await fetch(`/api/bookings/${bookingId}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

  form.append(fieldsRow, experienceDateInput, slotTemplateSelect, termsDisplay, termsLabel, paymentRow, confirmBtn, cancelBtn, errorEl, alternativesEl);
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

  if ((b.status === 'pending' || b.status === 'confirmed' || b.status === 'checked_in') && currentRole !== 'observer') {
    const depositTotalLine = document.createElement('p');
    const depositTotalStrong = document.createElement('strong');
    depositTotalStrong.textContent = `Cọc: ${formatVnd(b.depositAmount || 0)}`;
    depositTotalLine.appendChild(depositTotalStrong);
    card.appendChild(depositTotalLine);

    const deposits = b.deposits || [];
    if (deposits.length > 0) {
      const historyList = document.createElement('div');
      historyList.className = 'deposit-history';
      const methodLabels = { cash: 'Tiền mặt', transfer: 'Chuyển khoản' };
      deposits.forEach((d) => {
        const line = document.createElement('p');
        line.textContent = `${formatVnd(d.amount)} · ${methodLabels[d.paymentMethod] || d.paymentMethod} · ${formatDate(d.createdAt)}`;
        historyList.appendChild(line);
      });
      card.appendChild(historyList);
    }

    const addDepositForm = document.createElement('div');
    addDepositForm.className = 'add-deposit-form';

    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.step = '1000';
    amountInput.placeholder = 'Số tiền cọc';
    amountInput.style.width = '140px';

    const cashLabel = document.createElement('label');
    cashLabel.className = 'checkbox-label';
    const cashRadio = document.createElement('input');
    cashRadio.type = 'radio';
    cashRadio.name = `depositMethod-${b.id}`;
    cashRadio.value = 'cash';
    cashLabel.append(cashRadio, ' 💵 Tiền mặt');

    const transferLabel = document.createElement('label');
    transferLabel.className = 'checkbox-label';
    const transferRadio = document.createElement('input');
    transferRadio.type = 'radio';
    transferRadio.name = `depositMethod-${b.id}`;
    transferRadio.value = 'transfer';
    transferLabel.append(transferRadio, ' 🏦 Chuyển khoản');

    const addDepositBtn = document.createElement('button');
    addDepositBtn.type = 'button';
    addDepositBtn.textContent = 'Lưu cọc';
    addDepositBtn.className = 'btn-secondary';
    addDepositBtn.addEventListener('click', async () => {
      if (amountInput.value.trim() === '') {
        showOpsError('Vui lòng nhập số tiền cọc');
        return;
      }
      const amount = Number(amountInput.value);
      if (!Number.isInteger(amount) || amount <= 0) {
        showOpsError('Số tiền cọc phải là số nguyên dương');
        return;
      }
      const paymentMethod = cashRadio.checked ? 'cash' : (transferRadio.checked ? 'transfer' : null);
      if (!paymentMethod) {
        showOpsError('Vui lòng chọn hình thức thanh toán');
        return;
      }
      let response;
      try {
        response = await fetch(`/api/bookings/${b.id}/deposits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, paymentMethod }),
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
      await refreshAll();
    });

    addDepositForm.append(amountInput, cashLabel, transferLabel, addDepositBtn);
    card.appendChild(addDepositForm);
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
    cancelBtn.addEventListener('click', () => openCancelDialog(b));
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
    cancelBtn.addEventListener('click', () => openCancelDialog(b));
    actions.appendChild(cancelBtn);
  });
}

async function loadDepartures() {
  const bookings = await fetchBookings(`status=checked_in&date=${todayISO()}&view=departures`);
  renderList('departuresList', bookings, 'Không có khách đi hôm nay.', (actions, b) => {
    if (currentRole === 'observer') return;
    const btn = document.createElement('button');
    btn.textContent = 'Check-out';
    btn.addEventListener('click', () => openCheckoutDialog(b));
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

function daysBeforeCheckin(checkIn) {
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = checkIn.split('-').map(Number);
  const checkInUTC = Date.UTC(y, m - 1, d);
  return Math.floor((checkInUTC - todayUTC) / 86400000);
}

let cancellingBooking = null;
let cachedCancellationTiers = null;

async function loadCancellationTiers() {
  if (cachedCancellationTiers) return cachedCancellationTiers;
  try {
    const response = await fetch('/api/cancellation-policy');
    cachedCancellationTiers = response.ok ? await response.json() : [];
  } catch (err) {
    cachedCancellationTiers = [];
  }
  return cachedCancellationTiers;
}

function findRefundPercent(tiers, daysBefore) {
  const match = tiers.find((t) => t.minDaysBeforeCheckin <= daysBefore);
  return match ? match.refundPercent : 0;
}

async function openCancelDialog(booking) {
  cancellingBooking = booking;
  document.getElementById('cancelError').textContent = '';
  document.getElementById('cancelCash').checked = false;
  document.getElementById('cancelTransfer').checked = false;

  const tiers = await loadCancellationTiers();
  const daysBefore = daysBeforeCheckin(booking.checkIn);
  const refundPercent = findRefundPercent(tiers, daysBefore);
  const refundAmount = Math.round((booking.depositAmount || 0) * refundPercent / 100);

  const summary = document.getElementById('cancelSummary');
  const fields = document.getElementById('cancelPaymentFields');
  if (refundAmount > 0) {
    summary.textContent = `Hoàn cọc: ${refundPercent}% (${formatVnd(refundAmount)})`;
    fields.classList.remove('hidden');
  } else {
    summary.textContent = 'Không hoàn cọc (theo chính sách huỷ hiện tại).';
    fields.classList.add('hidden');
  }

  document.getElementById('cancelOverlay').classList.remove('hidden');
}

function closeCancelDialog() {
  cancellingBooking = null;
  document.getElementById('cancelOverlay').classList.add('hidden');
}

document.getElementById('cancelCancelBtn').addEventListener('click', closeCancelDialog);

document.getElementById('cancelSubmitBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('cancelError');
  errorEl.textContent = '';

  const fieldsVisible = !document.getElementById('cancelPaymentFields').classList.contains('hidden');
  let paymentMethod = null;
  if (fieldsVisible) {
    paymentMethod = document.getElementById('cancelCash').checked ? 'cash' : (document.getElementById('cancelTransfer').checked ? 'transfer' : null);
    if (!paymentMethod) {
      errorEl.textContent = 'Vui lòng chọn hình thức thanh toán';
      return;
    }
  }

  let response;
  try {
    response = await fetch(`/api/bookings/${cancellingBooking.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethod }),
    });
  } catch (err) {
    errorEl.textContent = 'Có lỗi xảy ra';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi xảy ra';
    if (body.error === 'Vui lòng chọn hình thức thanh toán') {
      // Server computed a nonzero refund from fresh tiers while our cached tiers said 0% (policy
      // changed elsewhere while this dialog was open). Drop the stale cache so the next open
      // re-fetches, and reveal the radios now so the operator can pick one without closing/reopening.
      cachedCancellationTiers = null;
      document.getElementById('cancelPaymentFields').classList.remove('hidden');
    }
    return;
  }
  closeCancelDialog();
  showOpsError('');
  await refreshAll();
});

let checkingOutBooking = null;

function computeCheckoutPreview(booking) {
  const nights = (Date.parse(booking.checkOut) - Date.parse(booking.checkIn)) / 86400000;
  const roomTotal = nights * (ROOM_TYPE_PRICES[booking.roomType] || 0);
  const unpaidServicesTotal = (booking.services || [])
    .filter((s) => s.status === 'posted' && s.paymentStatus === 'pending')
    .reduce((sum, s) => sum + s.amount, 0);
  const deposit = booking.depositAmount || 0;

  const roomDue = Math.max(roomTotal - deposit, 0);
  const leftoverDeposit = Math.max(deposit - roomTotal, 0);
  const servicesDue = Math.max(unpaidServicesTotal - leftoverDeposit, 0);
  const refundAmount = Math.max(leftoverDeposit - unpaidServicesTotal, 0);
  return { roomDue, servicesDue, refundAmount, unpaidServicesTotal };
}

function openCheckoutDialog(booking) {
  checkingOutBooking = booking;
  document.getElementById('checkoutError').textContent = '';
  document.getElementById('checkoutCash').checked = false;
  document.getElementById('checkoutTransfer').checked = false;

  const { roomDue, servicesDue, refundAmount, unpaidServicesTotal } = computeCheckoutPreview(booking);
  const summary = document.getElementById('checkoutSummary');
  const fields = document.getElementById('checkoutPaymentFields');
  // Must mirror the server's needsPaymentMethod exactly (functions/api/bookings/[id]/check-out.js):
  // roomDue>0 || servicesDue>0 || refundAmount>0 || unpaidServicesTotal>0 — the last clause covers a
  // pending service item fully absorbed by leftover deposit (servicesDue===0) that still needs a
  // payment_method stamped onto it when it flips to 'paid'.
  const needsPaymentMethod = roomDue > 0 || servicesDue > 0 || refundAmount > 0 || unpaidServicesTotal > 0;
  if (roomDue + servicesDue > 0) {
    summary.textContent = `Cần thu thêm: ${formatVnd(roomDue + servicesDue)}`;
    fields.classList.remove('hidden');
  } else if (refundAmount > 0) {
    summary.textContent = `Cần hoàn khách: ${formatVnd(refundAmount)}`;
    fields.classList.remove('hidden');
  } else if (needsPaymentMethod) {
    summary.textContent = 'Cọc đã khớp đủ tiền phòng & dịch vụ. Vui lòng chọn hình thức thanh toán để ghi nhận dịch vụ đã thanh toán.';
    fields.classList.remove('hidden');
  } else {
    summary.textContent = 'Cọc đã khớp đủ, không cần thu/hoàn thêm.';
    fields.classList.add('hidden');
  }

  document.getElementById('checkoutOverlay').classList.remove('hidden');
}

function closeCheckoutDialog() {
  checkingOutBooking = null;
  document.getElementById('checkoutOverlay').classList.add('hidden');
}

document.getElementById('checkoutCancelBtn').addEventListener('click', closeCheckoutDialog);

document.getElementById('checkoutSubmitBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('checkoutError');
  errorEl.textContent = '';

  const fieldsVisible = !document.getElementById('checkoutPaymentFields').classList.contains('hidden');
  let paymentMethod = null;
  if (fieldsVisible) {
    paymentMethod = document.getElementById('checkoutCash').checked ? 'cash' : (document.getElementById('checkoutTransfer').checked ? 'transfer' : null);
    if (!paymentMethod) {
      errorEl.textContent = 'Vui lòng chọn hình thức thanh toán';
      return;
    }
  }

  let response;
  try {
    response = await fetch(`/api/bookings/${checkingOutBooking.id}/check-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethod }),
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
  closeCheckoutDialog();
  showOpsError('');
  await refreshAll();
});

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

function bookingHistoryActions(actions, b) {
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
}

async function loadBookingHistory() {
  const showHidden = currentRole === 'admin' && document.getElementById('showHiddenBookings').checked;
  const suffix = showHidden ? '&includeHidden=1' : '';
  const [checkedOut, cancelled] = await Promise.all([
    fetchBookings(`status=checked_out${suffix}`),
    fetchBookings(`status=cancelled${suffix}`),
  ]);
  bookingHistoryAll = [...checkedOut, ...cancelled].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  bookingHistoryPage = 1;
  renderBookingHistoryPage();
}

function renderBookingHistoryPage() {
  const term = document.getElementById('bookingHistorySearch').value.trim().toLowerCase();
  const filtered = term
    ? bookingHistoryAll.filter((b) => (b.guestName || '').toLowerCase().includes(term) || (b.phone || '').toLowerCase().includes(term))
    : bookingHistoryAll;

  const totalPages = Math.max(1, Math.ceil(filtered.length / BOOKING_HISTORY_PAGE_SIZE));
  if (bookingHistoryPage > totalPages) bookingHistoryPage = totalPages;
  const offset = (bookingHistoryPage - 1) * BOOKING_HISTORY_PAGE_SIZE;
  const pageItems = filtered.slice(offset, offset + BOOKING_HISTORY_PAGE_SIZE);

  const emptyText = term ? 'Không tìm thấy kết quả phù hợp.' : 'Chưa có đặt phòng nào đã trả phòng/huỷ.';
  renderList('bookingHistoryList', pageItems, emptyText, bookingHistoryActions);

  document.getElementById('bookingHistoryPageInfo').textContent = `Trang ${bookingHistoryPage}/${totalPages} (${filtered.length} kết quả)`;
  document.getElementById('bookingHistoryPrevBtn').disabled = bookingHistoryPage <= 1;
  document.getElementById('bookingHistoryNextBtn').disabled = bookingHistoryPage >= totalPages;
}
