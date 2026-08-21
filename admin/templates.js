// admin/templates.js
const channelSelect = document.getElementById('channelSelect');
const subjectLabel = document.getElementById('subjectLabel');

function updateSubjectVisibility() {
  subjectLabel.classList.toggle('hidden', channelSelect.value !== 'email');
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
  document.getElementById('cancelEditBtn').classList.remove('hidden');
}

function exitEditMode() {
  editingId = null;
  templateForm.reset();
  updateSubjectVisibility();
  submitButton.textContent = 'Lưu template';
  document.getElementById('cancelEditBtn').classList.add('hidden');
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
    card.className = 'table-scroll template-card';

    const headerPara = document.createElement('p');
    const nameStrong = document.createElement('strong');
    nameStrong.textContent = t.name;
    headerPara.appendChild(nameStrong);
    headerPara.appendChild(document.createTextNode(' — '));
    const channelSpan = document.createElement('span');
    channelSpan.textContent = t.channel;
    headerPara.appendChild(channelSpan);
    headerPara.appendChild(document.createTextNode(' — '));
    const statusSpan = document.createElement('span');
    statusSpan.textContent = t.isActive ? '🟢 Active' : '⚪ Không active';
    headerPara.appendChild(statusSpan);
    card.appendChild(headerPara);

    const bodyPara = document.createElement('p');
    bodyPara.className = 'template-body';
    bodyPara.textContent = t.body;
    card.appendChild(bodyPara);

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Sửa';
    editBtn.dataset.action = 'edit';
    editBtn.dataset.id = t.id;
    card.appendChild(editBtn);

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = t.isActive ? 'Tắt active' : 'Đặt làm active';
    toggleBtn.dataset.action = 'toggle';
    toggleBtn.dataset.id = t.id;
    toggleBtn.dataset.active = t.isActive;
    card.appendChild(toggleBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Xoá';
    deleteBtn.dataset.action = 'delete';
    deleteBtn.dataset.id = t.id;
    if (t.isActive) {
      deleteBtn.disabled = true;
      deleteBtn.title = 'Không thể xoá template đang active';
    }
    card.appendChild(deleteBtn);

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
  const listError = document.getElementById('listError');

  if (action === 'edit') {
    const template = templatesCache.find((t) => String(t.id) === id);
    if (template) enterEditMode(template);
  }

  if (action === 'toggle') {
    const endpoint = active === 'true' ? `/api/templates/${id}/deactivate` : `/api/templates/${id}/activate`;
    const response = await fetch(endpoint, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      listError.textContent = body.error || 'Có lỗi khi cập nhật template';
      return;
    }
    await loadTemplates();
  }

  if (action === 'delete') {
    const response = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      listError.textContent = body.error || 'Có lỗi khi xoá template';
      return;
    }
    await loadTemplates();
  }
});

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = 'login.html';
    return;
  }
  loadTemplates();
})();
