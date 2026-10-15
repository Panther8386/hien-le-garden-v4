// v4/admin/service-orders.js — staff UI for service orders (spec 2026-10-15).
const TYPE_LABELS = { an_uong_theo_yeu_cau: 'Ăn uống theo yêu cầu', su_kien: 'Tổ chức sự kiện', dat_tiec: 'Đặt tiệc', khac: 'Khác' };
const STATUS_LABELS = { draft: 'Nháp', confirmed: 'Đã chốt', settled: 'Đã tất toán', cancelled: 'Đã huỷ' };
let currentPermissions = [];
let categories = [];
let editingOrder = null;
let currentOrder = null;
const can = (key) => currentPermissions.includes(key);
const formatVnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const categoryLabel = (slug) => (categories.find((c) => c.slug === slug) || { label: slug === 'hoan_coc' ? 'Hoàn cọc' : slug }).label;
const vnDate = (iso) => new Date(iso).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const methodLabel = (m) => (m === 'cash' ? 'Tiền mặt' : m === 'transfer' ? 'Chuyển khoản' : '—');
const el = (tag, props = {}, ...children) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...children); return n; };

function openOverlay(id) { const o = document.getElementById(id); o.classList.remove('hidden'); (o.querySelector('input, select, textarea, button') || o).focus(); }
function closeOverlay(id) { document.getElementById(id).classList.add('hidden'); }
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  ['settleOverlay', 'cancelOverlay', 'orderDetailOverlay', 'orderFormOverlay'].some((id) => {
    const o = document.getElementById(id);
    if (o.classList.contains('hidden')) return false;
    closeOverlay(id); return true;
  });
});

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const err = new Error(body.error || 'Có lỗi xảy ra'); err.status = response.status; throw err; }
  return body;
}

// A 409 means the order changed under us: show the message and reload the latest detail.
async function reportError(err, targetId) {
  document.getElementById(targetId).textContent = err.message;
  if (err.status === 409 && currentOrder) {
    await Promise.all([loadOpen(), loadHistory()]);
    await showDetail(currentOrder.id, err.message);
  }
}

(async () => {
  const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!me) { window.location.href = '/admin'; return; }
  currentPermissions = me.permissions || [];
  document.getElementById('openNewOrderBtn').hidden = !can('service_orders.manage');
  document.getElementById('showHiddenWrap').hidden = !can('records.hide');
  categories = await api('/api/service-orders/categories').catch(() => []);
  const typeSelect = document.getElementById('filterType');
  const formType = document.querySelector('#orderForm [name="orderType"]');
  Object.entries(TYPE_LABELS).forEach(([value, label]) => {
    typeSelect.append(el('option', { value, textContent: label }));
    formType.append(el('option', { value, textContent: label }));
  });
  window.HLGTabs.refresh(undefined, { normalizeHash: true });
  await Promise.all([loadOpen(), loadHistory()]);
})();

