import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env as baseEnv } from 'cloudflare:test';
import { onRequestPost as submitFeedback } from '../functions/api/feedback.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const TEST_SECRET = 'test-secret';
const TEST_TOKEN = 'dummy-turnstile-token';
const DEDUPE_ERROR =
  'Bạn đã nhận ưu đãi cho lần góp ý này. Ưu đãi hiện tại vẫn còn hiệu lực. Nếu chưa nhận được mã, vui lòng liên hệ lễ tân.';
const TURNSTILE_ERROR = 'Xác minh chống spam không thành công. Vui lòng thử lại.';

const env = { ...baseEnv, TURNSTILE_SECRET_KEY: TEST_SECRET, TURNSTILE_ALLOWED_HOSTNAMES: 'staging.example.test', BREVO_API_KEY: 'test-key' };

// Routes stubbed fetch calls by URL. `siteverify` / `brevo` return the Response
// (or throw) for their host; any other URL is a test bug.
function stubFetch({
  siteverify = () => Response.json({ success: true, hostname: 'staging.example.test' }),
  brevo = () => new Response('{}', { status: 201 }),
} = {}) {
  const fn = vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === SITEVERIFY_URL) return siteverify();
    if (url === BREVO_URL) return brevo();
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function callsTo(fetchMock, url) {
  return fetchMock.mock.calls.filter(([input]) => (typeof input === 'string' ? input : input.url) === url);
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM message_log');
  await env.DB.exec('DELETE FROM feedback_responses');
  await env.DB.exec('DELETE FROM promo_policy');
  await env.DB.exec('DELETE FROM gift_inventory');
  stubFetch();
});

function validBody(overrides = {}) {
  return {
    guestName: 'Nguyễn Văn A',
    phone: '0900000000',
    email: 'khach@example.com',
    wantsTelegram: false,
    rating: 5,
    comment: 'Rất tuyệt vời',
    consentGiven: true,
    turnstileToken: TEST_TOKEN,
    ...overrides,
  };
}

