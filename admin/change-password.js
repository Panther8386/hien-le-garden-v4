// admin/change-password.js
function mountChangePasswordWidget() {
  const container = document.createElement('div');
  container.innerHTML = `
    <h2>Đổi mật khẩu</h2>
    <form id="changePasswordForm">
      <label>Mật khẩu hiện tại <input type="password" name="currentPassword" required /></label>
      <label>Mật khẩu mới <input type="password" name="newPassword" minlength="8" required /></label>
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

    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }),
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

mountChangePasswordWidget();
