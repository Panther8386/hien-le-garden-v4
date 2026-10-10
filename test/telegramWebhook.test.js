import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as webhook } from '../functions/api/telegram/webhook.js';
import { onRequestPost as createBooking } from '../functions/api/bookings/index.js';
vi.mock('../lib/turnstile.js', async (original) => ({ ...await original(), verifyTurnstile: vi.fn(async () => true) }));

const WEBHOOK_URL = 'https://crm.hienlegarden.vn/api/telegram/webhook';
const SECRET = 'test-secret';
const TOKEN = 'test-token';

// Dummy values only — never real secrets.
function testEnv(overrides = {}) {
  return { ...env, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_TOKEN: TOKEN, ...overrides };
}

const NO_HEADER = Symbol('no header');

function webhookReq(update, secretHeader = SECRET) {
  const headers = { 'Content-Type': 'application/json' };
  if (secretHeader !== NO_HEADER) headers['X-Telegram-Bot-Api-Secret-Token'] = secretHeader;
  return new Request(WEBHOOK_URL, { method: 'POST', headers, body: JSON.stringify(update) });
}

async function snapshot() {
  const settings = await env.DB.prepare(`SELECT id, booking_notify_chat_id, updated_at FROM notification_settings ORDER BY id`).all();
  const feedback = await env.DB.prepare(`SELECT id, telegram_chat_id FROM feedback_responses ORDER BY id`).all();
  const audit = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log`).first();
  const messages = await env.DB.prepare(`SELECT COUNT(*) AS n FROM message_log`).first();
  return { settings: settings.results, feedback: feedback.results, audit: audit.n, messages: messages.n };
}

async function seedDestination(chatId = '111') {
  await env.DB.prepare(`INSERT INTO notification_settings (booking_notify_chat_id, updated_at) VALUES (?, '2026-08-01T00:00:00Z')`).bind(chatId).run();
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM feedback_responses');
  await env.DB.exec('DELETE FROM notification_settings');
  await env.DB.exec('DELETE FROM audit_log');
  await env.DB.exec('DELETE FROM message_log');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.prepare(
    `INSERT INTO feedback_responses
     (id, submitted_at, guest_name, phone, wants_telegram, rating, consent_given,
      promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed)
     VALUES ('fb-1', '2026-08-19T10:00:00Z', 'Nguyễn Văn A', '0900000000', 1, 5, 1,
             'HLG-4F7K9P', 15, '2027-02-19T00:00:00Z', 'unused', 0, 0)`
  ).run();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/telegram/webhook — authentication', () => {
  const staffUpdate = { update_id: 10001, message: { message_id: 7, date: 1790000000, chat: { id: 999, type: 'private' }, from: { id: 999, is_bot: false, first_name: 'X' }, text: '/start staff_booking_notify' } };

  async function expectRejectedWithoutSideEffects(request, envOverrides = {}) {
    await seedDestination('111');
    const before = await snapshot();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await webhook({ request, env: testEnv({ TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS: '999', ...envOverrides }) });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('unauthorized');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  }

  it('rejects a request with no secret header (401, no DB change, no fetch, no audit)', async () => {
    await expectRejectedWithoutSideEffects(webhookReq(staffUpdate, NO_HEADER));
  });

  it('rejects a request with a wrong secret header (401, no DB change, no fetch, no audit)', async () => {
    await expectRejectedWithoutSideEffects(webhookReq(staffUpdate, 'wrong-secret'));
  });

  it('fails closed when TELEGRAM_WEBHOOK_SECRET is unset, even with a header present', async () => {
    await expectRejectedWithoutSideEffects(webhookReq(staffUpdate, SECRET), { TELEGRAM_WEBHOOK_SECRET: undefined });
  });

  it('fails closed when TELEGRAM_WEBHOOK_SECRET is empty and the header is empty', async () => {
    await expectRejectedWithoutSideEffects(webhookReq(staffUpdate, ''), { TELEGRAM_WEBHOOK_SECRET: '' });
  });

  it('forged update: a valid-looking Telegram guest deep-link body without/with wrong header is rejected', async () => {
    const guestUpdate = { update_id: 10002, message: { message_id: 8, date: 1790000000, chat: { id: 4242, type: 'private' }, text: '/start fb-1' } };
    await expectRejectedWithoutSideEffects(webhookReq(guestUpdate, NO_HEADER));
    await env.DB.exec('DELETE FROM notification_settings');
    await expectRejectedWithoutSideEffects(webhookReq(guestUpdate, 'test-secreT'));
    const row = await env.DB.prepare(`SELECT telegram_chat_id FROM feedback_responses WHERE id = 'fb-1'`).first();
    expect(row.telegram_chat_id).toBeNull();
  });

  it('does not read the body when rejecting (body stays unused)', async () => {
    const request = webhookReq(staffUpdate, NO_HEADER);
    const response = await webhook({ request, env: testEnv() });
    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  it('after a rejected takeover attempt, new bookings still notify the ORIGINAL chat', async () => {
    await expectRejectedWithoutSideEffects(webhookReq(staffUpdate, 'wrong-secret'));

    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const bookingReq = new Request('https://hienlegarden.vn/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestName: 'Khách Thử', phone: '0900000009', roomType: 'circle', checkIn: '2099-01-01', checkOut: '2099-01-03' }),
    });
    const response = await createBooking({ request: bookingReq, env: testEnv() });
    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).chat_id).toBe('111');
  });
});

describe('POST /api/telegram/webhook — guest deep link (authenticated)', () => {
  it('links the chat id to the feedback row and sends the promo message on /start', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await webhook({ request: webhookReq({ message: { chat: { id: 987654 }, text: '/start fb-1' } }), env: testEnv() });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT telegram_chat_id FROM feedback_responses WHERE id = 'fb-1'`).first();
    expect(row.telegram_chat_id).toBe('987654');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).chat_id).toBe('987654');

    const logRow = await env.DB.prepare(`SELECT channel, status FROM message_log WHERE feedback_id = 'fb-1'`).first();
    expect(logRow).toEqual({ channel: 'telegram', status: 'success' });
  });

  it('ignores updates with an unknown feedback id without throwing', async () => {
    const response = await webhook({ request: webhookReq({ message: { chat: { id: 1 }, text: '/start unknown-id' } }), env: testEnv() });
    expect(response.status).toBe(200);
  });

  it('returns 200 for malformed payload with message text but no chat', async () => {
    const response = await webhook({ request: webhookReq({ message: { text: '/start fb-1' } }), env: testEnv() });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT telegram_chat_id FROM feedback_responses WHERE id = 'fb-1'`).first();
    expect(row?.telegram_chat_id).toBeNull();
  });
});

describe('POST /api/telegram/webhook — staff_booking_notify destination (authenticated)', () => {
  it('ignores /start staff_booking_notify from a chat NOT in the allowlist (destination unchanged, no reply, no audit)', async () => {
    await seedDestination('111');
    const before = await snapshot();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await webhook({
      request: webhookReq({ message: { chat: { id: 999 }, text: '/start staff_booking_notify' } }),
      env: testEnv({ TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS: '555, -1001234567890' }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it('ignores /start staff_booking_notify when the allowlist is unset or empty', async () => {
    await seedDestination('111');
    const before = await snapshot();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    for (const allow of [undefined, '', ' , ']) {
      const response = await webhook({
        request: webhookReq({ message: { chat: { id: 111 }, text: '/start staff_booking_notify' } }),
        env: testEnv({ TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS: allow }),
      });
      expect(response.status).toBe(200);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it('does not fall through to the guest lookup for a non-allowed staff_booking_notify', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await webhook({ request: webhookReq({ message: { chat: { id: 999 }, text: '/start staff_booking_notify' } }), env: testEnv() });
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM notification_settings`).first();
    expect(count.n).toBe(0);
    const feedbackRow = await env.DB.prepare(`SELECT telegram_chat_id FROM feedback_responses WHERE id = 'fb-1'`).first();
    expect(feedbackRow.telegram_chat_id).toBeNull();
  });

  it('an allowed chat changes the destination, gets a confirmation, and an audit row is written', async () => {
    await seedDestination('111');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await webhook({
      request: webhookReq({ message: { chat: { id: 555 }, text: '/start staff_booking_notify' } }),
      env: testEnv({ TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS: ' 777 , 555 ' }),
    });
    expect(response.status).toBe(200);

    const { results } = await env.DB.prepare(`SELECT booking_notify_chat_id FROM notification_settings`).all();
    expect(results).toEqual([{ booking_notify_chat_id: '555' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).chat_id).toBe('555');

    const audit = await env.DB.prepare(`SELECT * FROM audit_log`).all();
    expect(audit.results).toHaveLength(1);
    const row = audit.results[0];
    expect(row).toMatchObject({
      action_type: 'notification_destination_change',
      entity_type: 'notification_settings',
      entity_label: 'booking_notify_chat_id',
      old_value: '111',
      new_value: '555',
      actor: 'telegram:555',
    });
    for (const value of Object.values(row)) {
      expect(String(value)).not.toContain(SECRET);
      expect(String(value)).not.toContain(TOKEN);
    }
  });

  it('an allowed chat with no prior destination inserts the row and audits old_value NULL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const response = await webhook({
      request: webhookReq({ message: { chat: { id: -1001234567890 }, text: '/start@HienLeGardenbot staff_booking_notify' } }),
      env: testEnv({ TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS: '-1001234567890' }),
    });
    expect(response.status).toBe(200);
    const { results } = await env.DB.prepare(`SELECT booking_notify_chat_id FROM notification_settings`).all();
    expect(results).toEqual([{ booking_notify_chat_id: '-1001234567890' }]);
    const audit = await env.DB.prepare(`SELECT old_value, new_value, actor FROM audit_log`).all();
    expect(audit.results).toEqual([{ old_value: null, new_value: '-1001234567890', actor: 'telegram:-1001234567890' }]);
  });

  it('re-registering the same allowed chat keeps one row and writes no audit row (no change)', async () => {
    await seedDestination('555');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await webhook({
      request: webhookReq({ message: { chat: { id: 555 }, text: '/start staff_booking_notify' } }),
      env: testEnv({ TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS: '555' }),
    });
    expect(response.status).toBe(200);
    const { results } = await env.DB.prepare(`SELECT booking_notify_chat_id FROM notification_settings`).all();
    expect(results).toEqual([{ booking_notify_chat_id: '555' }]);
    const audit = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log`).first();
    expect(audit.n).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('switching between two allowed chats updates the single existing row', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const e = testEnv({ TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS: '555,666' });
    await webhook({ request: webhookReq({ message: { chat: { id: 555 }, text: '/start staff_booking_notify' } }), env: e });
    await webhook({ request: webhookReq({ message: { chat: { id: 666 }, text: '/start staff_booking_notify' } }), env: e });

    const { results } = await env.DB.prepare(`SELECT booking_notify_chat_id FROM notification_settings`).all();
    expect(results).toEqual([{ booking_notify_chat_id: '666' }]);
    const audit = await env.DB.prepare(`SELECT old_value, new_value FROM audit_log ORDER BY id`).all();
    expect(audit.results).toEqual([{ old_value: null, new_value: '555' }, { old_value: '555', new_value: '666' }]);
  });

  it('allowlist match is exact (no substring/prefix match)', async () => {
    await seedDestination('111');
    const before = await snapshot();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await webhook({
      request: webhookReq({ message: { chat: { id: 55 }, text: '/start staff_booking_notify' } }),
      env: testEnv({ TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS: '555' }),
    });
    expect(await snapshot()).toEqual(before);
  });
});
