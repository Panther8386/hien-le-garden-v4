import { requireAuth } from '../../../lib/requireAuth.js';
import { computePromoStatus } from '../../../lib/promoCode.js';

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const row = await env.DB.prepare(
    `SELECT id AS feedbackId, guest_name AS guestName, phone, email, rating, comment, promo_code AS promoCode,
            discount_percent AS discountPercent, promo_status AS promoStatus, promo_expires_at AS promoExpiresAt,
            submitted_at AS submittedAt, wants_telegram AS wantsTelegram, telegram_chat_id AS telegramChatId,
            gift_offered AS giftOffered, gift_claimed AS giftClaimed, stay_date AS stayDate,
            wishes_next_time AS wishesNextTime, favorite_activities AS favoriteActivities
     FROM feedback_responses WHERE id = ?`
  )
    .bind(params.id)
    .first();

  if (!row) {
    return new Response(JSON.stringify({ error: 'Không tìm thấy khách hàng' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const { results: history } = await env.DB.prepare(
    `SELECT l.channel, l.status, l.sent_at AS sentAt, l.sent_by AS sentBy, t.name AS templateName
     FROM message_log l LEFT JOIN message_templates t ON t.id = l.template_id
     WHERE l.feedback_id = ? ORDER BY l.sent_at DESC`
  )
    .bind(params.id)
    .all();

  return new Response(
    JSON.stringify({
      feedbackId: row.feedbackId,
      guestName: row.guestName,
      phone: row.phone,
      email: row.email,
      rating: row.rating,
      comment: row.comment,
      promoCode: row.promoCode,
      discountPercent: row.discountPercent,
      promoStatus: computePromoStatus(row.promoStatus, row.promoExpiresAt),
      submittedAt: row.submittedAt,
      wantsTelegram: !!row.wantsTelegram,
      hasTelegramChatId: !!row.telegramChatId,
      giftOffered: !!row.giftOffered,
      giftClaimed: !!row.giftClaimed,
      stayDate: row.stayDate,
      wishesNextTime: row.wishesNextTime,
      favoriteActivities: row.favoriteActivities ? JSON.parse(row.favoriteActivities) : [],
      messageHistory: history.map((h) => ({
        channel: h.channel,
        status: h.status,
        sentAt: h.sentAt,
        sentBy: h.sentBy,
        templateName: h.templateName || null,
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
