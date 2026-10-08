export const LOGIN_WINDOW_MS = 5 * 60 * 1000;
export const LOGIN_ACCOUNT_LIMIT = 5;
export const LOGIN_IP_LIMIT = 30;

// Only the Cloudflare-provided connecting IP is used. X-Forwarded-For and
// client-supplied alternate headers must never select a different budget.
function clientNetwork(request) {
  const ip = request.headers.get('CF-Connecting-IP')?.trim();
  if (ip && ip.split('.').length === 4 && ip.split('.').every(x => /^(0|[1-9][0-9]{0,2})$/.test(x) && Number(x) <= 255)) return ip;
  if (ip?.includes(':') && /^[a-fA-F0-9:.]+$/.test(ip)) {
    let canonical;
    try { canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1); }
    catch { return 'unknown'; }
    const [left, right = ''] = canonical.split('::');
    const a = left ? left.split(':') : [], b = right ? right.split(':') : [];
    const groups = [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
    // IPv4-mapped IPv6 addresses use their IPv4 identity, not a shared /64.
    if (groups.slice(0, 5).every(x => parseInt(x, 16) === 0) && parseInt(groups[5], 16) === 65535) {
      return groups.slice(6).flatMap(x => [parseInt(x, 16) >> 8, parseInt(x, 16) & 255]).join('.');
    }
    // Group IPv6 privacy addresses by /64 to prevent trivial suffix rotation.
    return groups.slice(0, 4).map(x => parseInt(x, 16).toString(16)).join(':') + '::/64';
  }
  // Missing/invalid proxy metadata shares a restrictive budget; never bypass.
  return 'unknown';
}

async function digest(parts) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function consumeLoginBudget(db, request, username, now = Date.now()) {
  const network = clientNetwork(request);
  const keys = await Promise.all([
    digest(['login-ip', network]),
    digest(['login-account', network, username.trim().toLowerCase()]),
  ]);
  const limits = [LOGIN_IP_LIMIT, LOGIN_ACCOUNT_LIMIT];
  const statements = keys.map((key, index) => db.prepare(`
    INSERT INTO login_rate_limits (bucket_key, attempts, expires_at)
    SELECT ?, 1, ? WHERE ${index === 0 ? '1' : 'EXISTS (SELECT 1 FROM login_rate_limits WHERE bucket_key = ? AND attempts <= ?)'}
    ON CONFLICT(bucket_key) DO UPDATE SET
      attempts = CASE WHEN login_rate_limits.expires_at <= ? THEN 1
                      ELSE MIN(login_rate_limits.attempts + 1, ?) END,
      expires_at = CASE WHEN login_rate_limits.expires_at <= ? THEN excluded.expires_at
                        ELSE login_rate_limits.expires_at END
    RETURNING attempts, expires_at
  `).bind(key, now + LOGIN_WINDOW_MS, ...(index === 0 ? [] : [keys[0], LOGIN_IP_LIMIT]), now, limits[index] + 1, now));
  // One transaction reserves both budgets before credential lookup/PBKDF2.
  // Expired rows are removed in bounded batches using the expiry index.
  const results = await db.batch([...statements, db.prepare(`
    DELETE FROM login_rate_limits WHERE bucket_key IN
      (SELECT bucket_key FROM login_rate_limits WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)
  `).bind(now)]);
  let retryAfter = 0;
  for (let i = 0; i < keys.length; i++) {
    const row = results[i].results?.[0];
    if (!row || !results[i].success) throw new Error('Login budget unavailable');
    if (row.attempts > limits[i]) retryAfter = Math.max(retryAfter, Math.ceil((row.expires_at - now) / 1000));
    // Once IP budget is exhausted, the second statement intentionally writes
    // nothing: rotating usernames cannot grow storage while already blocked.
    if (i === 0 && retryAfter > 0) break;
  }
  return { allowed: retryAfter === 0, retryAfter };
}

export function loginThrottleResponse(status, retryAfter) {
  const error = status === 429
    ? `Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau ${retryAfter} giây.`
    : 'Đăng nhập tạm thời không khả dụng. Vui lòng thử lại sau.';
  return new Response(JSON.stringify({ error, retryAfter }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter) },
  });
}
