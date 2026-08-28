// admin/users.js
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
  const { username: currentUsername, role: currentRole } = await res.json();
  window.__currentUsername = currentUsername;
  window.__currentRole = currentRole;
  loadUsers();
})();

const ROLE_LABELS = { manager: 'Quản lý', reception: 'Lễ tân', admin: 'Quản trị', observer: 'Người quan sát' };

async function loadUsers() {
  const response = await fetch('/api/users');
  const listError = document.getElementById('listError');
  listError.textContent = '';

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải danh sách user';
    return;
  }

  const users = await response.json();
  const managerCount = users.filter((u) => u.role === 'manager').length;
  const tbody = document.querySelector('#userTable tbody');
  tbody.innerHTML = '';

  users.forEach((u) => {
    const isSelf = u.username === window.__currentUsername;
    const isLastManager = u.role === 'manager' && managerCount <= 1;
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = u.username;

    const tdRole = document.createElement('td');
    const roleSelect = document.createElement('select');
    Object.keys(ROLE_LABELS).forEach((role) => {
      const opt = document.createElement('option');
      opt.value = role;
      opt.textContent = ROLE_LABELS[role];
      opt.selected = role === u.role;
      roleSelect.appendChild(opt);
    });
    roleSelect.disabled = isLastManager;
    roleSelect.addEventListener('change', async () => {
      const response = await fetch(`/api/users/${u.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleSelect.value }),
      });
      const listError = document.getElementById('listError');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        listError.textContent = body.error || 'Có lỗi khi cập nhật vai trò';
        return;
      }
      await loadUsers();
    });
    tdRole.appendChild(roleSelect);

    const tdLayout = document.createElement('td');
    const layoutCheckbox = document.createElement('input');
    layoutCheckbox.type = 'checkbox';
    layoutCheckbox.checked = !!u.canManageRoomLayout;
    layoutCheckbox.title = 'Quản trị bố cục phòng';
    layoutCheckbox.addEventListener('change', async () => {
      const response = await fetch(`/api/users/${u.id}/room-layout-access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canManageRoomLayout: layoutCheckbox.checked }),
      });
      const listError = document.getElementById('listError');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        listError.textContent = body.error || 'Có lỗi khi cập nhật quyền bố cục phòng';
        layoutCheckbox.checked = !layoutCheckbox.checked;
        return;
      }
      listError.textContent = '';
    });
    tdLayout.appendChild(layoutCheckbox);

    const tdCreated = document.createElement('td');
    tdCreated.textContent = new Date(u.createdAt).toLocaleDateString('vi-VN');

    const tdActions = document.createElement('td');

    if (window.__currentRole === 'admin') {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'btn-secondary';
      resetBtn.textContent = 'Đặt lại mật khẩu';
      resetBtn.disabled = isSelf;
      if (isSelf) resetBtn.title = 'Không thể tự đặt lại mật khẩu bằng chức năng này — dùng trang Đổi mật khẩu';
      resetBtn.addEventListener('click', () => openResetPasswordRow(u.id, tr));
      tdActions.appendChild(resetBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Xoá';
    deleteBtn.disabled = isSelf || isLastManager;
    if (isSelf) deleteBtn.title = 'Không thể tự xoá tài khoản của chính mình';
    if (isLastManager) deleteBtn.title = 'Không thể xoá manager cuối cùng';
    deleteBtn.addEventListener('click', async () => {
      const response = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
      const listError = document.getElementById('listError');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        listError.textContent = body.error || 'Có lỗi khi xoá tài khoản';
        return;
      }
      await loadUsers();
    });
    tdActions.appendChild(deleteBtn);

    tr.append(tdName, tdRole, tdLayout, tdCreated, tdActions);
    tbody.appendChild(tr);
  });
}

function openResetPasswordRow(userId, afterRow) {
  document.querySelectorAll('.reset-password-row').forEach((el) => el.remove());

  const tr = document.createElement('tr');
  tr.className = 'reset-password-row';
  const td = document.createElement('td');
  td.colSpan = 5;

  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = 'Mật khẩu mới (tối thiểu 8 ký tự)';
  input.minLength = 8;
  input.style.display = 'inline-block';
  input.style.width = 'auto';
  input.style.marginRight = '8px';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.textContent = 'Xác nhận';
  confirmBtn.style.width = 'auto';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Huỷ';
  cancelBtn.style.width = 'auto';

  const errorEl = document.createElement('p');
  errorEl.className = 'error';

  confirmBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    const response = await fetch(`/api/users/${userId}/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || 'Có lỗi khi đặt lại mật khẩu';
      return;
    }
    tr.remove();
  });
  cancelBtn.addEventListener('click', () => tr.remove());

  td.append(input, confirmBtn, cancelBtn, errorEl);
  tr.appendChild(td);
  afterRow.after(tr);
}

document.getElementById('userForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const errorEl = document.getElementById('formError');
  errorEl.textContent = '';

  const response = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: data.get('username'), password: data.get('password'), role: data.get('role') }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tạo tài khoản';
    return;
  }

  event.target.reset();
  await loadUsers();
});
