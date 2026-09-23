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
    document.getElementById('loginError').textContent = 'Sai tài khoản hoặc mật khẩu';
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
    errorEl.textContent = 'Mã xác thực không đúng';
    return;
  }

  const { role } = await response.json();
  goToLanding(role);
});
