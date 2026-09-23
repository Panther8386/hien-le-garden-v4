// admin/security.js
function renderDisabledState(container) {
  container.innerHTML = `
    <p>Google Authenticator đang <strong>tắt</strong> cho tài khoản của bạn.</p>
    <button type="button" id="startSetupBtn">Bật Google Authenticator</button>
    <p id="securityError" class="error"></p>
  `;
  document.getElementById('startSetupBtn').addEventListener('click', () => startSetup(container));
}

function renderEnabledState(container) {
  container.innerHTML = `
    <p>Google Authenticator đang <strong>bật</strong> cho tài khoản của bạn.</p>
    <form id="disableForm">
      <label>Nhập mật khẩu để tắt <input type="password" name="password" required autocomplete="current-password" /></label>
      <button type="submit">Tắt Google Authenticator</button>
      <p id="securityError" class="error"></p>
    </form>
  `;
  document.getElementById('disableForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const errorEl = document.getElementById('securityError');
    errorEl.textContent = '';

    const response = await fetch('/api/auth/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: data.get('password') }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || 'Có lỗi khi tắt Google Authenticator';
      return;
    }

    renderDisabledState(container);
  });
}

async function startSetup(container) {
  const errorEl = document.getElementById('securityError');
  errorEl.textContent = '';

  const response = await fetch('/api/auth/2fa/setup', { method: 'POST' });
  if (!response.ok) {
    errorEl.textContent = 'Có lỗi khi tạo mã bảo mật';
    return;
  }
  const { secret, otpauthUrl } = await response.json();

  container.innerHTML = `
    <p>1. Mở app <strong>Google Authenticator</strong> trên điện thoại, quét mã QR bên dưới (hoặc nhập tay mã).</p>
    <div id="setupQrCode"></div>
    <p>Mã nhập tay: <code id="manualSecret">${secret}</code></p>
    <p>2. Nhập mã 6 số hiện đang hiển thị trong app để xác nhận:</p>
    <form id="confirmForm">
      <label>Mã xác thực <input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required /></label>
      <button type="submit">Xác nhận</button>
      <p id="securityError" class="error"></p>
    </form>
  `;
  // eslint-disable-next-line no-undef
  new QRCode(document.getElementById('setupQrCode'), { text: otpauthUrl, width: 180, height: 180 });

  document.getElementById('confirmForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const confirmErrorEl = document.getElementById('securityError');
    confirmErrorEl.textContent = '';

    const confirmResponse = await fetch('/api/auth/2fa/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: data.get('code') }),
    });

    if (!confirmResponse.ok) {
      const body = await confirmResponse.json().catch(() => ({}));
      confirmErrorEl.textContent = body.error || 'Mã xác thực không đúng';
      return;
    }

    renderEnabledState(container);
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
  const { totpEnabled } = await res.json();

  const container = document.createElement('div');
  document.querySelector('.page').appendChild(container);
  if (totpEnabled) {
    renderEnabledState(container);
  } else {
    renderDisabledState(container);
  }
})();
