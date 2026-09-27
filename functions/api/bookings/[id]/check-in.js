import { requireAuth } from '../../../../lib/requireAuth.js';
import { hasPermission } from '../../../../lib/permissions.js';
import { canSeeHidden } from '../../../../lib/hiddenAccess.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, 'bookings.manage');
  if (auth instanceof Response) return auth;
  // Mutating requires seeing the resource: without bookings.view answer like a missing id.
  if (!hasPermission(auth, 'bookings.view')) return jsonError('Không tìm thấy đặt phòng', 404);

  const booking = await env.DB.prepare(`SELECT id, status, is_hidden FROM bookings WHERE id = ?`).bind(params.id).first();
  // A hidden booking answers exactly like a non-existent id for anyone without records.hide.
  if (!booking || !canSeeHidden(auth, booking)) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }
  if (booking.status !== 'confirmed') {
    return jsonError('Chỉ có thể check-in từ trạng thái đã xác nhận', 400);
  }

  // Guarded write: a competing transition (e.g. cancel) that landed after the pre-check above
  // must win — never overwrite a booking that is no longer 'confirmed'.
  const update = await env.DB.prepare(`UPDATE bookings SET status = 'checked_in' WHERE id = ? AND status = 'confirmed'`).bind(params.id).run();
  if (update.meta.changes === 0) {
    return jsonError('Chỉ có thể check-in từ trạng thái đã xác nhận', 400);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
