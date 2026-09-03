// v4/admin/finance.js
let currentRole = null;

const CATEGORY_META = {
  cay_giong: { label: 'Cây giống', type: 'expense' },
  vat_tu: { label: 'Vật tư', type: 'expense' },
  nhan_cong: { label: 'Nhân công', type: 'expense' },
  van_chuyen: { label: 'Vận chuyển', type: 'expense' },
  bao_tri: { label: 'Bảo trì', type: 'expense' },
  thuc_pham: { label: 'Thực phẩm', type: 'expense' },
  am_thuc_lien_ket: { label: 'Ẩm thực liên kết', type: 'expense' },
  khac: { label: 'Chi phí khác', type: 'expense' },
  ban_hang: { label: 'Bán hàng', type: 'income' },
  dich_vu: { label: 'Lưu trú Hiền Lê', type: 'income' },
  bep_hien_le: { label: 'Bếp Hiền Lê', type: 'income' },
  hien_le_drinks: { label: 'Hiền Lê Drinks', type: 'income' },
  hh_am_thuc_lien_ket: { label: 'HH Ẩm thực liên kết', type: 'income' },
};

function categoryLabel(slug) {
  return CATEGORY_META[slug] ? CATEGORY_META[slug].label : slug;
}

const STATUS_LABELS = { draft: 'Nháp', confirmed: 'Đã xác nhận', paid: 'Đã thanh toán' };

function formatVnd(amount) {
  return amount.toLocaleString('vi-VN') + 'đ';
}

function populateCategorySelect(select, { includeAllOption = false, type } = {}) {
  select.innerHTML = '';
  if (includeAllOption) {
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'Tất cả danh mục';
    select.appendChild(allOpt);
  }
  const entries = Object.entries(CATEGORY_META).filter(([, meta]) => !type || meta.type === type);
  if (!type) {
    // Filter bar's "all categories" case: group by type for readability.
    [['income', 'Thu'], ['expense', 'Chi']].forEach(([groupType, groupLabel]) => {
      const group = document.createElement('optgroup');
      group.label = groupLabel;
      entries.filter(([, meta]) => meta.type === groupType).forEach(([slug, meta]) => {
        const opt = document.createElement('option');
        opt.value = slug;
        opt.textContent = meta.label;
        group.appendChild(opt);
      });
      select.appendChild(group);
    });
    return;
  }
  entries.forEach(([slug, meta]) => {
    const opt = document.createElement('option');
    opt.value = slug;
    opt.textContent = meta.label;
    select.appendChild(opt);
  });
}

function renderAttachmentEditor(t) {
  const container = document.getElementById('financeAttachmentInfo');
  container.innerHTML = '';
  if (!t || !t.receiptKey) return;
  const link = document.createElement('a');
  link.href = `/api/finance/transactions/${t.id}/attachment`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = `📎 ${t.receiptFilename || 'Chứng từ hiện tại'}`;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-secondary';
  removeBtn.textContent = 'Gỡ chứng từ';
  removeBtn.addEventListener('click', async () => {
    const errorEl = document.getElementById('financeFormError');
    errorEl.textContent = '';
    const response = await fetch(`/api/finance/transactions/${t.id}/attachment`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || 'Có lỗi khi gỡ chứng từ';
      return;
    }
    container.innerHTML = '';
    await loadTransactions();
  });
  container.append(link, ' ', removeBtn);
}

function defaultTypePreference() {
  try {
    return localStorage.getItem('financeDefaultType') || 'expense';
  } catch (err) {
    return 'expense';
  }
}

function setDefaultTypePreference(type) {
  try {
    localStorage.setItem('financeDefaultType', type);
  } catch (err) {
    // localStorage unavailable (private browsing, blocked storage) — the toggle
    // still updates the button state below, it just won't persist across reloads.
  }
  document.querySelectorAll('#defaultTypeToggle .tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.defaultType === type);
  });
}

document.querySelectorAll('#defaultTypeToggle .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => setDefaultTypePreference(btn.dataset.defaultType));
});

document.querySelector('#financeForm select[name="type"]').addEventListener('change', (event) => {
  populateCategorySelect(document.querySelector('#financeForm select[name="category"]'), { type: event.target.value });
});

