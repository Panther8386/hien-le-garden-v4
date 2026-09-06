// v4/admin/finance.js
let currentRole = null;

let categoryMeta = {};

async function loadCategoryMeta() {
  try {
    const response = await fetch('/api/finance/categories');
    if (!response.ok) return;
    const rows = await response.json();
    categoryMeta = Object.fromEntries(rows.map((c) => [c.slug, { label: c.label, type: c.type, isActive: c.isActive }]));
  } catch (err) {
    // Leave categoryMeta empty on failure — category selects render empty rather
    // than throw, and categoryLabel() falls back to the raw slug for any row.
  }
}

function categoryLabel(slug) {
  return categoryMeta[slug] ? categoryMeta[slug].label : slug;
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
  const entries = Object.entries(categoryMeta).filter(([, meta]) => !type || meta.type === type);
  if (!type) {
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
  entries.filter(([, meta]) => meta.isActive).forEach(([slug, meta]) => {
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
    // localStorage unavailable — the toggle still updates the button state
    // below, it just won't persist across reloads.
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

function openFinanceFormOverlay() {
  document.getElementById('financeFormOverlay').classList.remove('hidden');
}

function closeFinanceFormOverlay() {
  document.getElementById('financeFormOverlay').classList.add('hidden');
}

document.getElementById('openAddTransactionBtn').addEventListener('click', () => {
  resetFinanceForm();
  openFinanceFormOverlay();
});

document.getElementById('financeFormCloseBtn').addEventListener('click', () => {
  document.getElementById('financeFormError').textContent = '';
  resetFinanceForm();
  closeFinanceFormOverlay();
});

let pendingVoidId = null;

function openVoidConfirm(t) {
  pendingVoidId = t.id;
  document.getElementById('financeVoidError').textContent = '';
  const typeLabel = t.type === 'income' ? 'Thu' : 'Chi';
  document.getElementById('financeVoidSummary').textContent = `${t.transactionDate} — ${typeLabel} · ${categoryLabel(t.category)} · ${formatVnd(t.amount)}`;
  document.getElementById('financeVoidOverlay').classList.remove('hidden');
}

function closeVoidConfirm() {
  pendingVoidId = null;
  document.getElementById('financeVoidOverlay').classList.add('hidden');
}

document.getElementById('financeVoidCancelBtn').addEventListener('click', closeVoidConfirm);

document.getElementById('financeVoidConfirmBtn').addEventListener('click', async () => {
  if (!pendingVoidId) return;
  const ok = await voidTransaction(pendingVoidId);
  if (ok) closeVoidConfirm();
});

let currentPage = 1;
let currentPageSize = 25;
let currentTotal = 0;
let currentCategoryTotals = {};
let currentChartRows = [];
let currentChartType = 'time';

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

  await loadCategoryMeta();

  setDefaultTypePreference(defaultTypePreference());
  populateCategorySelect(document.getElementById('filterCategory'), { includeAllOption: true });

  if (currentRole === 'manager' || currentRole === 'admin') {
    document.getElementById('openAddTransactionBtn').classList.remove('hidden');
    document.getElementById('openingBalanceEditor').classList.remove('hidden');
  }

  if (currentRole === 'admin') {
    document.getElementById('showHiddenTransactionsWrap').classList.remove('hidden');
  }
  document.getElementById('showHiddenTransactions').addEventListener('change', () => {
    currentPage = 1;
    loadTransactions();
  });

  resetFinanceForm();
  await loadTransactions();
  document.getElementById('financeMonthInput').value = currentMonthValue();
  await refreshFinanceSummary();
  await refreshStorageWarning();
})();

let currentTransactions = [];

function transactionRowHtml(t) {
  const typeLabel = t.type === 'income' ? 'Thu' : 'Chi';
  const statusClass = t.status === 'draft' ? 'status-draft' : t.status === 'confirmed' ? 'status-fin-confirmed' : 'status-paid';
  const canEdit = (currentRole === 'manager' || currentRole === 'admin') && !t.voidedAt;
  return { typeLabel, statusClass, canEdit };
}

async function toggleHideTransaction(t) {
  const errorEl = document.getElementById('listError');
  errorEl.textContent = '';
  const response = await fetch(`/api/finance/transactions/${t.id}/hide`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden: !t.isHidden }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi ẩn/hiện giao dịch';
    return;
  }
  await loadTransactions();
}

function buildActionButtons(t) {
  const { canEdit } = transactionRowHtml(t);
  const container = document.createDocumentFragment();
  if (canEdit) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'table-actions-btn';
    editBtn.title = 'Sửa';
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', () => openEditTransaction(t));
    const voidBtn = document.createElement('button');
    voidBtn.type = 'button';
    voidBtn.className = 'btn-secondary table-actions-btn';
    voidBtn.title = 'Huỷ';
    voidBtn.textContent = '🗑';
    voidBtn.addEventListener('click', () => openVoidConfirm(t));
    container.append(editBtn, voidBtn);
  }
  if (currentRole === 'admin' && t.voidedAt) {
    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'btn-secondary table-actions-btn';
    hideBtn.title = t.isHidden ? 'Hiện' : 'Ẩn';
    hideBtn.textContent = t.isHidden ? '👁️' : '🙈';
    hideBtn.addEventListener('click', () => toggleHideTransaction(t));
    container.appendChild(hideBtn);
  }
  return container;
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
    const { typeLabel, statusClass } = transactionRowHtml(t);

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
    const tdAttachment = document.createElement('td');
    if (t.receiptKey) {
      const link = document.createElement('a');
      link.href = `/api/finance/transactions/${t.id}/attachment`;
      link.target = '_blank';
      link.rel = 'noopener';
      const badge = document.createElement('span');
      badge.className = 'status-badge status-attachment';
      badge.textContent = '📎';
      link.appendChild(badge);
      tdAttachment.appendChild(link);
    }
    applyVoidedStyle(tdAttachment, t.voidedAt);
    const tdActions = document.createElement('td');
    tdActions.appendChild(buildActionButtons(t));
    tr.append(tdDate, tdType, tdCategory, tdAmount, tdStatus, tdNote, tdCreatedBy, tdAttachment, tdActions);
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
    if (t.receiptKey) {
      const pAttachment = document.createElement('p');
      const link = document.createElement('a');
      link.href = `/api/finance/transactions/${t.id}/attachment`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = '📎 Chứng từ';
      pAttachment.appendChild(link);
      card.appendChild(pAttachment);
    }
    const cardActions = document.createElement('div');
    cardActions.className = 'booking-actions';
    cardActions.appendChild(buildActionButtons(t));
    if (cardActions.childNodes.length > 0) card.appendChild(cardActions);
    cardList.appendChild(card);
  });
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

