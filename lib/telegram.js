export function escapeMarkdown(str) {
  return String(str).replace(/([_*`\[])/g, '\\$1');
}

export async function sendTelegramMessage(env, { chatId, text }) {
  // Fail-safe: không có token (vd. staging chưa cấu hình) thì không gửi nội dung ra ngoài.
  if (typeof env?.TELEGRAM_BOT_TOKEN !== 'string' || env.TELEGRAM_BOT_TOKEN === '') {
    console.error('Telegram send skipped: TELEGRAM_BOT_TOKEN not configured');
    return false;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (!response.ok) {
      console.error('Telegram send failed', response.status, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Telegram send threw', err);
    return false;
  }
}