function showFinanceError(message) {
  document.getElementById('financeError').textContent = message || '';
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

  setDefaultTypePreference(defaultTypePreference());
  populateCategorySelect(document.getElementById('filterCategory'), { includeAllOption: true });

  if (currentRole === 'manager' || currentRole === 'admin') {
    document.getElementById('addTransactionSection').classList.remove('hidden');
    document.getElementById('openingBalanceEditor').classList.remove('hidden');
  }

  if (currentRole === 'observer') {
    // The server already refuses to return any expense row/field to this role — this
    // just keeps the filter UI from offering a choice that can only ever come back empty.
    const expenseOption = document.querySelector('#filterType option[value="expense"]');
    if (expenseOption) expenseOption.remove();
  }

  resetFinanceForm();
  await loadTransactions();
  document.getElementById('financeMonthInput').value = currentMonthValue();
  await refreshFinanceSummary();
})();

let currentTransactions = [];

function transactionRowHtml(t) {
  const typeLabel = t.type === 'income' ? 'Thu' : 'Chi';
  const statusClass = t.status === 'draft' ? 'status-draft' : t.status === 'confirmed' ? 'status-fin-confirmed' : 'status-paid';
  const canEdit = (currentRole === 'manager' || currentRole === 'admin') && !t.voidedAt;
  return { typeLabel, statusClass, canEdit };
}