function post(body, { headers = {}, raw } = {}) {
  return new Request('https://x/api/feedback', {
    method: 'POST',
    headers,
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
}

async function rowCount() {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback_responses').first();
  return r.n;
}

describe('POST /api/feedback', () => {
  it('rejects submissions without consent', async () => {
    const response = await submitFeedback({ request: post(validBody({ consentGiven: false })), env });
    expect(response.status).toBe(400);
  });

  it('rejects submissions with no contact method', async () => {
    const response = await submitFeedback({ request: post(validBody({ email: undefined, wantsTelegram: false })), env });
    expect(response.status).toBe(400);
  });

  it('creates a feedback row with a 6-month promo code and sends the email', async () => {
    await env.DB.prepare(
      `INSERT INTO gift_inventory (id, name, stock_count, updated_at) VALUES (1, 'Túi vải', 10, '2026-08-01T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO promo_policy (discount_percent, valid_from, valid_to, is_active, gift_enabled, updated_by, updated_at)
       VALUES (15, '2026-01-01', '2026-12-31', 1, 1, 'manager1', '2026-08-01T00:00:00Z')`
    ).run();

    const fetchMock = stubFetch();
    const response = await submitFeedback({ request: post(validBody()), env });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.promoCode).toMatch(/^HLG-/);
    expect(body.discountPercent).toBe(15);
    expect(body.giftOffered).toBe(true);

    const row = await env.DB.prepare(`SELECT * FROM feedback_responses WHERE id = ?`).bind(body.feedbackId).first();
    expect(row.promo_status).toBe('unused');
    expect(callsTo(fetchMock, BREVO_URL)).toHaveLength(1);

    const logRow = await env.DB.prepare(`SELECT channel, status FROM message_log WHERE feedback_id = ?`).bind(body.feedbackId).first();
    expect(logRow).toEqual({ channel: 'email', status: 'success' });
  });

  it('does not offer a gift when stock is zero', async () => {
    await env.DB.prepare(
      `INSERT INTO gift_inventory (id, name, stock_count, updated_at) VALUES (1, 'Túi vải', 0, '2026-08-01T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO promo_policy (discount_percent, valid_from, valid_to, is_active, gift_enabled, updated_by, updated_at)
       VALUES (15, '2026-01-01', '2026-12-31', 1, 1, 'manager1', '2026-08-01T00:00:00Z')`
    ).run();

    const response = await submitFeedback({ request: post(validBody()), env });
    const body = await response.json();
    expect(body.giftOffered).toBe(false);
  });

  it('rejects rating above 5', async () => {
    const response = await submitFeedback({ request: post(validBody({ rating: 999 })), env });
    expect(response.status).toBe(400);
  });

  it('rejects rating below 1', async () => {
    const response = await submitFeedback({ request: post(validBody({ rating: 0 })), env });
    expect(response.status).toBe(400);
  });

  it('rejects an oversized guestName', async () => {
    const response = await submitFeedback({ request: post(validBody({ guestName: 'A'.repeat(201) })), env });
    expect(response.status).toBe(400);
  });

  it('rejects an oversized comment', async () => {
    const response = await submitFeedback({ request: post(validBody({ comment: 'A'.repeat(2001) })), env });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const response = await submitFeedback({ request: post(null, { raw: 'not json' }), env });
    expect(response.status).toBe(400);
  });

  it('stores the optional experience fields when provided', async () => {
    const response = await submitFeedback({
      request: post(
        validBody({
          stayDate: '2026-08-15',
          wishesNextTime: 'Muốn thử phòng Circle House',
          favoriteActivities: ['bbq', 'ca-phe-vuon'],
        })
      ),
      env,
    });
    expect(response.status).toBe(201);

    const body = await response.json();
    const row = await env.DB.prepare(`SELECT * FROM feedback_responses WHERE id = ?`).bind(body.feedbackId).first();
    expect(row.stay_date).toBe('2026-08-15');
    expect(row.wishes_next_time).toBe('Muốn thử phòng Circle House');
    expect(JSON.parse(row.favorite_activities)).toEqual(['bbq', 'ca-phe-vuon']);
  });

  it('stores null for the optional experience fields when omitted', async () => {
    const response = await submitFeedback({ request: post(validBody()), env });
    const body = await response.json();
    const row = await env.DB.prepare(`SELECT * FROM feedback_responses WHERE id = ?`).bind(body.feedbackId).first();
    expect(row.stay_date).toBeNull();
    expect(row.wishes_next_time).toBeNull();
    expect(row.favorite_activities).toBeNull();
  });

  it('rejects a malformed stayDate', async () => {
    const response = await submitFeedback({ request: post(validBody({ stayDate: 'not-a-date' })), env });
    expect(response.status).toBe(400);
  });

  it('echoes an allowlisted Origin back in Access-Control-Allow-Origin', async () => {
    const response = await submitFeedback({
      request: post(validBody(), { headers: { Origin: 'https://hienlegarden.vn' } }),
      env,
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://hienlegarden.vn');
  });

  it('falls back to zero discount and no gift when no active policy exists', async () => {
    const response = await submitFeedback({ request: post(validBody()), env });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.discountPercent).toBe(0);
    expect(body.giftOffered).toBe(false);
  });
});

describe('POST /api/feedback — Turnstile bot protection', () => {
  async function expectRejected403(response, fetchMock) {
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: TURNSTILE_ERROR });
    expect(await rowCount()).toBe(0);
    expect(callsTo(fetchMock, BREVO_URL)).toHaveLength(0);
  }

  it('valid token: siteverify gets the secret, token and client IP; one row, one Brevo call', async () => {
    const fetchMock = stubFetch();
    const response = await submitFeedback({
      request: post(validBody(), { headers: { 'CF-Connecting-IP': '203.0.113.7' } }),
      env,
    });
    expect(response.status).toBe(201);
    expect(await rowCount()).toBe(1);

    const verifyCalls = callsTo(fetchMock, SITEVERIFY_URL);
    expect(verifyCalls).toHaveLength(1);
    const [, init] = verifyCalls[0];
    expect(init.method).toBe('POST');
    const form = new URLSearchParams(init.body);
    // Boolean comparisons so a failure never prints the values.
    expect(form.get('secret') === TEST_SECRET).toBe(true);
    expect(form.get('response') === TEST_TOKEN).toBe(true);
    expect(form.get('remoteip')).toBe('203.0.113.7');
    expect(callsTo(fetchMock, BREVO_URL)).toHaveLength(1);
  });

  it('missing token → 403, no row, no Brevo, siteverify not called', async () => {
    const fetchMock = stubFetch();
    const response = await submitFeedback({ request: post(validBody({ turnstileToken: undefined })), env });
    await expectRejected403(response, fetchMock);
    expect(callsTo(fetchMock, SITEVERIFY_URL)).toHaveLength(0);
  });

  it('empty, non-string and oversized tokens → 403 without calling siteverify', async () => {
    for (const turnstileToken of ['', 12345, { a: 1 }, 'x'.repeat(2049)]) {
      const fetchMock = stubFetch();
      const response = await submitFeedback({ request: post(validBody({ turnstileToken })), env });
      await expectRejected403(response, fetchMock);
      expect(callsTo(fetchMock, SITEVERIFY_URL)).toHaveLength(0);
    }
  });

  it('invalid token (siteverify success:false) → 403, no row', async () => {
    const fetchMock = stubFetch({
      siteverify: () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }),
    });
    const response = await submitFeedback({ request: post(validBody()), env });
    await expectRejected403(response, fetchMock);
  });

  it('success from a hostname outside TURNSTILE_ALLOWED_HOSTNAMES → 403, no row, no Brevo', async () => {
    for (const hostname of ['example.com', 'hienlegarden.vn', undefined]) {
      const fetchMock = stubFetch({ siteverify: () => Response.json({ success: true, hostname }) });
      const response = await submitFeedback({ request: post(validBody()), env });
      await expectRejected403(response, fetchMock);
    }
  });

  it('TURNSTILE_ALLOWED_HOSTNAMES unset → 403 without calling siteverify (fail closed)', async () => {
    const fetchMock = stubFetch();
    const { TURNSTILE_ALLOWED_HOSTNAMES, ...noAllowlist } = env;
    const response = await submitFeedback({ request: post(validBody()), env: noAllowlist });
    await expectRejected403(response, fetchMock);
    expect(callsTo(fetchMock, SITEVERIFY_URL)).toHaveLength(0);
  });

  it('replayed token (siteverify timeout-or-duplicate) → 403, no row', async () => {
    const fetchMock = stubFetch({
      siteverify: () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    });
    const response = await submitFeedback({ request: post(validBody()), env });
    await expectRejected403(response, fetchMock);
  });

  it('siteverify network error → 403 (fail closed)', async () => {
    const fetchMock = stubFetch({
      siteverify: () => {
        throw new TypeError('network down');
      },
    });
    const response = await submitFeedback({ request: post(validBody()), env });
    await expectRejected403(response, fetchMock);
  });

  it('siteverify HTTP 500 → 403 (fail closed)', async () => {
    const fetchMock = stubFetch({ siteverify: () => new Response('oops', { status: 500 }) });
    const response = await submitFeedback({ request: post(validBody()), env });
    await expectRejected403(response, fetchMock);
  });

  it('TURNSTILE_SECRET_KEY unset → 403 and siteverify is NOT called', async () => {
    const fetchMock = stubFetch();
    const { TURNSTILE_SECRET_KEY, ...envWithoutSecret } = env;
    const response = await submitFeedback({ request: post(validBody()), env: envWithoutSecret });
    await expectRejected403(response, fetchMock);
    expect(callsTo(fetchMock, SITEVERIFY_URL)).toHaveLength(0);
  });

  it('the 403 carries CORS headers for an allowlisted origin', async () => {
    stubFetch({ siteverify: () => Response.json({ success: false }) });
    const response = await submitFeedback({
      request: post(validBody(), { headers: { Origin: 'https://hienlegarden.vn' } }),
      env,
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://hienlegarden.vn');
  });

  it('Turnstile runs before field validation (invalid fields + bad token → 403, not 400)', async () => {
    const fetchMock = stubFetch({ siteverify: () => Response.json({ success: false }) });
    const response = await submitFeedback({ request: post(validBody({ rating: 999 })), env });
    await expectRejected403(response, fetchMock);
  });
});

