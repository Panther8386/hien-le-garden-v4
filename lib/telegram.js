export function escapeMarkdown(str) {
  return String(str).replace(/([_*`\[])/g, '\\$1');
}

export async function sendTelegramMessage(env, { chatId, text }) {
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
