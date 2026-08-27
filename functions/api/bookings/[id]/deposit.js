import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { depositAmount } = body || {};

  if (!Number.isInteger(depositAmount) || depositAmount < 0) {
    return jsonError('Số tiền cọc phải là số nguyên không âm', 400);
  }

  const booking = await env.DB.prepare(`SELECT id FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }

  await env.DB.prepare(`UPDATE bookings SET deposit_amount = ? WHERE id = ?`).bind(depositAmount, params.id).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
