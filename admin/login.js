// crm/public/admin/login.js
const landing = { admin: '/manager', manager: '/manager', reception: '/reception', observer: '/observer' };
let pendingToken = null;

function goToLanding(role) {
  window.location.href = landing[role] || '/reception';
}

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: data.get('username'), password: data.get('password') }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    document.getElementById('loginError').textContent = body.error || 'Không thể đăng nhập. Vui lòng thử lại.';
    return;
  }

  const body = await response.json();
  if (body.requires2fa) {
    pendingToken = body.pendingToken;
    document.getElementById('loginForm').hidden = true;
    document.getElementById('twoFactorForm').hidden = false;
    document.querySelector('#twoFactorForm input[name="code"]').focus();
    return;
  }

  goToLanding(body.role);
});

document.getElementById('twoFactorForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const errorEl = document.getElementById('twoFactorError');
  errorEl.textContent = '';

  const response = await fetch('/api/auth/verify-2fa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pendingToken, code: data.get('code') }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && body.pendingToken) {
      // Token dùng một lần: server cấp token mới cho lần thử tiếp theo.
      pendingToken = body.pendingToken;
      errorEl.textContent = `Mã xác thực không đúng. Còn ${body.attemptsLeft} lần thử.`;
      event.target.reset();
      return;
    }
    if (response.status === 401) {
      // Hết hạn hoặc quá số lần thử: quay lại bước nhập mật khẩu.
      pendingToken = null;
      event.target.reset();
      document.getElementById('twoFactorForm').hidden = true;
      document.getElementById('loginForm').hidden = false;
      document.getElementById('loginError').textContent = body.error || 'Phiên xác thực đã hết hạn, vui lòng đăng nhập lại';
      return;
    }
    errorEl.textContent = body.error || 'Mã xác thực không đúng';
    return;
  }

  const { role } = await response.json();
  goToLanding(role);
});
