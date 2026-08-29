import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateSlotTemplateFields(body) {
  const { daysOfWeek, startTime, capacity } = body;

  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
    return 'Vui lòng chọn ít nhất một ngày trong tuần';
  }
  const uniqueDays = new Set(daysOfWeek);
  if (uniqueDays.size !== daysOfWeek.length || daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return 'Ngày trong tuần không hợp lệ';
  }
  if (typeof startTime !== 'string' || !TIME_FORMAT.test(startTime)) {
    return 'Giờ bắt đầu không hợp lệ';
  }
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return 'Sức chứa phải là số nguyên dương';
  }
  return null;
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    `SELECT id, service_catalog_id AS serviceCatalogId, label, days_of_week AS daysOfWeek,
            start_time AS startTime, capacity, is_active AS isActive
     FROM service_slot_template WHERE service_catalog_id = ? ORDER BY start_time`
  ).bind(params.id).all();

  const coerced = results.map((row) => ({ ...row, isActive: !!row.isActive }));
  return new Response(JSON.stringify(coerced), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};

  const validationError = validateSlotTemplateFields(body);
  if (validationError) return jsonError(validationError, 400);

  const catalogItem = await env.DB.prepare(`SELECT id, is_scheduled FROM service_catalog WHERE id = ?`).bind(params.id).first();
  if (!catalogItem || !catalogItem.is_scheduled) {
    return jsonError('Dịch vụ này chưa bật chế độ khung giờ', 400);
  }

  const { label, daysOfWeek, startTime, capacity } = body;
  const now = new Date().toISOString();

  const result = await env.DB.prepare(
    `INSERT INTO service_slot_template (service_catalog_id, label, days_of_week, start_time, capacity, is_active, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  )
    .bind(params.id, label || null, daysOfWeek.join(','), startTime, capacity, auth.username, now)
    .run();

  return new Response(JSON.stringify({ id: result.meta.last_row_id, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