describe('POST /api/feedback — voucher dedupe', () => {
  it('same phone in a different format while the voucher is active → 409, one row, one Brevo call total', async () => {
    const fetchMock = stubFetch();
    const first = await submitFeedback({ request: post(validBody({ phone: '0901 234 567', email: 'a@example.com' })), env });
    expect(first.status).toBe(201);

    const second = await submitFeedback({ request: post(validBody({ phone: '+84901234567', email: 'b@example.com' })), env });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body).toEqual({ error: DEDUPE_ERROR });
    expect(body).not.toHaveProperty('promoCode');
    expect(body).not.toHaveProperty('feedbackId');

    expect(await rowCount()).toBe(1);
    expect(callsTo(fetchMock, BREVO_URL)).toHaveLength(1);
    const logs = await env.DB.prepare('SELECT COUNT(*) AS n FROM message_log').first();
    expect(logs.n).toBe(1);
  });

  it('matches stored phones written with dots, dashes and parentheses', async () => {
    await submitFeedback({ request: post(validBody({ phone: '(090) 123-4567', email: 'a@example.com' })), env });
    const second = await submitFeedback({ request: post(validBody({ phone: '84.901.234.567', email: 'b@example.com' })), env });
    expect(second.status).toBe(409);
    expect(await rowCount()).toBe(1);
  });

  it('0084 international prefix matches the local 0 form (both directions)', async () => {
    const first = await submitFeedback({ request: post(validBody({ phone: '0084901234567', email: 'a@example.com' })), env });
    expect(first.status).toBe(201);
    const second = await submitFeedback({ request: post(validBody({ phone: '0901234567', email: 'b@example.com' })), env });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body).toEqual({ error: DEDUPE_ERROR });
    expect(await rowCount()).toBe(1);

    await env.DB.exec('DELETE FROM feedback_responses');
    const third = await submitFeedback({ request: post(validBody({ phone: '090 123 4567', email: 'c@example.com' })), env });
    expect(third.status).toBe(201);
    const fourth = await submitFeedback({ request: post(validBody({ phone: '+0084 901 234 567', email: 'd@example.com' })), env });
    expect(fourth.status).toBe(409);
    expect(await rowCount()).toBe(1);
  });

  it('same email in a different case with another phone → 409', async () => {
    const fetchMock = stubFetch();
    const first = await submitFeedback({ request: post(validBody({ phone: '0911111111', email: 'Khach@Example.com' })), env });
    expect(first.status).toBe(201);
    const second = await submitFeedback({ request: post(validBody({ phone: '0922222222', email: 'khach@example.COM' })), env });
    expect(second.status).toBe(409);
    expect(await rowCount()).toBe(1);
    expect(callsTo(fetchMock, BREVO_URL)).toHaveLength(1);
  });

  it('different phone and different email → both get vouchers', async () => {
    const a = await submitFeedback({ request: post(validBody({ phone: '0911111111', email: 'a@example.com' })), env });
    const b = await submitFeedback({ request: post(validBody({ phone: '0922222222', email: 'b@example.com' })), env });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await rowCount()).toBe(2);
  });

  it('Telegram-only submissions (no email) are deduped by phone', async () => {
    const first = await submitFeedback({ request: post(validBody({ email: undefined, wantsTelegram: true })), env });
    expect(first.status).toBe(201);
    const second = await submitFeedback({ request: post(validBody({ email: undefined, wantsTelegram: true })), env });
    expect(second.status).toBe(409);
    expect(await rowCount()).toBe(1);
  });

  it('after the first voucher is used, the same guest can get a new one', async () => {
    const first = await submitFeedback({ request: post(validBody()), env });
    expect(first.status).toBe(201);
    await env.DB.exec(`UPDATE feedback_responses SET promo_status = 'used'`);
    const second = await submitFeedback({ request: post(validBody()), env });
    expect(second.status).toBe(201);
    expect(await rowCount()).toBe(2);
  });

  it('after the first voucher expired, the same guest can get a new one', async () => {
    const first = await submitFeedback({ request: post(validBody()), env });
    expect(first.status).toBe(201);
    await env.DB.exec(`UPDATE feedback_responses SET promo_expires_at = '2020-01-01T00:00:00.000Z'`);
    const second = await submitFeedback({ request: post(validBody()), env });
    expect(second.status).toBe(201);
    expect(await rowCount()).toBe(2);
  });

  it('stores phone and email exactly as submitted (normalization is only for comparison)', async () => {
    const response = await submitFeedback({ request: post(validBody({ phone: '+84 901 234 567', email: 'Khach@Example.com' })), env });
    const body = await response.json();
    const row = await env.DB.prepare('SELECT phone, email FROM feedback_responses WHERE id = ?').bind(body.feedbackId).first();
    expect(row).toEqual({ phone: '+84 901 234 567', email: 'Khach@Example.com' });
  });
});

