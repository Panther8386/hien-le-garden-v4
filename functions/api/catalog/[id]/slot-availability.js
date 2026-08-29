import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  if (!date || !DATE_FORMAT.test(date)) {
    return jsonError('Ngày không hợp lệ', 400);
  }

  const { results } = await env.DB.prepare(
    `SELECT st.id, st.label, st.start_time AS startTime, st.capacity, st.days_of_week AS daysOfWeek,
            COALESCE(SUM(bsi.quantity), 0) AS booked
     FROM service_slot_template st
     LEFT JOIN booking_service_items bsi
       ON bsi.slot_template_id = st.id AND bsi.experience_date = ? AND bsi.status = 'posted'
     WHERE st.service_catalog_id = ? AND st.is_active = 1
     GROUP BY st.id
     ORDER BY st.start_time`
  ).bind(date, params.id).all();

  const weekday = weekdayOf(date);
  const matching = results
    .filter((row) => row.daysOfWeek.split(',').map(Number).includes(weekday))
    .map(({ daysOfWeek, ...rest }) => ({ ...rest, remaining: rest.capacity - rest.booked }));

  return new Response(JSON.stringify(matching), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
