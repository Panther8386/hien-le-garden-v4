import { requireAuth } from '../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const row = await env.DB.prepare(
    `SELECT suggestion_window_days AS suggestionWindowDays, max_suggestions AS maxSuggestions, updated_at AS updatedAt FROM experience_booking_settings ORDER BY id DESC LIMIT 1`
  ).first();

  const result = row || { suggestionWindowDays: 14, maxSuggestions: 5, updatedAt: null };
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
  const { suggestionWindowDays, maxSuggestions } = body || {};

  if (!Number.isInteger(suggestionWindowDays) || suggestionWindowDays <= 0 || suggestionWindowDays > 365 || !Number.isInteger(maxSuggestions) || maxSuggestions <= 0 || maxSuggestions > 50) {
    return jsonError('Số ngày/số gợi ý phải là số nguyên dương và trong giới hạn cho phép', 400);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO experience_booking_settings (suggestion_window_days, max_suggestions, updated_by, updated_at) VALUES (?, ?, ?, ?)`
  ).bind(suggestionWindowDays, maxSuggestions, auth.username, now).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