function renderFilteredStats(sumIncome) {
  const container = document.getElementById('financeFilteredStats');
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'stat-card';
  const value = document.createElement('div');
  value.className = 'stat-value';
  value.textContent = formatVnd(sumIncome);
  const label = document.createElement('div');
  label.className = 'stat-label';
  label.textContent = 'Tổng doanh thu (theo bộ lọc)';
  div.append(value, label);
  container.appendChild(div);
}

function renderPagination() {
  const info = document.getElementById('financePageInfo');
  const totalPages = Math.max(1, Math.ceil(currentTotal / currentPageSize));
  info.textContent = `Trang ${currentPage}/${totalPages} (${currentTotal} giao dịch)`;
  document.getElementById('financePrevPageBtn').disabled = currentPage <= 1;
  document.getElementById('financeNextPageBtn').disabled = currentPage >= totalPages;
}

document.getElementById('financePageSize').addEventListener('change', (event) => {
  currentPageSize = Number(event.target.value);
  currentPage = 1;
  loadTransactions();
});

document.getElementById('financePrevPageBtn').addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    loadTransactions();
  }
});

document.getElementById('financeNextPageBtn').addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(currentTotal / currentPageSize));
  if (currentPage < totalPages) {
    currentPage += 1;
    loadTransactions();
  }
});

