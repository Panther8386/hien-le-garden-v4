import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const PERIOD_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const period = url.searchParams.get('period');
  if (!period || !PERIOD_FORMAT.test(period)) {
    return jsonError('Kỳ không hợp lệ, dùng định dạng YYYY-MM', 400);
  }

  const row = await env.DB.prepare(
    `SELECT opening_balance, set_by, set_at FROM finance_opening_balance WHERE period = ? ORDER BY id DESC LIMIT 1`
  ).bind(period).first();

  return new Response(
    JSON.stringify({
      period,
      openingBalance: row ? row.opening_balance : null,
      setBy: row ? row.set_by : null,
      setAt: row ? row.set_at : null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { period, openingBalance } = body || {};

  if (typeof period !== 'string' || !PERIOD_FORMAT.test(period)) {
    return jsonError('Kỳ không hợp lệ, dùng định dạng YYYY-MM', 400);
  }
  if (!Number.isInteger(openingBalance)) {
    return jsonError('Số dư đầu kỳ phải là số nguyên', 400);
  }

  const now = new Date().toISOString();
  const previous = await env.DB.prepare(`SELECT opening_balance FROM finance_opening_balance WHERE period = ? ORDER BY id DESC LIMIT 1`).bind(period).first();

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO finance_opening_balance (period, opening_balance, set_by, set_at) VALUES (?, ?, ?, ?)`).bind(period, openingBalance, auth.username, now),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('finance_opening_balance_set', 'finance_opening_balance', 0, ?, ?, ?, ?, ?)`
    ).bind(period, previous ? String(previous.opening_balance) : null, String(openingBalance), auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
