export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendPromoEmail(env, { to, toName, subject, html }) {
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: 'khuyenmai@hienlegarden.vn', name: 'Hiền Lê Garden' },
        to: [{ email: to, name: toName }],
        subject,
        htmlContent: html,
      }),
    });
    if (!response.ok) {
      console.error('Brevo send failed', response.status, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Brevo send threw', err);
    return false;
  }
}
