// v4/admin/gio-xanh-print.js
function sessionIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('sessionId');
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

  const sessionId = sessionIdFromQuery();
  if (!sessionId) {
    document.getElementById('pageError').textContent = 'Thiếu mã phiên';
    return;
  }

  await loadSession(sessionId);
})();

async function loadSession(sessionId) {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  let response;
  try {
    response = await fetch(`/api/gio-xanh-sessions/${sessionId}`);
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải phiên';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải phiên';
    return;
  }
  const session = await response.json();
  renderInvoice(session);
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('vi-VN');
}

function renderInvoice(session) {
  const el = document.getElementById('formPrint');
  el.innerHTML = '';

  const h2 = document.createElement('h2');
  h2.textContent = 'HOÁ ĐƠN GIỜ XANH HIỀN LÊ';
  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent = 'Hiền Lê Garden';

  const dl = document.createElement('dl');
  const rows = [
    ['Phòng', session.roomName],
    ['Tên khách', session.guestName],
    ['Số điện thoại', session.phone || ''],
    ['Giờ mở', formatDateTime(session.openedAt)],
    ['Giờ chốt', session.closedAt ? formatDateTime(session.closedAt) : ''],
    ['Hình thức thanh toán', session.paymentMethod === 'cash' ? 'Tiền mặt' : session.paymentMethod === 'transfer' ? 'Chuyển khoản' : ''],
  ];
  rows.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  });

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Mục</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr>';
  const tbody = document.createElement('tbody');
  let total = 0;
  session.items.filter((i) => i.status === 'posted').forEach((item) => {
    total += item.amount;
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = item.name;
    const tdQty = document.createElement('td');
    tdQty.textContent = item.quantity;
    const tdPrice = document.createElement('td');
    tdPrice.textContent = `${item.unitPrice.toLocaleString('vi-VN')}đ`;
    const tdAmount = document.createElement('td');
    tdAmount.textContent = `${item.amount.toLocaleString('vi-VN')}đ`;
    tr.append(tdName, tdQty, tdPrice, tdAmount);
    tbody.appendChild(tr);
  });
  const totalRow = document.createElement('tr');
  totalRow.className = 'total-row';
  totalRow.innerHTML = `<td colspan="3">Tổng cộng</td><td>${total.toLocaleString('vi-VN')}đ</td>`;
  tbody.appendChild(totalRow);
  table.append(thead, tbody);

  el.append(h2, subtitle, dl, table);
}

document.getElementById('printBtn').addEventListener('click', () => {
  window.print();
});
