import { parseAllowedHostnames } from './turnstile.js';
import { consumePublicBookingBudget } from './loginRateLimit.js';

export function bookingError(message, status, retryAfter) {
  return Response.json({ error: message }, { status, headers: {
    'Cache-Control': 'no-store', ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
  } });
}

export async function protectPublicBooking(request, env) {
  const allowed = parseAllowedHostnames(env.PUBLIC_BOOKING_ALLOWED_HOSTNAMES);
  if (!allowed) return bookingError('Đặt phòng trực tuyến tạm thời không khả dụng. Vui lòng liên hệ qua điện thoại hoặc Zalo.', 503, 60);
  const url = new URL(request.url);
  // Trust the actual request URL, never X-Forwarded-Host or Origin as a bypass.
  if (url.protocol !== 'https:' || url.port || !allowed.has(url.hostname)) return bookingError('Vui lòng đặt phòng trên website chính thức.', 403);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return bookingError('Nguồn gửi yêu cầu không hợp lệ.', 403);
  let budget;
  try { budget = await consumePublicBookingBudget(env.DB, request); }
  catch { return bookingError('Đặt phòng trực tuyến tạm thời không khả dụng. Vui lòng thử lại sau.', 503, 60); }
  if (!budget.allowed) return bookingError(`Bạn đã gửi nhiều yêu cầu. Vui lòng thử lại sau ${budget.retryAfter} giây hoặc liên hệ qua điện thoại/Zalo.`, 429, budget.retryAfter);
  return null;
}
