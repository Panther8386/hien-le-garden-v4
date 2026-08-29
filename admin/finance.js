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

document.querySelectorAll('#financeFilters input, #financeFilters select').forEach((el) => {
  el.addEventListener('change', () => loadTransactions());
});
