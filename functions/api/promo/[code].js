import { requireAuth } from '../../../lib/requireAuth.js';
import { computePromoStatus } from '../../../lib/promoCode.js';

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  const row = await env.DB.prepare(
    `SELECT guest_name, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed
     FROM feedback_responses WHERE promo_code = ?`
  ).bind(params.code).first();

  if (!row) {
    return new Response(JSON.stringify({ error: 'Không tìm thấy mã' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const status = computePromoStatus(row.promo_status, row.promo_expires_at);

  return new Response(
    JSON.stringify({
      guestName: row.guest_name,
      discountPercent: row.discount_percent,
      expiresAt: row.promo_expires_at,
      status,
      giftOffered: !!row.gift_offered,
      giftClaimed: !!row.gift_claimed,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
