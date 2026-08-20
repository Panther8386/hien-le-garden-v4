// admin/templates.js
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = 'login.html';
  }
})();

const channelSelect = document.getElementById('channelSelect');
const subjectLabel = document.getElementById('subjectLabel');

function updateSubjectVisibility() {
  subjectLabel.hidden = channelSelect.value !== 'email';
}
channelSelect.addEventListener('change', updateSubjectVisibility);
updateSubjectVisibility();

let templatesCache = [];
let editingId = null;

const templateForm = document.getElementById('templateForm');
const submitButton = templateForm.querySelector('button[type="submit"]');

function enterEditMode(template) {
  editingId = template.id;
  templateForm.name.value = template.name;
  templateForm.channel.value = template.channel;
  templateForm.subject.value = template.subject || '';
  templateForm.body.value = template.body;
  updateSubjectVisibility();
  submitButton.textContent = 'Cập nhật template';
  document.getElementById('cancelEditBtn').hidden = false;
}

function exitEditMode() {
  editingId = null;
  templateForm.reset();
  updateSubjectVisibility();
  submitButton.textContent = 'Lưu template';
  document.getElementById('cancelEditBtn').hidden = true;
}

document.getElementById('cancelEditBtn').addEventListener('click', exitEditMode);

async function loadTemplates() {
  const response = await fetch('/api/templates');
  const listError = document.getElementById('listError');
  listError.textContent = '';

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải danh sách template';
    return;
  }

  templatesCache = await response.json();
  const container = document.getElementById('templateList');
  container.innerHTML = '';

  templatesCache.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'table-scroll';
    card.style.marginBottom = '16px';
    card.innerHTML = `
      <p><strong>${t.name}</strong> — ${t.channel} — ${t.isActive ? '🟢 Active' : '⚪ Không active'}</p>
      <p style="font-size:0.85rem; opacity:0.8; white-space:pre-wrap;"></p>
      <button data-action="edit" data-id="${t.id}">Sửa</button>
      <button data-action="toggle" data-id="${t.id}" data-active="${t.isActive}">${t.isActive ? 'Tắt active' : 'Đặt làm active'}</button>
      <button data-action="delete" data-id="${t.id}" ${t.isActive ? 'disabled title="Không thể xoá template đang active"' : ''}>Xoá</button>
    `;
    card.querySelector('p:nth-of-type(2)').textContent = t.body;
    container.appendChild(card);
  });
}

templateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const errorEl = document.getElementById('formError');
  errorEl.textContent = '';

  const payload = {
    name: data.get('name'),
    channel: data.get('channel'),
    subject: data.get('subject'),
    body: data.get('body'),
  };

  const response = editingId
    ? await fetch(`/api/templates/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    : await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu template';
    return;
  }

  exitEditMode();
  await loadTemplates();
});

document.getElementById('templateList').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id, active } = button.dataset;

  if (action === 'edit') {
    const template = templatesCache.find((t) => String(t.id) === id);
    if (template) enterEditMode(template);
  }

  if (action === 'toggle') {
    const endpoint = active === 'true' ? `/api/templates/${id}/deactivate` : `/api/templates/${id}/activate`;
    await fetch(endpoint, { method: 'POST' });
    await loadTemplates();
  }

  if (action === 'delete') {
    await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    await loadTemplates();
  }
});

loadTemplates();
