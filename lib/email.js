export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sender đã xác thực trên Brevo (domain hienlegarden.vn, DKIM + DMARC). Nguồn duy nhất.
const EMAIL_SENDER = Object.freeze({
  name: 'Hiền Lê Garden',
  email: 'hello@hienlegarden.vn',
});

export async function sendPromoEmail(env, { to, toName, subject, html }) {
  // Fail-safe: không có API key (vd. staging chưa cấu hình) thì không gửi người nhận/nội dung ra ngoài.
  if (typeof env?.BREVO_API_KEY !== 'string' || env.BREVO_API_KEY === '') {
    console.error('Brevo send skipped: BREVO_API_KEY not configured');
    return false;
  }
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: EMAIL_SENDER.email, name: EMAIL_SENDER.name },
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
