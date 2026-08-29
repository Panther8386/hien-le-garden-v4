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
})();
