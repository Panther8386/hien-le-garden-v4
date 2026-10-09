// admin/change-password.js
function mountChangePasswordWidget() {
  const container = document.createElement('div');
  container.innerHTML = `
    <form id="changePasswordForm">
      <label>Mật khẩu hiện tại <input type="password" name="currentPassword" maxlength="256" autocomplete="current-password" required /></label>
      <label>Mật khẩu mới <input type="password" name="newPassword" minlength="8" maxlength="256" autocomplete="new-password" required /></label>
      <label>Gõ lại mật khẩu mới <input type="password" name="confirmNewPassword" minlength="8" maxlength="256" autocomplete="new-password" required /></label>
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
    const submit = event.target.querySelector('button[type=submit]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
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
    event.target.querySelectorAll('input').forEach(input => { input.disabled = true; });
    successEl.textContent = 'Đã đổi mật khẩu và đăng xuất mọi phiên. ';
    const login = document.createElement('a');
    login.href = '/admin';
    login.textContent = 'Đăng nhập lại';
    successEl.appendChild(login);
    } catch {
      errorEl.textContent = 'Không nhận được phản hồi. Vui lòng đăng nhập lại để kiểm tra trước khi thử lại.';
    } finally {
      submit.disabled = !!event.target.querySelector('input:disabled');
    }
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
