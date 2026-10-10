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
  return reserveBudgets(db, keys, limits, now);
}

// Separate namespace: changing a password must never consume login budgets.
// Account budget follows the authenticated staff ID across sessions/networks.
export async function consumePasswordChangeBudget(db, request, staffId, now = Date.now()) {
  const keys = await Promise.all([
    digest(['password-change-ip', clientNetwork(request)]),
    digest(['password-change-account', staffId]),
  ]);
  return reserveBudgets(db, keys, [30, 5], now);
}

// Global bucket goes first: rotating networks cannot create unbounded rows or
// trigger unbounded Siteverify/notification work within a window.
export async function consumePublicBookingBudget(db, request, now = Date.now()) {
  const [global, network] = await Promise.all([digest(['public-booking-global']), digest(['public-booking-network', clientNetwork(request)])]);
  const results = await db.batch([
    db.prepare(`INSERT INTO login_rate_limits(bucket_key,attempts,expires_at) VALUES(?,1,?)
      ON CONFLICT(bucket_key) DO UPDATE SET
      attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts,expires_at`)
      .bind(global, now+LOGIN_WINDOW_MS, now, now),
    db.prepare(`INSERT INTO login_rate_limits(bucket_key,attempts,expires_at)
      SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM login_rate_limits WHERE bucket_key=? AND attempts<301)
      ON CONFLICT(bucket_key) DO UPDATE SET
      attempts=CASE WHEN expires_at<=? THEN 1 ELSE MIN(attempts+1,6) END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts,expires_at`)
      .bind(network, now+LOGIN_WINDOW_MS, global, now, now),
    // A network already blocked cannot drain the global budget for everyone.
    db.prepare(`UPDATE login_rate_limits SET attempts=attempts+1 WHERE bucket_key=? AND attempts<301
      AND EXISTS(SELECT 1 FROM login_rate_limits WHERE bucket_key=? AND attempts<=5) RETURNING attempts,expires_at`).bind(global,network),
    db.prepare(`DELETE FROM login_rate_limits WHERE bucket_key IN
      (SELECT bucket_key FROM login_rate_limits WHERE expires_at<=? ORDER BY expires_at LIMIT 100)`).bind(now),
  ]);
  if (results.some(r => !r.success)) throw new Error('Booking budget unavailable');
  const g=results[0].results?.[0], n=results[1].results?.[0];
  if (!g) throw new Error('Booking budget unavailable');
  if (g.attempts>=301) return {allowed:false,retryAfter:Math.max(1,Math.ceil((g.expires_at-now)/1000))};
  if (!n) throw new Error('Booking budget unavailable');
  if (n.attempts>5) return {allowed:false,retryAfter:Math.max(1,Math.ceil((n.expires_at-now)/1000))};
  if (!results[2].results?.length) throw new Error('Booking budget unavailable');
  return {allowed:true,retryAfter:0};
}

async function reserveBudgets(db, keys, limits, now) {
  const statements = keys.map((key, index) => db.prepare(`
    INSERT INTO login_rate_limits (bucket_key, attempts, expires_at)
    SELECT ?, 1, ? WHERE ${index === 0 ? '1' : 'EXISTS (SELECT 1 FROM login_rate_limits WHERE bucket_key = ? AND attempts <= ?)'}
    ON CONFLICT(bucket_key) DO UPDATE SET
      attempts = CASE WHEN login_rate_limits.expires_at <= ? THEN 1
                      ELSE MIN(login_rate_limits.attempts + 1, ?) END,
      expires_at = CASE WHEN login_rate_limits.expires_at <= ? THEN excluded.expires_at
                        ELSE login_rate_limits.expires_at END
    RETURNING attempts, expires_at
  `).bind(key, now + LOGIN_WINDOW_MS, ...(index === 0 ? [] : [keys[0], limits[0]]), now, limits[index] + 1, now));
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
