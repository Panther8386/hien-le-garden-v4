// admin/change-password.js
function mountChangePasswordWidget() {
  const container = document.createElement('div');
  container.innerHTML = `
    <form id="changePasswordForm">
      <label>Mật khẩu hiện tại <input type="password" name="currentPassword" required /></label>
      <label>Mật khẩu mới <input type="password" name="newPassword" minlength="8" required /></label>
      <label>Gõ lại mật khẩu mới <input type="password" name="confirmNewPassword" minlength="8" required /></label>
      <button type="submit">Đổi mật khẩu</button>
      <p id="changePasswordError" class="error"></p>
      <p id="changePasswordSuccess" class="error" style="color:#7FD99A;"></p>
    </form>
  `;
  document.querySelector('.page').appendChild(container);

  document.getElementById('changePasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const errorEl = document.getElementById('changePasswordError');
    const successEl = document.getElementById('changePasswordSuccess');
    errorEl.textContent = '';
    successEl.textContent = '';

    const newPassword = data.get('newPassword');
    if (newPassword !== data.get('confirmNewPassword')) {
      errorEl.textContent = 'Mật khẩu mới nhập lại không khớp';
      return;
    }

    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || 'Có lỗi khi đổi mật khẩu';
      return;
    }

    event.target.reset();
    successEl.textContent = 'Đổi mật khẩu thành công.';
  });
}

(async () => {
  let res;
  try {
    res = await fetch('/api/auth/me');
  } catch (err) {
    return;
  }
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
  mountChangePasswordWidget();
})();
