import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

function isValidPrice(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT price_weekday, price_weekend FROM rooms WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy phòng', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }

  const priceWeekday = body.priceWeekday !== undefined ? body.priceWeekday : existing.price_weekday;
  const priceWeekend = body.priceWeekend !== undefined ? body.priceWeekend : existing.price_weekend;

  if (!isValidPrice(priceWeekday) || !isValidPrice(priceWeekend)) {
    return jsonError('Giá phòng phải là số nguyên không âm hoặc để trống', 400);
  }

  await env.DB.prepare(`UPDATE rooms SET price_weekday = ?, price_weekend = ? WHERE id = ?`)
    .bind(priceWeekday, priceWeekend, params.id)
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