function renderTransactions(list) {
  currentTransactions = list;
  const tbody = document.querySelector('#financeTable tbody');
  const cardList = document.getElementById('financeCardList');
  tbody.innerHTML = '';
  cardList.innerHTML = '';

  function applyVoidedStyle(el, voided) {
    if (voided) {
      el.style.textDecoration = 'line-through';
      el.style.opacity = '0.5';
    }
  }

  list.forEach((t) => {
    const { typeLabel, statusClass, canEdit } = transactionRowHtml(t);

    const tr = document.createElement('tr');
    const tdDate = document.createElement('td');
    tdDate.textContent = t.transactionDate;
    applyVoidedStyle(tdDate, t.voidedAt);
    const tdType = document.createElement('td');
    tdType.textContent = typeLabel;
    applyVoidedStyle(tdType, t.voidedAt);
    const tdCategory = document.createElement('td');
    tdCategory.textContent = categoryLabel(t.category);
    applyVoidedStyle(tdCategory, t.voidedAt);
    const tdAmount = document.createElement('td');
    tdAmount.textContent = formatVnd(t.amount);
    applyVoidedStyle(tdAmount, t.voidedAt);
    const tdStatus = document.createElement('td');
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge ${statusClass}`;
    statusBadge.textContent = STATUS_LABELS[t.status];
    applyVoidedStyle(statusBadge, t.voidedAt);
    tdStatus.appendChild(statusBadge);
    const tdNote = document.createElement('td');
    tdNote.textContent = t.note || '';
    applyVoidedStyle(tdNote, t.voidedAt);
    const tdCreatedBy = document.createElement('td');
    tdCreatedBy.textContent = t.createdBy;
    applyVoidedStyle(tdCreatedBy, t.voidedAt);
    const tdActions = document.createElement('td');
    tr.append(tdDate, tdType, tdCategory, tdAmount, tdStatus, tdNote, tdCreatedBy, tdActions);
    if (canEdit) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Sửa';
      editBtn.addEventListener('click', () => openEditTransaction(t));
      const voidBtn = document.createElement('button');
      voidBtn.type = 'button';
      voidBtn.className = 'btn-secondary';
      voidBtn.textContent = 'Huỷ';
      voidBtn.addEventListener('click', () => voidTransaction(t.id));
      tdActions.append(editBtn, voidBtn);
    }
    tbody.appendChild(tr);

    const card = document.createElement('div');
    card.className = 'booking-card';
    const pHeader = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = t.transactionDate;
    pHeader.append(strong, ` — ${typeLabel} · ${categoryLabel(t.category)}`);
    applyVoidedStyle(pHeader, t.voidedAt);
    const pAmount = document.createElement('p');
    const amountBadge = document.createElement('span');
    amountBadge.className = `status-badge ${statusClass}`;
    amountBadge.textContent = STATUS_LABELS[t.status];
    pAmount.append(`${formatVnd(t.amount)} `, amountBadge);
    applyVoidedStyle(pAmount, t.voidedAt);
    const pNote = document.createElement('p');
    pNote.textContent = t.note || '';
    applyVoidedStyle(pNote, t.voidedAt);
    const pCreatedBy = document.createElement('p');
    pCreatedBy.textContent = t.createdBy;
    pCreatedBy.style.opacity = '0.7';
    pCreatedBy.style.fontSize = '0.85rem';
    applyVoidedStyle(pCreatedBy, t.voidedAt);
    card.append(pHeader, pAmount, pNote, pCreatedBy);
    if (canEdit) {
      const cardActions = document.createElement('div');
      cardActions.className = 'booking-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Sửa';
      editBtn.addEventListener('click', () => openEditTransaction(t));
      const voidBtn = document.createElement('button');
      voidBtn.type = 'button';
      voidBtn.className = 'btn-secondary';
      voidBtn.textContent = 'Huỷ';
      voidBtn.addEventListener('click', () => voidTransaction(t.id));
      cardActions.append(editBtn, voidBtn);
      card.appendChild(cardActions);
    }
    cardList.appendChild(card);
  });
  renderChart(currentGranularity);
}

function currentFilters() {
  return {
    from: document.getElementById('filterFrom')?.value || '',
    to: document.getElementById('filterTo')?.value || '',
    type: document.getElementById('filterType')?.value || '',
    category: document.getElementById('filterCategory')?.value || '',
    status: document.getElementById('filterStatus')?.value || '',
    q: document.getElementById('filterKeyword')?.value || '',
  };
}

async function loadTransactions(filters) {
  const listError = document.getElementById('listError');
  listError.textContent = '';
  const params = new URLSearchParams();
  Object.entries(filters || currentFilters()).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  let response;
  try {
    response = await fetch(`/api/finance/transactions?${params.toString()}`);
  } catch (err) {
    listError.textContent = 'Có lỗi khi tải giao dịch';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải giao dịch';
    return;
  }
  renderTransactions(await response.json());
}

async function voidTransaction(id) {
  const listError = document.getElementById('listError');
  listError.textContent = '';
  const response = await fetch(`/api/finance/transactions/${id}/void`, { method: 'PATCH' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi huỷ giao dịch';
    return;
  }
  await loadTransactions();
  if (typeof refreshFinanceSummary === 'function') refreshFinanceSummary();
}

function openEditTransaction(t) {
  const form = document.getElementById('financeForm');
  form.querySelector('[name="type"]').value = t.type;
  populateCategorySelect(form.querySelector('[name="category"]'), { type: t.type });
  form.querySelector('[name="category"]').value = t.category;
  form.querySelector('[name="amount"]').value = t.amount;
  form.querySelector('[name="transactionDate"]').value = t.transactionDate;
  form.querySelector('[name="note"]').value = t.note || '';
  form.querySelector('[name="status"]').value = t.status;
  form.dataset.editingId = t.id;
  document.querySelector('#financeForm button[type="submit"]').textContent = 'Lưu thay đổi';
  document.getElementById('financeCancelEditBtn').classList.remove('hidden');
  renderAttachmentEditor(t);
}

function resetFinanceForm() {
  const form = document.getElementById('financeForm');
  form.reset();
  delete form.dataset.editingId;
  const defaultType = defaultTypePreference();
  form.querySelector('[name="type"]').value = defaultType;
  populateCategorySelect(form.querySelector('[name="category"]'), { type: defaultType });
  form.querySelector('[name="transactionDate"]').value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  document.querySelector('#financeForm button[type="submit"]').textContent = 'Ghi giao dịch';
  document.getElementById('financeCancelEditBtn').classList.add('hidden');
  renderAttachmentEditor(null);
}

document.getElementById('financeCancelEditBtn').addEventListener('click', () => {
  document.getElementById('financeFormError').textContent = '';
  resetFinanceForm();
});

document.getElementById('financeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const errorEl = document.getElementById('financeFormError');
  errorEl.textContent = '';

  const amount = Number(form.querySelector('[name="amount"]').value);
  if (!form.querySelector('[name="amount"]').value || !Number.isInteger(amount) || amount <= 0) {
    errorEl.textContent = 'Số tiền phải là số nguyên dương';
    return;
  }
  const transactionDate = form.querySelector('[name="transactionDate"]').value;
  if (!transactionDate) {
    errorEl.textContent = 'Vui lòng chọn ngày';
    return;
  }

  const payload = {
    type: form.querySelector('[name="type"]').value,
    category: form.querySelector('[name="category"]').value,
    amount,
    transactionDate,
    note: form.querySelector('[name="note"]').value,
    status: form.querySelector('[name="status"]').value,
  };

  const editingId = form.dataset.editingId;
  let response;
  try {
    response = await fetch(editingId ? `/api/finance/transactions/${editingId}` : '/api/finance/transactions', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi ghi giao dịch';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi ghi giao dịch';
    return;
  }

  resetFinanceForm();
  await loadTransactions();
  if (typeof refreshFinanceSummary === 'function') refreshFinanceSummary();
});

document.querySelectorAll('#financeFilters input:not(#filterKeyword), #financeFilters select').forEach((el) => {
  el.addEventListener('change', () => loadTransactions());
});

let keywordDebounceTimer;
document.getElementById('filterKeyword').addEventListener('input', () => {
  clearTimeout(keywordDebounceTimer);
  keywordDebounceTimer = setTimeout(() => loadTransactions(), 350);
});

function currentMonthValue() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
}

function renderStatCards(summary) {
  const container = document.getElementById('financeStats');
  container.innerHTML = '';
  const sourceLabels = { manual: 'nhập tay', carried_forward: 'kế thừa kỳ trước', default_zero: 'mặc định' };
  const sourceLabel = sourceLabels[summary.openingBalanceSource];
  // Card list is driven entirely by which fields the API actually returned, not by
  // currentRole — the observer role gets a summary response with only {month,
  // totalIncome} (every expense-derived field stripped server-side), so this
  // naturally renders just the one card with no role-specific branching needed here.
  const cards = [];
  if (summary.openingBalance !== undefined) {
    cards.push({ label: sourceLabel ? `Số dư đầu kỳ (${sourceLabel})` : 'Số dư đầu kỳ', value: formatVnd(summary.openingBalance) });
  }
  if (summary.totalIncome !== undefined) cards.push({ label: 'Tổng thu', value: formatVnd(summary.totalIncome) });
  if (summary.totalExpense !== undefined) cards.push({ label: 'Tổng chi', value: formatVnd(summary.totalExpense) });
  if (summary.netChange !== undefined) cards.push({ label: 'Lợi nhuận tạm tính', value: formatVnd(summary.netChange) });
  if (summary.closingBalance !== undefined) cards.push({ label: 'Số dư cuối kỳ', value: formatVnd(summary.closingBalance) });
  cards.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'stat-card';
    const value = document.createElement('div');
    value.className = 'stat-value';
    value.textContent = c.value;
    const label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = c.label;
    div.append(value, label);
    container.appendChild(div);
  });
}

function renderOpeningBalanceEditor(period, currentValue) {
  const container = document.getElementById('openingBalanceEditor');
  container.innerHTML = '';
  if (currentRole !== 'manager' && currentRole !== 'admin') return;

  const label = document.createElement('label');
  label.textContent = 'Sửa số dư đầu kỳ cho tháng này ';
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '1000';
  input.value = currentValue != null ? currentValue : '';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Lưu';
  const errorEl = document.createElement('p');
  errorEl.className = 'error';

  saveBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    const value = Number(input.value);
    if (input.value.trim() === '' || !Number.isInteger(value)) {
      errorEl.textContent = 'Số dư đầu kỳ phải là số nguyên';
      return;
    }
    const response = await fetch('/api/finance/opening-balance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period, openingBalance: value }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || 'Có lỗi khi lưu số dư đầu kỳ';
      return;
    }
    await refreshFinanceSummary();
  });

  label.appendChild(input);
  container.append(label, saveBtn, errorEl);
}

async function refreshFinanceSummary() {
  const monthInput = document.getElementById('financeMonthInput');
  const month = monthInput.value || currentMonthValue();
  monthInput.value = month;

  const errorEl = document.getElementById('financeError');
  errorEl.textContent = '';

  // Observer's GET /api/finance/opening-balance now 403s outright (that data is
  // expense-derived, off-limits to this role) — skip fetching it entirely rather
  // than treat the expected 403 as an error. renderOpeningBalanceEditor already
  // renders nothing for a non-manager/admin role, so passing null is harmless.
  const isPrivileged = currentRole === 'manager' || currentRole === 'admin';

  let summaryResponse, openingResponse;
  try {
    [summaryResponse, openingResponse] = await Promise.all([
      fetch(`/api/finance/summary?month=${month}`),
      isPrivileged ? fetch(`/api/finance/opening-balance?period=${month}`) : Promise.resolve(null),
    ]);
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải số liệu cân đối';
    return;
  }
  if (!summaryResponse.ok || (openingResponse && !openingResponse.ok)) {
    const failedResponse = !summaryResponse.ok ? summaryResponse : openingResponse;
    const body = await failedResponse.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải số liệu cân đối';
    return;
  }

  const summary = await summaryResponse.json();
  const opening = openingResponse ? await openingResponse.json() : { openingBalance: null };
  renderStatCards(summary);
  renderOpeningBalanceEditor(month, opening.openingBalance);
}

document.getElementById('financeMonthInput').addEventListener('change', refreshFinanceSummary);

let currentGranularity = 'week';

function isoWeekMonday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diffToMonday);
  return date.toISOString().slice(0, 10);
}

function bucketKey(dateStr, granularity) {
  if (granularity === 'day') return dateStr;
  if (granularity === 'month') return dateStr.slice(0, 7);
  return isoWeekMonday(dateStr);
}

function bucketLabel(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return `${m}/${y}`;
  }
  const [, m, d] = key.split('-');
  return `${d}/${m}`;
}

function buildBuckets(transactions, granularity) {
  const map = new Map();
  transactions
    .filter((t) => !t.voidedAt && (t.status === 'confirmed' || t.status === 'paid'))
    .forEach((t) => {
      const key = bucketKey(t.transactionDate, granularity);
      if (!map.has(key)) map.set(key, { key, income: 0, expense: 0 });
      const bucket = map.get(key);
      if (t.type === 'income') bucket.income += t.amount;
      else bucket.expense += t.amount;
    });
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function renderChart(granularity) {
  currentGranularity = granularity || currentGranularity;
  const container = document.getElementById('financeChart');
  const buckets = buildBuckets(currentTransactions, currentGranularity);

  if (buckets.length === 0) {
    container.innerHTML = '<p style="opacity: 0.6;">Không có dữ liệu để vẽ biểu đồ.</p>';
    return;
  }

  const width = Math.max(320, buckets.length * 70);
  const height = 220;
  const chartTop = 10;
  const chartBottom = 180;
  const chartHeight = chartBottom - chartTop;
  const maxValue = Math.max(1, ...buckets.map((b) => Math.max(b.income, b.expense)));
  const barGroupWidth = width / buckets.length;
  const barWidth = Math.min(24, barGroupWidth / 3);

  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ thu chi theo ${currentGranularity === 'day' ? 'ngày' : currentGranularity === 'week' ? 'tuần' : 'tháng'}" style="width: 100%; height: auto; max-width: 100%;">`;
  svg += `<line x1="0" y1="${chartBottom}" x2="${width}" y2="${chartBottom}" stroke="currentColor" stroke-opacity="0.3" />`;

  buckets.forEach((b, i) => {
    const groupCenter = i * barGroupWidth + barGroupWidth / 2;
    const incomeHeight = (b.income / maxValue) * chartHeight;
    const expenseHeight = (b.expense / maxValue) * chartHeight;

    svg += `<rect x="${groupCenter - barWidth - 2}" y="${chartBottom - incomeHeight}" width="${barWidth}" height="${incomeHeight}" fill="#C9A84C" />`;
    svg += `<rect x="${groupCenter + 2}" y="${chartBottom - expenseHeight}" width="${barWidth}" height="${expenseHeight}" fill="#ff8a8a" />`;
    svg += `<text x="${groupCenter}" y="${chartBottom + 16}" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity="0.8">${bucketLabel(b.key, currentGranularity)}</text>`;
  });

  svg += `</svg>`;
  container.innerHTML = `<div class="table-scroll">${svg}</div><p style="font-size: 0.85rem; opacity: 0.7;"><span style="color: #C9A84C;">■</span> Thu &nbsp; <span style="color: #ff8a8a;">■</span> Chi</p>`;
}

document.querySelectorAll('#chartGranularity .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#chartGranularity .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderChart(btn.dataset.granularity);
  });
});
