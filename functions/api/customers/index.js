import { requireAuth } from '../../../lib/requireAuth.js';
import { computePromoStatus } from '../../../lib/promoCode.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').trim();
  const statusFilter = url.searchParams.get('status');
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize'), 10) || 25));

  const conditions = [];
  const params = [];
  if (search) {
    conditions.push(`(guest_name LIKE ? OR phone LIKE ? OR promo_code LIKE ?)`);
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT id AS feedbackId, guest_name AS guestName, phone, email, rating, promo_code AS promoCode,
            discount_percent AS discountPercent, promo_status AS promoStatus, promo_expires_at AS promoExpiresAt,
            submitted_at AS submittedAt, wants_telegram AS wantsTelegram, telegram_chat_id AS telegramChatId,
            gift_offered AS giftOffered, gift_claimed AS giftClaimed
     FROM feedback_responses ${where} ORDER BY submitted_at DESC`
  )
    .bind(...params)
    .all();

  let mapped = results.map((r) => ({
    feedbackId: r.feedbackId,
    guestName: r.guestName,
    phone: r.phone,
    email: r.email,
    rating: r.rating,
    promoCode: r.promoCode,
    discountPercent: r.discountPercent,
    promoStatus: computePromoStatus(r.promoStatus, r.promoExpiresAt),
    submittedAt: r.submittedAt,
    wantsTelegram: !!r.wantsTelegram,
    hasTelegramChatId: !!r.telegramChatId,
    giftOffered: !!r.giftOffered,
    giftClaimed: !!r.giftClaimed,
  }));

  if (statusFilter === 'unused' || statusFilter === 'used' || statusFilter === 'expired') {
    mapped = mapped.filter((r) => r.promoStatus === statusFilter);
  }

  const total = mapped.length;
  const start = (page - 1) * pageSize;
  const pageResults = mapped.slice(start, start + pageSize);

  return new Response(JSON.stringify({ results: pageResults, total, page, pageSize }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
