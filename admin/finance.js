// v4/admin/finance.js
let currentRole = null;

const CATEGORY_LABELS = {
  cay_giong: 'Cây giống',
  vat_tu: 'Vật tư',
  nhan_cong: 'Nhân công',
  van_chuyen: 'Vận chuyển',
  bao_tri: 'Bảo trì',
  ban_hang: 'Bán hàng',
  dich_vu: 'Dịch vụ',
  khac: 'Chi phí khác',
};

const STATUS_LABELS = { draft: 'Nháp', confirmed: 'Đã xác nhận', paid: 'Đã thanh toán' };

function formatVnd(amount) {
  return amount.toLocaleString('vi-VN') + 'đ';
}

function populateCategorySelect(select, includeAllOption) {
  select.innerHTML = '';
  if (includeAllOption) {
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'Tất cả danh mục';
    select.appendChild(allOpt);
  }
  Object.entries(CATEGORY_LABELS).forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });
}

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

  populateCategorySelect(document.querySelector('#financeForm select[name="category"]'), false);
  populateCategorySelect(document.getElementById('filterCategory'), true);

  if (currentRole === 'manager' || currentRole === 'admin') {
    document.getElementById('addTransactionSection').classList.remove('hidden');
    document.getElementById('openingBalanceEditor').classList.remove('hidden');
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
  const voidedStyle = t.voidedAt ? ' style="text-decoration: line-through; opacity: 0.5;"' : '';
  const canEdit = (currentRole === 'manager' || currentRole === 'admin') && !t.voidedAt;
  return { typeLabel, statusClass, voidedStyle, canEdit };
}

function renderTransactions(list) {
  currentTransactions = list;
  const tbody = document.querySelector('#financeTable tbody');
  const cardList = document.getElementById('financeCardList');
  tbody.innerHTML = '';
  cardList.innerHTML = '';

  list.forEach((t) => {
    const { typeLabel, statusClass, voidedStyle, canEdit } = transactionRowHtml(t);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td${voidedStyle}>${t.transactionDate}</td>
      <td${voidedStyle}>${typeLabel}</td>
      <td${voidedStyle}>${CATEGORY_LABELS[t.category] || t.category}</td>
      <td${voidedStyle}>${formatVnd(t.amount)}</td>
      <td><span class="status-badge ${statusClass}">${STATUS_LABELS[t.status]}</span></td>
      <td${voidedStyle}>${t.note || ''}</td>
      <td${voidedStyle}>${t.createdBy}</td>
      <td></td>
    `;
    if (canEdit) {
      const actionsCell = tr.lastElementChild;
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Sửa';
      editBtn.addEventListener('click', () => openEditTransaction(t));
      const voidBtn = document.createElement('button');
      voidBtn.type = 'button';
      voidBtn.className = 'btn-secondary';
      voidBtn.textContent = 'Huỷ';
      voidBtn.addEventListener('click', () => voidTransaction(t.id));
      actionsCell.append(editBtn, voidBtn);
    }
    tbody.appendChild(tr);

    const card = document.createElement('div');
    card.className = 'booking-card';
    card.innerHTML = `
      <p${voidedStyle}><strong>${t.transactionDate}</strong> — ${typeLabel} · ${CATEGORY_LABELS[t.category] || t.category}</p>
      <p${voidedStyle}>${formatVnd(t.amount)} <span class="status-badge ${statusClass}">${STATUS_LABELS[t.status]}</span></p>
      <p${voidedStyle}>${t.note || ''}</p>
      <p${voidedStyle} style="opacity: 0.7; font-size: 0.85rem;">${t.createdBy}</p>
    `;
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
  form.querySelector('[name="category"]').value = t.category;
  form.querySelector('[name="amount"]').value = t.amount;
  form.querySelector('[name="transactionDate"]').value = t.transactionDate;
  form.querySelector('[name="note"]').value = t.note || '';
  form.querySelector('[name="status"]').value = t.status;
  form.dataset.editingId = t.id;
  document.querySelector('#financeForm button[type="submit"]').textContent = 'Lưu thay đổi';
  document.getElementById('financeCancelEditBtn').classList.remove('hidden');
}

function resetFinanceForm() {
  const form = document.getElementById('financeForm');
  form.reset();
  delete form.dataset.editingId;
  form.querySelector('[name="transactionDate"]').value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  document.querySelector('#financeForm button[type="submit"]').textContent = 'Ghi giao dịch';
  document.getElementById('financeCancelEditBtn').classList.add('hidden');
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
    note: form.querySelector('[name="note"]').value || undefined,
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
  const cards = [
    { label: 'Số dư đầu kỳ', value: formatVnd(summary.openingBalance) },
    { label: 'Tổng thu', value: formatVnd(summary.totalIncome) },
    { label: 'Tổng chi', value: formatVnd(summary.totalExpense) },
    { label: 'Lợi nhuận tạm tính', value: formatVnd(summary.netChange) },
    { label: 'Số dư cuối kỳ', value: formatVnd(summary.closingBalance) },
  ];
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

  let summaryResponse, openingResponse;
  try {
    [summaryResponse, openingResponse] = await Promise.all([
      fetch(`/api/finance/summary?month=${month}`),
      fetch(`/api/finance/opening-balance?period=${month}`),
    ]);
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải số liệu cân đối';
    return;
  }
  if (!summaryResponse.ok || !openingResponse.ok) {
    const failedResponse = !summaryResponse.ok ? summaryResponse : openingResponse;
    const body = await failedResponse.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải số liệu cân đối';
    return;
  }

  const summary = await summaryResponse.json();
  const opening = await openingResponse.json();
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
