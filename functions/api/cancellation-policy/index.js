import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const isPublic = url.searchParams.get('public') === '1';

  if (!isPublic) {
    const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
    if (auth instanceof Response) return auth;
  }

  const { results } = await env.DB.prepare(
    `SELECT id, min_days_before_checkin AS minDaysBeforeCheckin, refund_percent AS refundPercent, label, display_order AS displayOrder
     FROM cancellation_policy_tier ORDER BY min_days_before_checkin DESC`
  ).all();

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { minDaysBeforeCheckin, refundPercent, label, displayOrder } = body;

  if (!Number.isInteger(minDaysBeforeCheckin) || minDaysBeforeCheckin < 0) {
    return jsonError('Số ngày tối thiểu phải là số nguyên không âm', 400);
  }
  if (!Number.isInteger(refundPercent) || refundPercent < 0 || refundPercent > 100) {
    return jsonError('Phần trăm hoàn cọc phải là số nguyên từ 0 đến 100', 400);
  }

  await env.DB.prepare(
    `INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, label, display_order, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(minDaysBeforeCheckin, refundPercent, label || null, Number.isInteger(displayOrder) ? displayOrder : 0, auth.username, new Date().toISOString())
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
