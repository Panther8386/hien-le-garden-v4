import { sendTelegramMessage } from '../../../lib/telegram.js';
import { renderTemplate } from '../../../lib/templates.js';

export async function onRequestPost({ request, env }) {
  try {
    const update = await request.json();
    const message = update.message;

    if (!message || !message.text || !message.text.startsWith('/start ') || !message.chat) {
      return new Response('ok', { status: 200 });
    }

    const feedbackId = message.text.replace('/start ', '').trim();
    const chatId = String(message.chat.id);

    const row = await env.DB.prepare(
      `SELECT guest_name, promo_code, discount_percent, promo_expires_at, gift_offered
       FROM feedback_responses WHERE id = ?`
    )
      .bind(feedbackId)
      .first();

    if (!row) {
      return new Response('ok', { status: 200 });
    }

    await env.DB.prepare(`UPDATE feedback_responses SET telegram_chat_id = ? WHERE id = ?`)
      .bind(chatId, feedbackId)
      .run();

    const template = await env.DB.prepare(
      `SELECT id, channel, subject, body FROM message_templates WHERE channel = 'telegram' AND is_active = 1 LIMIT 1`
    ).first();

    if (template) {
      const rendered = renderTemplate(template, {
        guestName: row.guest_name,
        promoCode: row.promo_code,
        discountPercent: row.discount_percent,
        expiresAt: new Date(row.promo_expires_at),
        giftOffered: !!row.gift_offered,
      });
      const sent = await sendTelegramMessage(env, { chatId, text: rendered.body });
      await env.DB.prepare(
        `INSERT INTO message_log (feedback_id, template_id, channel, sent_by, status, sent_at) VALUES (?, ?, 'telegram', 'system', ?, ?)`
      )
        .bind(feedbackId, template.id, sent ? 'success' : 'failed', new Date().toISOString())
        .run();
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('Telegram webhook error', err);
    return new Response('ok', { status: 200 });
  }
}
