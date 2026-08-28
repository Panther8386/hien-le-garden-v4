// v4/admin/cancellation-policy.js
let currentRole = null;

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
  const { role } = await res.json();
  currentRole = role;
  if (currentRole === 'admin') {
    document.getElementById('addTierBtn').classList.remove('hidden');
  }
  await loadTiers();
})();

async function loadTiers() {
  const listError = document.getElementById('listError');
  listError.textContent = '';
  const response = await fetch('/api/cancellation-policy');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải chính sách hoàn cọc';
    return;
  }
  const tiers = await response.json();
  renderTable(tiers);
}

function renderTable(tiers) {
  const tbody = document.querySelector('#tierTable tbody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').classList.toggle('hidden', tiers.length > 0);

  tiers.forEach((tier) => {
    const tr = document.createElement('tr');

    const tdDays = document.createElement('td');
    tdDays.textContent = `≥ ${tier.minDaysBeforeCheckin} ngày`;

    const tdPercent = document.createElement('td');
    tdPercent.textContent = `${tier.refundPercent}%`;

    const tdLabel = document.createElement('td');
    tdLabel.textContent = tier.label || '';

    const tdActions = document.createElement('td');
    if (currentRole === 'admin') {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Sửa';
      editBtn.addEventListener('click', () => openEditForm(tier));
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Xoá';
      deleteBtn.addEventListener('click', () => deleteTier(tier.id));
      tdActions.append(editBtn, deleteBtn);
    }

    tr.append(tdDays, tdPercent, tdLabel, tdActions);
    tbody.appendChild(tr);
  });
}

function resetForm() {
  const form = document.getElementById('tierForm');
  form.reset();
  form.querySelector('input[name="id"]').value = '';
  document.getElementById('tierSubmitBtn').textContent = 'Thêm bậc';
}

document.getElementById('addTierBtn').addEventListener('click', () => {
  resetForm();
  document.getElementById('tierForm').classList.remove('hidden');
});

document.getElementById('tierCancelBtn').addEventListener('click', () => {
  document.getElementById('tierForm').classList.add('hidden');
});

function openEditForm(tier) {
  const form = document.getElementById('tierForm');
  form.classList.remove('hidden');
  form.querySelector('input[name="id"]').value = tier.id;
  form.querySelector('input[name="minDaysBeforeCheckin"]').value = tier.minDaysBeforeCheckin;
  form.querySelector('input[name="refundPercent"]').value = tier.refundPercent;
  form.querySelector('input[name="label"]').value = tier.label || '';
  document.getElementById('tierSubmitBtn').textContent = 'Lưu thay đổi';
}

async function deleteTier(id) {
  const listError = document.getElementById('listError');
  const response = await fetch(`/api/cancellation-policy/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi xoá bậc chính sách';
    return;
  }
  await loadTiers();
}

document.getElementById('tierForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const errorEl = document.getElementById('formError');
  errorEl.textContent = '';

  const id = data.get('id');
  const payload = {
    minDaysBeforeCheckin: Number(data.get('minDaysBeforeCheckin')),
    refundPercent: Number(data.get('refundPercent')),
    label: data.get('label') || null,
  };

  const response = await fetch(id ? `/api/cancellation-policy/${id}` : '/api/cancellation-policy', {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu bậc chính sách';
    return;
  }

  form.classList.add('hidden');
  await loadTiers();
});
