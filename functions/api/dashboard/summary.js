import { requireAuth } from '../../../lib/requireAuth.js';
import { getTodaySnapshot, getMonthSummary } from '../../../lib/dashboardMetrics.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

function currentMonth() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
}

const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || currentMonth();

  if (!MONTH_FORMAT.test(month)) {
    return jsonError('Tháng không hợp lệ, dùng định dạng YYYY-MM', 400);
  }

  const [todaySnapshot, monthSummary] = await Promise.all([
    getTodaySnapshot(env),
    getMonthSummary(env, month),
  ]);

  return new Response(JSON.stringify({ month, today: todaySnapshot, monthSummary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
