import { beforeEach, describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as create } from '../functions/api/bookings/index.js';
import { consumePublicBookingBudget, consumeLoginBudget, LOGIN_WINDOW_MS } from '../lib/loginRateLimit.js';
import { SITEVERIFY_URL, verifyTurnstile } from '../lib/turnstile.js';

const host = 'hienlegarden.vn';
const protectedEnv = (extra = {}) => ({ ...env, PUBLIC_BOOKING_ALLOWED_HOSTNAMES: host, TURNSTILE_ALLOWED_HOSTNAMES: host,
  TURNSTILE_SECRET_KEY: 'synthetic-secret', ...extra });
const body = { guestName: 'F2 synthetic guest', phone: '0900000000', roomType: 'circle', checkIn: '2099-01-01', checkOut: '2099-01-02', turnstileToken: 'synthetic-token' };
const req = (data = body, headers = {}, url = `https://${host}/api/bookings`) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...headers }, body: JSON.stringify(data) });
const attempt = (data, headers, url, extra) => create({ request: req(data, headers, url), env: protectedEnv(extra) });
const human = (extra = {}) => Response.json({ success: true, hostname: host, action: 'booking', ...extra });
const count = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM bookings').first()).n;

beforeEach(async () => {
  await env.DB.batch(['bookings', 'notification_settings', 'login_rate_limits'].map(t => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe('F-2 real public handler and D1 protection', () => {
  it('accepts ordinary customers only after matching hostname/action Siteverify', async () => {
    const fetch = vi.fn(async () => human()); vi.stubGlobal('fetch', fetch);
    const r = await attempt(); expect(r.status).toBe(201); expect(await count()).toBe(1);
    expect(fetch.mock.calls[0][0]).toBe(SITEVERIFY_URL);
    const form = new URLSearchParams(fetch.mock.calls[0][1].body);
    expect(form.get('response')).toBe('synthetic-token'); expect(form.get('remoteip')).toBe('192.0.2.1');
  });
  it('blocks missing, oversized and forged tokens with zero booking/Telegram writes', async () => {
    const fetch = vi.fn(async () => Response.json({ success: false })); vi.stubGlobal('fetch', fetch);
    for (const turnstileToken of [undefined, '', 'x'.repeat(2049), 'forged']) expect((await attempt({ ...body, turnstileToken })).status).toBe(403);
    expect(await count()).toBe(0); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a valid feedback token (wrong/missing action)', async () => {
    for (const action of [undefined, 'feedback', 'Booking']) {
      vi.stubGlobal('fetch', vi.fn(async () => human({ action })));
      expect((await attempt()).status).toBe(403);
    }
    expect(await count()).toBe(0);
  });
  it('binds a token to the actual request hostname even if both are allowlisted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => human({ hostname: 'www.hienlegarden.vn' })));
    expect((await attempt(undefined, undefined, undefined, { TURNSTILE_ALLOWED_HOSTNAMES: host+',www.hienlegarden.vn' })).status).toBe(403);
    expect(await count()).toBe(0);
  });
  it('rejects single-use token replay based on Siteverify verdict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(async () => human()).mockImplementationOnce(async () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] })));
    expect((await attempt()).status).toBe(201); expect((await attempt()).status).toBe(403); expect(await count()).toBe(1);
  });
  it('denies production immutable/alias/foreign hosts before budget, body or verification', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const url of ['https://a31eadaa.hien-le-garden-v4.pages.dev/api/bookings', 'https://hien-le-garden-v4.pages.dev/api/bookings', 'https://hienlegarden.vn.evil.test/api/bookings', 'http://hienlegarden.vn/api/bookings', 'https://hienlegarden.vn:8443/api/bookings']) {
      const request = req(body, { Origin: 'https://'+host, 'X-Forwarded-Host': host }, url);
      expect((await create({ request, env: protectedEnv() })).status).toBe(403); expect(request.bodyUsed).toBe(false);
    }
    expect(await count()).toBe(0); expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM login_rate_limits').first()).n).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects missing/malformed host configuration and unavailable budget storage closed', async () => {
    for (const PUBLIC_BOOKING_ALLOWED_HOSTNAMES of [undefined, '', '*.pages.dev']) expect((await attempt(undefined, undefined, undefined, { PUBLIC_BOOKING_ALLOWED_HOSTNAMES })).status).toBe(503);
    const r = await attempt(undefined, undefined, undefined, { DB: { batch: async () => { throw new Error('unavailable'); } } });
    expect(r.status).toBe(503); expect(r.headers.get('Retry-After')).toBe('60'); expect(await count()).toBe(0);
  });
  it('rejects cross-origin requests without trusting forged forwarding metadata', async () => {
    expect((await attempt(undefined, { Origin: 'https://evil.test' })).status).toBe(403);
    expect((await attempt(undefined, { Origin: 'null' })).status).toBe(403); expect(await count()).toBe(0);
  });
  it('isolates preview hostname from production and requires the preview token hostname', async () => {
    const preview = 'staging.hien-le-garden-v4.pages.dev';
    vi.stubGlobal('fetch', vi.fn(async () => human({ hostname: preview })));
    const extra = { PUBLIC_BOOKING_ALLOWED_HOSTNAMES: preview, TURNSTILE_ALLOWED_HOSTNAMES: preview };
    expect((await attempt(undefined, undefined, `https://${preview}/api/bookings`, extra)).status).toBe(201);
    expect((await attempt(undefined, undefined, undefined, extra)).status).toBe(403);
  });
  it('fails closed on verification outage and sends no Telegram notification', async () => {
    await env.DB.prepare("INSERT INTO notification_settings(booking_notify_chat_id,updated_at) VALUES('synthetic-chat','2026-10-10')").run();
    const fetch = vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); }); vi.stubGlobal('fetch', fetch);
    expect((await attempt(undefined, undefined, undefined, { TELEGRAM_BOT_TOKEN: 'synthetic-bot' })).status).toBe(403); expect(await count()).toBe(0); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reserves only five verification slots under concurrent anonymous requests', async () => {
    const fetch = vi.fn(async () => Response.json({ success: false })); vi.stubGlobal('fetch', fetch);
    const responses = await Promise.all(Array.from({ length: 12 }, () => attempt()));
    expect(responses.filter(r => r.status === 403)).toHaveLength(5); expect(responses.filter(r => r.status === 429)).toHaveLength(7);
    const blocked = responses.find(r => r.status === 429); expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0); expect(blocked.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).toHaveBeenCalledTimes(5); expect(await count()).toBe(0);
  });
  it('does not bypass budget through X-Forwarded-For and IPv6 suffix rotation', async () => {
    const now = 1000;
    for (let i = 1; i <= 5; i++) expect((await consumePublicBookingBudget(env.DB, req(body, { 'CF-Connecting-IP': '2001:db8:1:2::'+i }), now)).allowed).toBe(true);
    expect((await consumePublicBookingBudget(env.DB, req(body, { 'CF-Connecting-IP': '2001:db8:1:2::99', 'X-Forwarded-For': '192.0.2.55' }), now)).allowed).toBe(false);
  });
  it('expires naturally and keeps booking budgets separate from login', async () => {
    for (let i = 0; i < 5; i++) await consumePublicBookingBudget(env.DB, req(), 1000);
    expect((await consumePublicBookingBudget(env.DB, req(), 1000)).allowed).toBe(false);
    expect((await consumeLoginBudget(env.DB, req(), 'synthetic', 1000)).allowed).toBe(true);
    expect((await consumePublicBookingBudget(env.DB, req(), 1000+LOGIN_WINDOW_MS)).allowed).toBe(true);
  });
  it('bounds global verification work and storage while rotating networks', async () => {
    for (let i = 0; i < 300; i++) expect((await consumePublicBookingBudget(env.DB, req(body, { 'CF-Connecting-IP': `198.51.${Math.floor(i/256)}.${i%256}` }), 1000)).allowed).toBe(true);
    for (let i = 0; i < 10; i++) expect((await consumePublicBookingBudget(env.DB, req(body, { 'CF-Connecting-IP': `203.0.113.${i}` }), 1000)).allowed).toBe(false);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM login_rate_limits').first()).n).toBe(301);
  });
  it('a throttled network cannot consume the global allowance for other customers', async () => {
    for (let i=0;i<320;i++) await consumePublicBookingBudget(env.DB, req(), 1000);
    expect((await consumePublicBookingBudget(env.DB, req(body, {'CF-Connecting-IP':'192.0.2.2'}), 1000)).allowed).toBe(true);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM login_rate_limits').first()).n).toBe(3);
  });
  it('keeps feedback verification backward compatible and bounds network wait', async () => {
    const fetch = vi.fn(async () => human({ action: undefined })); vi.stubGlobal('fetch', fetch);
    expect(await verifyTurnstile(protectedEnv(), 'synthetic-token')).toBe(true);
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
