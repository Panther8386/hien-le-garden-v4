import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM service_slot_template WHERE id = ? AND service_catalog_id = ?`).bind(params.templateId, params.id).first();
  if (!existing) return jsonError('Không tìm thấy khung giờ', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};

  const label = body.label !== undefined ? body.label : existing.label;
  const daysOfWeek = body.daysOfWeek !== undefined ? body.daysOfWeek : existing.days_of_week.split(',').map(Number);
  const startTime = body.startTime !== undefined ? body.startTime : existing.start_time;
  const capacity = body.capacity !== undefined ? body.capacity : existing.capacity;
  const isActive = body.isActive !== undefined ? body.isActive : !!existing.is_active;

  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
    return jsonError('Vui lòng chọn ít nhất một ngày trong tuần', 400);
  }
  const uniqueDays = new Set(daysOfWeek);
  if (uniqueDays.size !== daysOfWeek.length || daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return jsonError('Ngày trong tuần không hợp lệ', 400);
  }
  if (typeof startTime !== 'string' || !TIME_FORMAT.test(startTime)) {
    return jsonError('Giờ bắt đầu không hợp lệ', 400);
  }
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return jsonError('Sức chứa phải là số nguyên dương', 400);
  }

  await env.DB.prepare(
    `UPDATE service_slot_template SET label = ?, days_of_week = ?, start_time = ?, capacity = ?, is_active = ? WHERE id = ?`
  )
    .bind(label || null, daysOfWeek.join(','), startTime, capacity, isActive ? 1 : 0, params.templateId)
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
