// v4/admin/stay-registration-print.js
let currentBooking = null;

function bookingIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('bookingId');
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

  const bookingId = bookingIdFromQuery();
  if (!bookingId) {
    document.getElementById('pageError').textContent = 'Thiếu mã đặt phòng';
    return;
  }

  await loadBooking(bookingId);
})();

async function loadBooking(bookingId) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  let response;
  try {
    response = await fetch(`/api/bookings/${bookingId}`);
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải thông tin đặt phòng';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải thông tin đặt phòng';
    return;
  }
  currentBooking = await response.json();
  document.getElementById('idNumberInput').value = currentBooking.idNumber || '';
  document.getElementById('nationalityInput').value = currentBooking.nationality || '';
  renderForm();
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('vi-VN');
}

function renderForm() {
  const el = document.getElementById('formPrint');
  const b = currentBooking;
  el.innerHTML = '';

  const h2 = document.createElement('h2');
  h2.textContent = 'PHIẾU ĐĂNG KÝ LƯU TRÚ';
  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent = 'Hiền Lê Garden';

  const dl = document.createElement('dl');
  const rows = [
    ['Họ và tên khách', b.guestName],
    ['Số điện thoại', b.phone || ''],
    ['Quốc tịch', b.nationality || ''],
    ['Số CCCD/hộ chiếu', b.idNumber || ''],
    ['Phòng', b.roomName || ''],
    ['Số khách', b.guestsCount != null ? String(b.guestsCount) : ''],
    ['Ngày đến', formatDate(b.checkIn)],
    ['Ngày đi', formatDate(b.checkOut)],
  ];
  rows.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  });

  const signatures = document.createElement('div');
  signatures.className = 'signatures';
  const guestSign = document.createElement('div');
  const guestP = document.createElement('p');
  guestP.textContent = 'Khách lưu trú';
  const guestSpace = document.createElement('div');
  guestSpace.className = 'sign-space';
  guestSign.append(guestP, guestSpace);
  const staffSign = document.createElement('div');
  const staffP = document.createElement('p');
  staffP.textContent = 'Lễ tân';
  const staffSpace = document.createElement('div');
  staffSpace.className = 'sign-space';
  staffSign.append(staffP, staffSpace);
  signatures.append(guestSign, staffSign);

  el.append(h2, subtitle, dl, signatures);
}

document.getElementById('saveIdentityBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('saveError');
  errorEl.textContent = '';
  const idNumber = document.getElementById('idNumberInput').value.trim();
  const nationality = document.getElementById('nationalityInput').value.trim();

  let response;
  try {
    response = await fetch(`/api/bookings/${currentBooking.id}/identity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idNumber, nationality }),
    });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi lưu thông tin';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu thông tin';
    return;
  }
  currentBooking.idNumber = idNumber || null;
  currentBooking.nationality = nationality || null;
  renderForm();
});

document.getElementById('printBtn').addEventListener('click', () => {
  window.print();
});
