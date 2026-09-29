import { sendTelegramMessage } from '../../../lib/telegram.js';
import { renderTemplate } from '../../../lib/templates.js';
import { isAuthorizedTelegramWebhook } from '../../../lib/telegramWebhookAuth.js';

// Danh sách chat id được phép đổi nơi nhận thông báo đặt phòng
// (env.TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS, phân tách bằng dấu phẩy).
function isAllowedNotifyChat(env, chatId) {
  const raw = env.TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS;
  if (typeof raw !== 'string') return false;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(chatId);
}

export async function onRequestPost({ request, env }) {
  // Xác thực TRƯỚC khi đọc body hay chạm DB. Không log header/secret.
  if (!isAuthorizedTelegramWebhook(request, env)) {
    return new Response('unauthorized', { status: 401 });
  }

  try {
    const update = await request.json();
    const message = update.message;

    // Telegram delivers the deep-link command as plain "/start <payload>" in a
    // private chat, but commonly as "/start@BotUsername <payload>" in a group
    // (e.g. to disambiguate when multiple bots are present, or via client
    // autocomplete) — accept both forms.
    const commandMatch = message && message.text && message.chat ? message.text.match(/^\/start(?:@\S+)?\s+(.+)$/) : null;
    if (!commandMatch) {
      return new Response('ok', { status: 200 });
    }

    const payload = commandMatch[1].trim();
    const chatId = String(message.chat.id);

    if (payload === 'staff_booking_notify') {
      // Chỉ chat đã được quản trị viên duyệt trước mới đổi được nơi nhận
      // thông báo (có SĐT khách). Chat khác: bỏ qua im lặng, trả 200 để
      // Telegram không gửi lại.
      if (!isAllowedNotifyChat(env, chatId)) {
        return new Response('ok', { status: 200 });
      }
      const now = new Date().toISOString();
      const existing = await env.DB.prepare(`SELECT id, booking_notify_chat_id FROM notification_settings ORDER BY id DESC LIMIT 1`).first();
      const statements = [];
      if (existing) {
        statements.push(
          env.DB.prepare(`UPDATE notification_settings SET booking_notify_chat_id = ?, updated_at = ? WHERE id = ?`)
            .bind(chatId, now, existing.id)
        );
      } else {
        statements.push(
          env.DB.prepare(`INSERT INTO notification_settings (booking_notify_chat_id, updated_at) VALUES (?, ?)`)
            .bind(chatId, now)
        );
      }
      const oldChatId = existing && existing.booking_notify_chat_id != null ? String(existing.booking_notify_chat_id) : null;
      if (oldChatId !== chatId) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
             VALUES ('notification_destination_change', 'notification_settings', ?, 'booking_notify_chat_id', ?, ?, ?, ?)`
          ).bind(existing ? existing.id : 0, oldChatId, chatId, `telegram:${chatId}`, now)
        );
      }
      await env.DB.batch(statements);
      await sendTelegramMessage(env, { chatId, text: '✅ Đã kết nối nhận thông báo yêu cầu đặt phòng mới từ Hiền Lê Garden.' });
      return new Response('ok', { status: 200 });
    }

    const feedbackId = payload;

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