async function loadTransactions(filters) {
  const listError = document.getElementById('listError');
  listError.textContent = '';
  const params = new URLSearchParams();
  Object.entries(filters || currentFilters()).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  params.set('page', String(currentPage));
  params.set('pageSize', String(currentPageSize));
  if (currentRole === 'admin' && document.getElementById('showHiddenTransactions').checked) {
    params.set('includeHidden', '1');
  }
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
  const body = await response.json();
  currentTotal = body.total;
  currentCategoryTotals = body.categoryTotals;
  currentChartRows = body.chartRows;
  renderTransactions(body.transactions);
  renderFilteredStats(body.sumIncome);
  renderPagination();
  renderChart();
}

async function voidTransaction(id) {
  const errorEl = document.getElementById('financeVoidError');
  errorEl.textContent = '';
  const response = await fetch(`/api/finance/transactions/${id}/void`, { method: 'PATCH' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi huỷ giao dịch';
    return false;
  }
  await loadTransactions();
  if (typeof refreshFinanceSummary === 'function') refreshFinanceSummary();
  return true;
}

function openEditTransaction(t) {
  const form = document.getElementById('financeForm');
  form.querySelector('[name="type"]').value = t.type;
  const select = form.querySelector('[name="category"]');
  const meta = categoryMeta[t.category];
  const isLegacyMismatch = !meta || meta.type !== t.type || !meta.isActive;
  populateCategorySelect(select, isLegacyMismatch ? {} : { type: t.type });
  form.querySelector('[name="category"]').value = t.category;
  form.querySelector('[name="amount"]').value = t.amount;
  form.querySelector('[name="transactionDate"]').value = t.transactionDate;
  form.querySelector('[name="note"]').value = t.note || '';
  form.querySelector('[name="status"]').value = t.status;
  form.dataset.editingId = t.id;
  document.querySelector('#financeForm button[type="submit"]').textContent = 'Lưu thay đổi';
  document.getElementById('financeFormTitle').textContent = 'Sửa giao dịch';
  renderAttachmentEditor(t);
  openFinanceFormOverlay();
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
  document.getElementById('financeFormTitle').textContent = 'Thêm giao dịch';
  renderAttachmentEditor(null);
}

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

  const body = await response.json();
  const transactionId = editingId || body.id;
  const fileInput = form.querySelector('[name="receipt"]');
  const file = fileInput.files[0];
  let attachmentFailed = false;
  if (file) {
    const uploadForm = new FormData();
    uploadForm.append('file', file);
    try {
      const uploadResponse = await fetch(`/api/finance/transactions/${transactionId}/attachment`, { method: 'POST', body: uploadForm });
      if (!uploadResponse.ok) {
        errorEl.textContent = 'Đã lưu giao dịch nhưng tải chứng từ lên thất bại — có thể thử lại bằng nút Sửa';
        attachmentFailed = true;
      }
    } catch (err) {
      errorEl.textContent = 'Đã lưu giao dịch nhưng tải chứng từ lên thất bại — có thể thử lại bằng nút Sửa';
      attachmentFailed = true;
    }
  }

  await loadTransactions();
  if (typeof refreshFinanceSummary === 'function') refreshFinanceSummary();
  if (attachmentFailed) {
    // Keep the popup open so the error stays visible and the user can retry
    // the attachment via "Sửa" — the transaction record itself already saved.
    return;
  }
  resetFinanceForm();
  closeFinanceFormOverlay();
});

document.querySelectorAll('#financeFilters input:not(#filterKeyword), #financeFilters select').forEach((el) => {
  el.addEventListener('change', () => {
    currentPage = 1;
    loadTransactions();
  });
});

let keywordDebounceTimer;
document.getElementById('filterKeyword').addEventListener('input', () => {
  clearTimeout(keywordDebounceTimer);
  keywordDebounceTimer = setTimeout(() => {
    currentPage = 1;
    loadTransactions();
  }, 350);
});

function currentMonthValue() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
}

