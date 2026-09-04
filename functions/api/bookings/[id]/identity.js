import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const booking = await env.DB.prepare(`SELECT id, guest_name, id_number, nationality FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) return jsonError('Không tìm thấy đặt phòng', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { idNumber, nationality } = body || {};

  if (idNumber !== undefined && idNumber !== null && (typeof idNumber !== 'string' || idNumber.length > 200)) {
    return jsonError('Số CCCD/hộ chiếu không hợp lệ', 400);
  }
  if (nationality !== undefined && nationality !== null && (typeof nationality !== 'string' || nationality.length > 200)) {
    return jsonError('Quốc tịch không hợp lệ', 400);
  }

  const newIdNumber = idNumber ? idNumber.trim() || null : null;
  const newNationality = nationality ? nationality.trim() || null : null;

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE bookings SET id_number = ?, nationality = ? WHERE id = ?`).bind(newIdNumber, newNationality, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('guest_identity_update', 'booking', ?, ?, ?, ?, ?, ?)`
    ).bind(
      booking.id,
      booking.guest_name,
      `${booking.id_number || ''} / ${booking.nationality || ''}`,
      `${newIdNumber || ''} / ${newNationality || ''}`,
      auth.username,
      now
    ),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
