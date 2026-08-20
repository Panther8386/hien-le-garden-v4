import { requireAuth } from '../../../../lib/requireAuth.js';
import { renderTemplate } from '../../../../lib/templates.js';
import { sendPromoEmail } from '../../../../lib/email.js';
import { sendTelegramMessage } from '../../../../lib/telegram.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { templateId } = body;

  const guest = await env.DB.prepare(
    `SELECT guest_name, email, telegram_chat_id, promo_code, discount_percent, promo_expires_at, gift_offered
     FROM feedback_responses WHERE id = ?`
  )
    .bind(params.id)
    .first();
  if (!guest) {
    return jsonError('Không tìm thấy khách hàng', 404);
  }

  const template = await env.DB.prepare(`SELECT id, channel, subject, body FROM message_templates WHERE id = ?`).bind(templateId).first();
  if (!template) {
    return jsonError('Không tìm thấy template', 404);
  }

  if (template.channel === 'telegram' && !guest.telegram_chat_id) {
    return jsonError('Khách chưa kết nối Telegram, không thể gửi qua kênh này', 400);
  }
  if (template.channel === 'email' && !guest.email) {
    return jsonError('Khách không có email', 400);
  }

  const rendered = renderTemplate(template, {
    guestName: guest.guest_name,
    promoCode: guest.promo_code,
    discountPercent: guest.discount_percent,
    expiresAt: new Date(guest.promo_expires_at),
    giftOffered: !!guest.gift_offered,
  });

  const sent =
    template.channel === 'email'
      ? await sendPromoEmail(env, { to: guest.email, toName: guest.guest_name, subject: rendered.subject, html: rendered.body })
      : await sendTelegramMessage(env, { chatId: guest.telegram_chat_id, text: rendered.body });

  await env.DB.prepare(
    `INSERT INTO message_log (feedback_id, template_id, channel, sent_by, status, sent_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(params.id, template.id, template.channel, auth.username, sent ? 'success' : 'failed', new Date().toISOString())
    .run();

  return new Response(JSON.stringify({ ok: sent }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
