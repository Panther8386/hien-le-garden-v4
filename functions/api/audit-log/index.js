import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_ACTION_TYPES = ['deposit_change', 'booking_cancel', 'service_void', 'account_role_change', 'account_permission_change'];

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  if (type && !VALID_ACTION_TYPES.includes(type)) {
    return jsonError('Loại thay đổi không hợp lệ', 400);
  }

  const limitParam = parseInt(url.searchParams.get('limit'), 10);
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50;

  const where = type ? 'WHERE action_type = ?' : '';
  const bound = type ? [type, limit] : [limit];

  const { results } = await env.DB.prepare(
    `SELECT id, action_type AS actionType, entity_type AS entityType, entity_id AS entityId, entity_label AS entityLabel,
            old_value AS oldValue, new_value AS newValue, actor, created_at AS createdAt
     FROM audit_log ${where} ORDER BY id DESC LIMIT ?`
  ).bind(...bound).all();

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
