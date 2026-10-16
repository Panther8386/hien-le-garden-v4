// v4/admin/quote-settings.js — edit the quote template (settings.quote_template).
const TEXT_FIELDS = ['businessName', 'address', 'hotline', 'email', 'website', 'taxNote', 'cancellationTerms', 'footerNote', 'bankName', 'bankAccount', 'bankHolder'];
const NUMBER_FIELDS = ['defaultValidDays', 'defaultDepositPercent'];
let currentPermissions = [];

async function loadSettings() {
  const response = await fetch('/api/quote-settings');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Không tải được mẫu phiếu');
  const form = document.getElementById('quoteSettingsForm');
  [...TEXT_FIELDS, ...NUMBER_FIELDS].forEach((name) => { form[name].value = body[name] ?? ''; });
  document.getElementById('quoteUpdated').textContent = body.updatedAt ? `Cập nhật lần cuối: ${new Date(body.updatedAt).toLocaleString('vi-VN')} · ${body.updatedBy}` : '';
}

(async () => {
  const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!me) { window.location.href = '/admin'; return; }
  currentPermissions = me.permissions || [];
  const canEdit = currentPermissions.includes('settings.quote_template');
  const form = document.getElementById('quoteSettingsForm');
  [...form.elements].forEach((e) => { e.disabled = !canEdit; });
  document.getElementById('quoteSaveBtn').hidden = !canEdit;
  try { await loadSettings(); } catch (e) { document.getElementById('pageError').textContent = e.message; }
})();

document.getElementById('quoteSettingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const error = document.getElementById('quoteSettingsError');
  error.textContent = '';
  const status = document.getElementById('quoteSettingsStatus');
  status.textContent = '';
  const payload = {};
  TEXT_FIELDS.forEach((name) => { payload[name] = form[name].value; });
  NUMBER_FIELDS.forEach((name) => { payload[name] = Number(form[name].value); });
  const button = document.getElementById('quoteSaveBtn');
  button.disabled = true;
  try {
    const response = await fetch('/api/quote-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Không lưu được mẫu phiếu');
    await loadSettings();
    status.textContent = 'Đã lưu.';
  } catch (e) { error.textContent = e.message; } finally { button.disabled = false; }
});
