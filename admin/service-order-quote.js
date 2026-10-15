// v4/admin/service-order-quote.js — printable quote (spec 2026-10-15 §4.4).
const TYPE_LABELS = { an_uong_theo_yeu_cau: 'Ăn uống theo yêu cầu', su_kien: 'Tổ chức sự kiện', dat_tiec: 'Đặt tiệc', khac: 'Khác' };
const el = (tag, props = {}, ...children) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...children); return n; };
const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const viDate = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
// Calendar date (YYYY-MM-DD) of an instant in Vietnam time; the event date is already a plain date and needs no conversion.
const vnDay = (instant) => new Date(instant).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

// Vietnamese amount in words, e.g. 1250000 → "Một triệu hai trăm năm mươi nghìn đồng".
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function readTriple(n, full) {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  const out = [];
  if (full || h) out.push(`${DIGITS[h]} trăm`);
  if (t > 1) out.push(`${DIGITS[t]} mươi`);
  else if (t === 1) out.push('mười');
  else if ((full || h) && u) out.push('lẻ');
  if (u) out.push(t > 1 && u === 1 ? 'mốt' : t >= 1 && u === 5 ? 'lăm' : DIGITS[u]);
  return out.join(' ');
}
function amountInWords(amount) {
  if (!amount) return 'Không đồng';
  const units = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ'];
  const groups = [];
  for (let n = amount; n > 0; n = Math.floor(n / 1000)) groups.push(n % 1000);
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (!groups[i]) continue;
    parts.push(readTriple(groups[i], i < groups.length - 1) + units[i]);
  }
  const text = `${parts.join(' ')} đồng`.replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sampleOrder() {
  const today = new Date().toISOString();
  return { id: 1, quoteNumber: `BG-${vnDay(today).slice(0, 4)}-0001`, orderType: 'dat_tiec', customerName: 'Khách mẫu', phone: '0900 000 000', organization: 'Công ty mẫu',
    eventDate: vnDay(today), eventTime: '18:00', guestCount: 40, venueNote: 'Sân vườn', quoteValidDays: 7, requestedDeposit: 3000000, depositAmount: 0,
    createdAt: today, status: 'draft', total: 10000000,
    items: [{ description: 'Set menu 8 món', quantity: 4, unitPrice: 2000000 }, { description: 'Đồ uống', quantity: 1, unitPrice: 2000000 }] };
}

function render(order, s) {
  const box = document.getElementById('quote');
  const issued = vnDay(order.createdAt);
  const validUntil = addDays(issued, order.quoteValidDays);
  const contact = [s.address, s.hotline && `Hotline/Zalo: ${s.hotline}`, s.email, s.website].filter(Boolean).join(' · ');
  const rows = order.items.map((i, index) => el('tr', {},
    el('td', { textContent: index + 1 }), el('td', { textContent: i.description }), el('td', { className: 'num', textContent: i.quantity }),
    el('td', { className: 'num', textContent: vnd(i.unitPrice) }), el('td', { className: 'num', textContent: vnd(i.quantity * i.unitPrice) })));
  const total = order.items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const info = (pairs) => el('dl', {}, ...pairs.filter(([, v]) => v).flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
  box.replaceChildren(
    el('div', { className: 'quote-head' }, el('div', {}, el('h2', { textContent: s.businessName }), el('p', { textContent: contact }))),
    el('h1', { textContent: 'PHIẾU BÁO GIÁ' }),
    el('p', { className: 'meta', textContent: `Số: ${order.quoteNumber} · Ngày lập: ${viDate(issued)} · Hiệu lực đến: ${viDate(validUntil)}` }),
    el('h3', { textContent: 'Khách hàng' }),
    info([['Khách hàng', order.customerName], ['Đơn vị', order.organization], ['Điện thoại', order.phone]]),
    el('h3', { textContent: 'Thông tin dịch vụ' }),
    info([['Loại dịch vụ', TYPE_LABELS[order.orderType]], ['Thời gian', `${viDate(order.eventDate)}${order.eventTime ? ` ${order.eventTime}` : ''}`],
      ['Số khách', order.guestCount ? String(order.guestCount) : ''], ['Khu vực / yêu cầu', order.venueNote]]),
    el('div', { className: 'quote-table' }, el('table', {}, el('thead', {}, el('tr', {}, ...['STT', 'Nội dung', 'SL', 'Đơn giá', 'Thành tiền'].map((h, i) => el('th', { className: i >= 2 ? 'num' : '', textContent: h })))),
      el('tbody', {}, ...rows, el('tr', { className: 'total' }, el('td', { colSpan: 4, textContent: 'Tổng cộng' }), el('td', { className: 'num', textContent: vnd(total) }))))),
    el('p', { textContent: `Bằng chữ: ${amountInWords(total)}.` }),
    info([['Cọc đề nghị', vnd(order.requestedDeposit)], ['Đã cọc', order.depositAmount ? vnd(order.depositAmount) : ''], ['Còn lại', vnd(total - order.depositAmount)]]),
    ...[s.taxNote, s.cancellationTerms].filter(Boolean).map((t) => el('p', { textContent: t })),
    ...(s.bankAccount ? [el('p', { textContent: `Chuyển khoản: ${[s.bankName, s.bankAccount, s.bankHolder].filter(Boolean).join(' · ')}` })] : []),
    ...(s.footerNote ? [el('p', { textContent: s.footerNote })] : []),
    el('div', { className: 'signs' }, el('div', {}, el('strong', { textContent: `Đại diện ${s.businessName}` })), el('div', {}, el('strong', { textContent: 'Khách hàng xác nhận' }))),
  );
}

(async () => {
  const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!me) { window.location.href = '/admin'; return; }
  const params = new URLSearchParams(window.location.search);
  const error = document.getElementById('pageError');
  try {
    const settings = await fetch('/api/quote-settings').then((r) => (r.ok ? r.json() : Promise.reject(new Error('Không tải được mẫu phiếu'))));
    let order;
    if (params.get('preview') === '1') order = sampleOrder();
    else {
      const id = params.get('orderId');
      if (!id) throw new Error('Thiếu mã đơn');
      const response = await fetch(`/api/service-orders/${encodeURIComponent(id)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Không tải được đơn');
      if (body.status === 'cancelled') throw new Error('Đơn đã huỷ, không in báo giá');
      order = body;
    }
    render(order, settings);
  } catch (e) { error.textContent = e.message; }
})();
document.getElementById('printBtn').addEventListener('click', () => window.print());