describe('POST /api/feedback — validation hardening', () => {
  const cases = [
    ['invalid email', { email: 'not-an-email' }],
    ['email over 254 chars', { email: `${'a'.repeat(250)}@example.com` }],
    ['non-string email', { email: ['a@example.com'] }],
    ['non-string guestName', { guestName: 12345 }],
    ['guestName of only spaces', { guestName: '    ' }],
    ['101-char guestName', { guestName: 'A'.repeat(101) }],
    ['non-string phone', { phone: 901234567 }],
    ['phone with fewer than 8 digits', { phone: '0901-23' }],
    ['phone with more than 15 digits', { phone: '0'.repeat(16) }],
    ['3001-char comment', { comment: 'A'.repeat(3001) }],
    ['non-string comment', { comment: { text: 'hi' } }],
    ['2001-char wishesNextTime', { wishesNextTime: 'A'.repeat(2001) }],
    ['non-string wishesNextTime', { wishesNextTime: 42 }],
    ['non-string stayDate', { stayDate: 20260815 }],
    ['non-integer rating', { rating: 4.5 }],
    ['string rating', { rating: '5' }],
    ['favoriteActivities not an array', { favoriteActivities: 'bbq' }],
    ['11 favoriteActivities', { favoriteActivities: Array.from({ length: 11 }, (_, i) => `a${i}`) }],
    ['non-string favoriteActivities item', { favoriteActivities: ['bbq', 7] }],
    ['101-char favoriteActivities item', { favoriteActivities: ['A'.repeat(101)] }],
  ];

  for (const [label, overrides] of cases) {
    it(`rejects ${label} with 400; no row, no Brevo`, async () => {
      const fetchMock = stubFetch();
      const response = await submitFeedback({ request: post(validBody(overrides)), env });
      expect(response.status).toBe(400);
      expect(await rowCount()).toBe(0);
      expect(callsTo(fetchMock, BREVO_URL)).toHaveLength(0);
    });
  }

  for (const [label, raw] of [
    ['an array body', '[]'],
    ['a null body', 'null'],
    ['a string body', '"hello"'],
  ]) {
    it(`rejects ${label} with 400; no row, no fetch at all`, async () => {
      const fetchMock = stubFetch();
      const response = await submitFeedback({ request: post(null, { raw }), env });
      expect(response.status).toBe(400);
      expect(await rowCount()).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('accepts a 100-char name, 10 activities, 2000-char comment and an 84-prefixed phone', async () => {
    const response = await submitFeedback({
      request: post(
        validBody({
          guestName: 'A'.repeat(100),
          phone: '+84 901 234 567',
          comment: 'A'.repeat(2000),
          favoriteActivities: Array.from({ length: 10 }, (_, i) => `a${i}`),
        })
      ),
      env,
    });
    expect(response.status).toBe(201);
  });
});

describe('POST /api/feedback — Brevo failure', () => {
  it('Brevo 500 → still 201 with the code; message_log records failed', async () => {
    const fetchMock = stubFetch({ brevo: () => new Response('down', { status: 500 }) });
    const response = await submitFeedback({ request: post(validBody()), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.promoCode).toMatch(/^HLG-/);
    expect(callsTo(fetchMock, BREVO_URL)).toHaveLength(1);
    const logRow = await env.DB.prepare('SELECT status FROM message_log WHERE feedback_id = ?').bind(body.feedbackId).first();
    expect(logRow.status).toBe('failed');
    expect(await rowCount()).toBe(1);
  });

  it('BREVO_API_KEY unset → still 201 with the voucher; message_log email failed; no request to Brevo (L-6)', async () => {
    const { BREVO_API_KEY, ...envWithoutBrevo } = env;
    expect(BREVO_API_KEY).toBe('test-key'); // the shared env does carry a key; this test removes it
    expect('BREVO_API_KEY' in envWithoutBrevo).toBe(false);
    const fetchMock = stubFetch();
    const response = await submitFeedback({ request: post(validBody()), env: envWithoutBrevo });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.promoCode).toMatch(/^HLG-/);
    expect(await rowCount()).toBe(1);
    const logs = await env.DB.prepare('SELECT feedback_id, channel, status FROM message_log').all();
    expect(logs.results).toEqual([{ feedback_id: body.feedbackId, channel: 'email', status: 'failed' }]);
    expect(callsTo(fetchMock, BREVO_URL)).toHaveLength(0);
    expect(callsTo(fetchMock, SITEVERIFY_URL)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