function orderCard(o) {
  const card = el('div', { className: 'booking-card' });
  card.append(
    el('strong', { textContent: `${o.quoteNumber} · ${TYPE_LABELS[o.orderType]}` }),
    el('p', { textContent: `${o.eventDate}${o.eventTime ? ` ${o.eventTime}` : ''} · ${o.customerName}${o.organization ? ` (${o.organization})` : ''}${o.guestCount ? ` · ${o.guestCount} khách` : ''}` }),
    el('p', { textContent: `Tổng ${formatVnd(o.total)} · Đã cọc ${formatVnd(o.depositAmount)} · Còn lại ${formatVnd(o.total - o.depositAmount)}${o.bookingId ? ` · Booking #${o.bookingId}` : ''}` }),
    el('span', { className: 'status-badge', textContent: STATUS_LABELS[o.status] }),
  );
  const open = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Xem chi tiết' });
  open.addEventListener('click', () => showDetail(o.id));
  card.append(open);
  return card;
}

function renderList(containerId, rows, emptyText) {
  const box = document.getElementById(containerId);
  box.replaceChildren(...(rows.length ? rows.map(orderCard) : [el('p', { textContent: emptyText })]));
}

async function loadOpen() {
  const type = document.getElementById('filterType').value;
  try {
    const rows = await api(`/api/service-orders?status=open${type ? `&type=${encodeURIComponent(type)}` : ''}`);
    renderList('openOrdersList', rows, 'Chưa có đơn sắp diễn ra.');
  } catch (e) { document.getElementById('pageError').textContent = e.message; }
}
async function loadHistory() {
  const q = document.getElementById('historySearch').value.trim();
  const hidden = can('records.hide') && document.getElementById('showHiddenOrders').checked;
  try {
    const rows = await api(`/api/service-orders?status=history${q ? `&q=${encodeURIComponent(q)}` : ''}${hidden ? '&includeHidden=1' : ''}`);
    renderList('historyOrdersList', rows, 'Chưa có đơn đã tất toán hoặc đã huỷ.');
  } catch (e) { document.getElementById('pageError').textContent = e.message; }
}
document.getElementById('filterType').addEventListener('change', loadOpen);
document.getElementById('historySearch').addEventListener('input', () => { clearTimeout(loadHistory.t); loadHistory.t = setTimeout(loadHistory, 300); });
document.getElementById('showHiddenOrders').addEventListener('change', loadHistory);

// ---- Form ----
function categoryOptions(select, selected, allowInactive) {
  select.replaceChildren(...categories.filter((c) => c.isActive || c.slug === allowInactive)
    .map((c) => el('option', { value: c.slug, textContent: c.label, selected: c.slug === selected })));
}
function itemRow(item = { description: '', quantity: 1, unitPrice: 0, financeCategory: document.querySelector('#orderForm [name="primaryCategory"]').value }) {
  const tr = el('tr');
  tr.dataset.id = item.id ?? '';
  const desc = el('input', { value: item.description, maxLength: 500, required: true, ariaLabel: 'Mô tả' });
  const qty = el('input', { type: 'number', min: 1, step: 1, value: item.quantity, required: true, ariaLabel: 'Số lượng' });
  const price = el('input', { type: 'number', min: 0, step: 1, value: item.unitPrice, required: true, ariaLabel: 'Đơn giá' });
  const cat = el('select', { ariaLabel: 'Mảng' });
  categoryOptions(cat, item.financeCategory, item.id ? item.financeCategory : null);
  const amount = el('td');
  const remove = el('button', { type: 'button', className: 'btn-ghost', textContent: '✕', ariaLabel: 'Xoá dòng' });
  remove.addEventListener('click', () => { tr.remove(); refreshTotals(); });
  [desc, qty, price, cat].forEach((input) => input.addEventListener('input', refreshTotals));
  tr.append(el('td', {}, desc), el('td', {}, qty), el('td', {}, price), el('td', {}, cat), amount, el('td', {}, remove));
  return tr;
}
function readItems() {
  return [...document.querySelectorAll('#itemsBody tr')].map((tr) => {
    const [desc, qty, price] = tr.querySelectorAll('input');
    return { id: tr.dataset.id ? Number(tr.dataset.id) : null, description: desc.value, quantity: Number(qty.value), unitPrice: Number(price.value), financeCategory: tr.querySelector('select').value };
  });
}
function refreshTotals() {
  const items = readItems();
  const totals = {};
  document.querySelectorAll('#itemsBody tr').forEach((tr, i) => {
    const it = items[i];
    tr.lastElementChild.previousElementSibling.textContent = formatVnd(it.quantity * it.unitPrice);
    totals[it.financeCategory] = (totals[it.financeCategory] || 0) + it.quantity * it.unitPrice;
  });
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  document.getElementById('itemsTotals').replaceChildren(
    ...Object.entries(totals).map(([slug, v]) => el('p', { textContent: `${categoryLabel(slug)}: ${formatVnd(v)}` })),
    el('p', {}, el('strong', { textContent: `Tổng đơn: ${formatVnd(total)}` })),
  );
  const primary = document.querySelector('#orderForm [name="primaryCategory"]').value;
  const deposit = editingOrder ? editingOrder.depositAmount : 0;
  const warn = document.getElementById('depositWarning');
  warn.hidden = deposit <= (totals[primary] || 0);
  warn.textContent = `Đã cọc ${formatVnd(deposit)} vượt giá trị mảng chính (${formatVnd(totals[primary] || 0)}).`;
}
document.getElementById('addItemBtn').addEventListener('click', () => { document.getElementById('itemsBody').append(itemRow()); refreshTotals(); });
document.querySelector('#orderForm [name="primaryCategory"]').addEventListener('change', refreshTotals);

async function loadBookingOptions(selected) {
  const select = document.querySelector('#orderForm [name="bookingId"]');
  select.replaceChildren(el('option', { value: '', textContent: 'Không gắn' }));
  // Without bookings.view the user cannot pick bookings: disable the select, but keep the stored link
  // as the only option (a disabled select still exposes .value, so the submit preserves bookingId).
  select.disabled = !can('bookings.view');
  if (can('bookings.view')) {
    const lists = await Promise.all(['confirmed', 'checked_in'].map((s) => api(`/api/bookings?status=${s}`).catch(() => [])));
    lists.flat().forEach((b) => select.append(el('option', { value: b.id, textContent: `#${b.id} · ${b.guestName} · ${b.checkIn}→${b.checkOut}`, selected: b.id === selected })));
  }
  if (selected && ![...select.options].some((o) => Number(o.value) === selected)) select.append(el('option', { value: selected, textContent: `#${selected}`, selected: true }));
}

async function openForm(order = null) {
  editingOrder = order;
  const form = document.getElementById('orderForm');
  form.reset();
  document.getElementById('orderFormError').textContent = '';
  document.getElementById('orderFormTitle').textContent = order ? `Sửa đơn ${order.quoteNumber}` : 'Đơn mới';
  categoryOptions(form.primaryCategory, order ? order.primaryCategory : (categories.find((c) => c.isActive) || {}).slug, order ? order.primaryCategory : null);
  await loadBookingOptions(order ? order.bookingId : null);
  const fields = order || { orderType: 'dat_tiec', quoteValidDays: '', requestedDeposit: '' };
  ['orderType', 'eventDate', 'eventTime', 'guestCount', 'customerName', 'phone', 'organization', 'venueNote', 'requestedDeposit', 'quoteValidDays', 'note']
    .forEach((name) => { form[name].value = fields[name] ?? ''; });
  if (!order) {
    const settings = await api('/api/quote-settings').catch(() => ({ defaultValidDays: 7 }));
    form.quoteValidDays.value = settings.defaultValidDays;
  }
  form.phone.required = !order || order.phone !== null;
  const body = document.getElementById('itemsBody');
  body.replaceChildren(...(order ? order.items.map(itemRow) : [itemRow()]));
  refreshTotals();
  openOverlay('orderFormOverlay');
}
document.getElementById('openNewOrderBtn').addEventListener('click', () => openForm());
document.getElementById('closeOrderFormBtn').addEventListener('click', () => closeOverlay('orderFormOverlay'));

let saving = false;
document.getElementById('orderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  const form = event.target;
  const num = (v) => (v === '' ? null : Number(v));
  const payload = {
    orderType: form.orderType.value, eventDate: form.eventDate.value, eventTime: form.eventTime.value || null, guestCount: num(form.guestCount.value),
    customerName: form.customerName.value, phone: form.phone.value || null, organization: form.organization.value, venueNote: form.venueNote.value,
    bookingId: num(form.bookingId.value), primaryCategory: form.primaryCategory.value, note: form.note.value,
    quoteValidDays: Number(form.quoteValidDays.value), items: readItems(),
  };
  if (editingOrder) payload.version = editingOrder.version;
  if (form.requestedDeposit.value !== '') payload.requestedDeposit = Number(form.requestedDeposit.value);
  else if (editingOrder) payload.requestedDeposit = editingOrder.requestedDeposit;
  saving = true;
  form.querySelector('button[type="submit"]').disabled = true;
  try {
    const url = editingOrder ? `/api/service-orders/${editingOrder.id}` : '/api/service-orders';
    const result = await api(url, { method: editingOrder ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    closeOverlay('orderFormOverlay');
    await Promise.all([loadOpen(), loadHistory()]);
    await showDetail(editingOrder ? editingOrder.id : result.id);
  } catch (e) {
    document.getElementById('orderFormError').textContent = e.message;
    if (e.status === 409 && editingOrder) { closeOverlay('orderFormOverlay'); currentOrder = editingOrder; await reportError(e, 'orderDetailError'); }
  } finally {
    saving = false;
    form.querySelector('button[type="submit"]').disabled = false;
  }
});

// ---- Detail ----
async function showDetail(id, notice = '') {
  document.getElementById('orderDetailError').textContent = notice;
  try { currentOrder = await api(`/api/service-orders/${id}`); } catch (e) { document.getElementById('pageError').textContent = e.message; return; }
  const o = currentOrder;
  const open = o.status === 'draft' || o.status === 'confirmed';
  const box = document.getElementById('orderDetail');
  const rows = o.items.map((i) => el('tr', {}, el('td', { textContent: i.description }), el('td', { textContent: i.quantity }),
    el('td', { textContent: formatVnd(i.unitPrice) }), el('td', { textContent: categoryLabel(i.financeCategory) }), el('td', { textContent: formatVnd(i.quantity * i.unitPrice) })));
  const deposits = o.deposits.filter((d) => !d.voidedAt).map((d) => {
    const line = el('p', { textContent: `${formatVnd(d.amount)} · ${d.paymentMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'} · ${d.createdAt.slice(0, 10)}${d.note ? ` · ${d.note}` : ''}` });
    if (open && can('service_orders.refund')) {
      const del = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Xoá cọc' });
      del.addEventListener('click', () => deleteDeposit(d.id, del));
      line.append(' ', del);
    }
    return line;
  });
  box.replaceChildren(
    el('p', { textContent: `${o.quoteNumber} · ${TYPE_LABELS[o.orderType]} · ${STATUS_LABELS[o.status]}` }),
    el('p', { textContent: `${o.eventDate}${o.eventTime ? ` ${o.eventTime}` : ''} · ${o.customerName}${o.phone ? ` · ${o.phone}` : ''}${o.organization ? ` · ${o.organization}` : ''}` }),
    el('p', { textContent: `Mảng chính: ${categoryLabel(o.primaryCategory)}${o.bookingId ? ` · Booking #${o.bookingId}` : ''}` }),
    el('div', { className: 'table-scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Mô tả', 'SL', 'Đơn giá', 'Mảng', 'Thành tiền'].map((h) => el('th', { textContent: h })))), el('tbody', {}, ...rows))),
    el('p', {}, el('strong', { textContent: `Tổng ${formatVnd(o.total)} · Đã cọc ${formatVnd(o.depositAmount)} · Còn lại ${formatVnd(o.total - o.depositAmount)}` })),
    el('h3', { textContent: 'Tiền cọc' }), ...(deposits.length ? deposits : [el('p', { textContent: 'Chưa có cọc.' })]),
  );
  if (o.status === 'cancelled') box.append(el('p', { textContent: `Huỷ bởi ${o.cancellationOrigin === 'hotel' ? 'khách sạn' : 'khách'} · Lý do: ${o.cancelReason} · Hoàn ${formatVnd(o.refundAmount)} · ${methodLabel(o.refundPaymentMethod)}` }));
  if (o.status === 'settled' && o.settledAt) box.append(el('p', { textContent: `Tất toán lúc ${vnDate(o.settledAt)} · ${methodLabel(o.settlementPaymentMethod)}` }));
  const financeRows = o.financeRows || [];
  if (financeRows.length) {
    box.append(el('h3', { textContent: 'Khoản thu chi liên kết' }), ...financeRows.map((r) => el('p', {
      textContent: `${r.type === 'income' ? 'Thu' : 'Chi'} · ${categoryLabel(r.category)} · ${formatVnd(r.amount)} · ${r.transactionDate}${r.voidedAt ? ' · đã huỷ' : ''}`,
    })));
  }
  const actions = el('div', { className: 'form-row' });
  if (open && can('service_orders.manage')) {
    const depositForm = el('form', { className: 'add-deposit-form' });
    const amount = el('input', { type: 'number', min: 1, step: 1, placeholder: 'Số tiền cọc', required: true, ariaLabel: 'Số tiền cọc' });
    const method = el('select', { ariaLabel: 'Hình thức' }, el('option', { value: 'cash', textContent: 'Tiền mặt' }), el('option', { value: 'transfer', textContent: 'Chuyển khoản' }));
    const note = el('input', { maxLength: 500, placeholder: 'Ghi chú', ariaLabel: 'Ghi chú cọc' });
    const save = el('button', { type: 'submit', textContent: 'Nhận cọc' });
    depositForm.append(amount, method, note, save);
    depositForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try { await api(`/api/service-orders/${o.id}/deposits`, { method: 'POST', body: JSON.stringify({ amount: Number(amount.value), paymentMethod: method.value, note: note.value || null }) }); await afterAction(); }
      catch (err) { save.disabled = false; await reportError(err, 'orderDetailError'); }
    });
    box.append(depositForm);
    const edit = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Sửa đơn' });
    edit.addEventListener('click', () => { closeOverlay('orderDetailOverlay'); openForm(o); });
    actions.append(edit);
    if (o.status === 'draft') actions.append(actionButton('Chốt đơn', () => api(`/api/service-orders/${o.id}/confirm`, { method: 'POST' })));
    if (o.status === 'confirmed') { const s = el('button', { type: 'button', textContent: 'Tất toán' }); s.addEventListener('click', openSettle); actions.append(s); }
    if (o.depositAmount === 0 || can('service_orders.refund')) { const c = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Huỷ đơn' }); c.addEventListener('click', openCancel); actions.append(c); }
  }
  if (o.status !== 'cancelled') {
    const print = el('a', { className: 'btn-secondary', href: `/admin/service-order-quote.html?orderId=${o.id}`, target: '_blank', rel: 'noopener', textContent: 'In báo giá' });
    actions.append(print);
  }
  if (!open && can('records.hide')) actions.append(actionButton(o.isHidden ? 'Hiện lại' : 'Ẩn khỏi lịch sử', () => api(`/api/service-orders/${o.id}/hide`, { method: 'PATCH', body: JSON.stringify({ hidden: !o.isHidden }) })));
  box.append(actions);
  openOverlay('orderDetailOverlay');
}
function actionButton(label, run) {
  const b = el('button', { type: 'button', className: 'btn-secondary', textContent: label });
  b.addEventListener('click', async () => { b.disabled = true; try { await run(); await afterAction(); } catch (e) { b.disabled = false; await reportError(e, 'orderDetailError'); } });
  return b;
}
async function afterAction() { await Promise.all([loadOpen(), loadHistory()]); await showDetail(currentOrder.id); }
async function deleteDeposit(depositId, button) {
  button.disabled = true;
  try { await api(`/api/service-orders/${currentOrder.id}/deposits/${depositId}`, { method: 'DELETE' }); await afterAction(); }
  catch (e) { button.disabled = false; await reportError(e, 'orderDetailError'); }
}
document.getElementById('closeOrderDetailBtn').addEventListener('click', () => closeOverlay('orderDetailOverlay'));

// ---- Settle ----
function settlementPreview(o) {
  const totals = {};
  o.items.forEach((i) => { totals[i.financeCategory] = (totals[i.financeCategory] || 0) + i.quantity * i.unitPrice; });
  return Object.entries(totals).map(([c, v]) => ({ category: c, amount: c === o.primaryCategory ? v - o.depositAmount : v })).filter((p) => p.amount > 0);
}
function openSettle() {
  const plan = settlementPreview(currentOrder);
  document.getElementById('settleError').textContent = '';
  document.getElementById('settlePreview').replaceChildren(
    ...(plan.length ? plan.map((p) => el('p', { textContent: `Thu · ${categoryLabel(p.category)}: ${formatVnd(p.amount)}` })) : [el('p', { textContent: 'Cọc đã đủ, không phát sinh khoản thu.' })]),
  );
  document.getElementById('settleMethodFields').hidden = plan.length === 0;
  document.querySelectorAll('[name="settleMethod"]').forEach((r) => { r.checked = false; });
  openOverlay('settleOverlay');
}
document.getElementById('settleSubmitBtn').addEventListener('click', async (e) => {
  const method = document.querySelector('[name="settleMethod"]:checked');
  e.target.disabled = true;
  try { await api(`/api/service-orders/${currentOrder.id}/settle`, { method: 'POST', body: JSON.stringify({ paymentMethod: method ? method.value : null }) }); closeOverlay('settleOverlay'); await afterAction(); }
  catch (err) { if (err.status === 409) closeOverlay('settleOverlay'); await reportError(err, 'settleError'); }
  finally { e.target.disabled = false; }
});
document.getElementById('settleCloseBtn').addEventListener('click', () => closeOverlay('settleOverlay'));

// ---- Cancel ----
function openCancel() {
  const o = currentOrder;
  document.getElementById('cancelError').textContent = '';
  document.getElementById('cancelReason').value = '';
  const refund = document.getElementById('refundFields');
  refund.hidden = o.depositAmount === 0;
  document.getElementById('refundHint').textContent = `Đã cọc ${formatVnd(o.depositAmount)}. Nhập số tiền hoàn (0 nếu giữ toàn bộ cọc).`;
  const amount = document.getElementById('refundAmount');
  amount.value = 0;
  amount.max = o.depositAmount;
  document.querySelectorAll('[name="refundMethod"]').forEach((r) => { r.checked = false; });
  openOverlay('cancelOverlay');
}
document.getElementById('cancelSubmitBtn').addEventListener('click', async (e) => {
  const o = currentOrder;
  const body = { origin: document.querySelector('[name="cancelOrigin"]:checked').value, reason: document.getElementById('cancelReason').value };
  if (o.depositAmount > 0) {
    body.refundAmount = Number(document.getElementById('refundAmount').value || 0);
    const method = document.querySelector('[name="refundMethod"]:checked');
    if (method) body.refundPaymentMethod = method.value;
  }
  e.target.disabled = true;
  try { await api(`/api/service-orders/${o.id}/cancel`, { method: 'POST', body: JSON.stringify(body) }); closeOverlay('cancelOverlay'); await afterAction(); }
  catch (err) { if (err.status === 409) closeOverlay('cancelOverlay'); await reportError(err, 'cancelError'); }
  finally { e.target.disabled = false; }
});
document.getElementById('cancelCloseBtn').addEventListener('click', () => closeOverlay('cancelOverlay'));