function renderStatCards(summary) {
  const container = document.getElementById('financeStats');
  container.innerHTML = '';
  const sourceLabels = { manual: 'nhập tay', carried_forward: 'kế thừa kỳ trước', default_zero: 'mặc định' };
  const sourceLabel = sourceLabels[summary.openingBalanceSource];
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

async function refreshStorageWarning() {
  if (currentRole !== 'manager' && currentRole !== 'admin') return;
  const banner = document.getElementById('financeStorageWarning');
  let response;
  try {
    response = await fetch('/api/finance/receipts-usage');
  } catch (err) {
    return;
  }
  if (!response.ok) return;
  const { totalBytes, overThreshold } = await response.json();
  if (overThreshold) {
    const gb = (totalBytes / (1024 ** 3)).toFixed(1);
    banner.textContent = `⚠️ Dung lượng chứng từ đính kèm đã đạt ${gb}GB, vượt ngưỡng cảnh báo 9GB/tháng — cân nhắc xoá bớt file cũ hoặc nâng cấp gói lưu trữ R2.`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

document.getElementById('financeMonthInput').addEventListener('change', refreshFinanceSummary);

let currentGranularity = 'week';

function isoWeekMonday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
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

function buildBuckets(rows, granularity) {
  const map = new Map();
  rows
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

function renderTimeChart(granularity) {
  currentGranularity = granularity || currentGranularity;
  const container = document.getElementById('financeChart');
  const buckets = buildBuckets(currentChartRows, currentGranularity);

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

const CHART_COLORS = ['#C9A84C', '#ff8a8a', '#7fb8a4', '#8aa8ff', '#e0a458', '#c084fc', '#5ec8d8', '#f28fa3', '#9fca5a', '#d9906c', '#7f9fc9', '#e8c15a'];

function buildPieSlices(totals, key) {
  const entries = Object.entries(totals)
    .map(([slug, t]) => ({ slug, value: t[key] }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value);
  const sum = entries.reduce((s, e) => s + e.value, 0);
  return { entries, sum };
}

function renderPie(containerId, totals, key, titleText) {
  const container = document.getElementById(containerId);
  const { entries, sum } = buildPieSlices(totals, key);
  if (sum === 0) {
    container.innerHTML = `<h4 style="margin:8px 0 4px;">${titleText}</h4><p style="opacity:0.6;">Không có dữ liệu để vẽ biểu đồ.</p>`;
    return;
  }
  const cx = 90;
  const cy = 90;
  const r = 80;
  let angle = -90;
  let svg = `<svg viewBox="0 0 180 180" role="img" aria-label="Biểu đồ ${titleText} theo danh mục" style="width: 180px; height: 180px; flex-shrink: 0;">`;
  entries.forEach((e, i) => {
    const fraction = e.value / sum;
    const sweep = fraction * 360;
    const x1 = cx + r * Math.cos((Math.PI / 180) * angle);
    const y1 = cy + r * Math.sin((Math.PI / 180) * angle);
    const endAngle = angle + sweep;
    const x2 = cx + r * Math.cos((Math.PI / 180) * endAngle);
    const y2 = cy + r * Math.sin((Math.PI / 180) * endAngle);
    const largeArc = sweep > 180 ? 1 : 0;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    svg += `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}" />`;
    angle = endAngle;
  });
  svg += `</svg>`;

  const legend = entries.map((e, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const pct = ((e.value / sum) * 100).toFixed(1);
    return `<div style="display:flex;align-items:center;gap:6px;font-size:0.85rem;"><span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:2px;"></span>${categoryLabel(e.slug)} — ${pct}% (${formatVnd(e.value)})</div>`;
  }).join('');

  container.innerHTML = `<h4 style="margin:8px 0 4px;">${titleText}</h4><div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">${svg}<div style="display:flex;flex-direction:column;gap:4px;">${legend}</div></div>`;
}

function renderCategoryPies() {
  const container = document.getElementById('financeChart');
  container.innerHTML = '<div id="financePieIncome"></div><div id="financePieExpense"></div>';
  renderPie('financePieIncome', currentCategoryTotals, 'income', 'Thu');
  renderPie('financePieExpense', currentCategoryTotals, 'expense', 'Chi');
}

function renderChart() {
  if (currentChartType === 'category') {
    renderCategoryPies();
  } else {
    renderTimeChart(currentGranularity);
  }
}

document.querySelectorAll('#chartTypeToggle .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#chartTypeToggle .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentChartType = btn.dataset.chartType;
    document.getElementById('chartGranularity').classList.toggle('hidden', currentChartType !== 'time');
    renderChart();
  });
});

document.querySelectorAll('#chartGranularity .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#chartGranularity .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderTimeChart(btn.dataset.granularity);
  });
});
