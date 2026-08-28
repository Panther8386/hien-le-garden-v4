import { requireAuth } from '../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const row = await env.DB.prepare(
    `SELECT pending_deposit_hours AS pendingDepositHours, cleaning_minutes AS cleaningMinutes, updated_at AS updatedAt FROM reminder_settings ORDER BY id DESC LIMIT 1`
  ).first();

  const result = row || { pendingDepositHours: 2, cleaningMinutes: 60, updatedAt: null };
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { pendingDepositHours, cleaningMinutes } = body || {};

  if (!Number.isInteger(pendingDepositHours) || pendingDepositHours <= 0 || pendingDepositHours > 8760 || !Number.isInteger(cleaningMinutes) || cleaningMinutes <= 0 || cleaningMinutes > 10080) {
    return jsonError('Số giờ/phút phải là số nguyên dương và không quá 1 năm (8760 giờ) / 1 tuần (10080 phút)', 400);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO reminder_settings (pending_deposit_hours, cleaning_minutes, updated_by, updated_at) VALUES (?, ?, ?, ?)`
  ).bind(pendingDepositHours, cleaningMinutes, auth.username, now).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
