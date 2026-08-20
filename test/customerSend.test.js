import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as sendMessage } from '../functions/api/customers/[id]/send.js';
import { createSession } from '../lib/auth.js';

let receptionToken, emailTemplateId, telegramTemplateId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM feedback_responses');
  await env.DB.exec('DELETE FROM message_log');
  await env.DB.exec('DELETE FROM message_templates');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 2);

  await env.DB.prepare(
    `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, telegram_chat_id, rating, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed)
     VALUES ('fb-1', '2026-08-20T10:00:00Z', 'Nguyễn Văn A', '0900000001', 'a@example.com', NULL, 5, 1, 'HLG-AAAA', 10, '2099-01-01T00:00:00Z', 'unused', 0, 0)`
  ).run();

  const emailT = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('E', 'email', 'Chào {guestName}', 'Mã: {promoCode}', 0, 'system', '2026-08-01T00:00:00Z')`).run();
  const tgT = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('T', 'telegram', NULL, 'Mã: {promoCode}', 0, 'system', '2026-08-01T00:00:00Z')`).run();
  emailTemplateId = emailT.meta.last_row_id;
  telegramTemplateId = tgT.meta.last_row_id;

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});

function authedRequest(url, body) {
  return new Request(url, { method: 'POST', headers: { Cookie: `session=${receptionToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/customers/:feedbackId/send', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await sendMessage({ request: new Request('https://x', { method: 'POST' }), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(401);
  });

  it('renders and sends an email template, logging success', async () => {
    const response = await sendMessage({ request: authedRequest('https://x', { templateId: emailTemplateId }), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    const log = await env.DB.prepare(`SELECT channel, status, template_id AS templateId, sent_by AS sentBy FROM message_log WHERE feedback_id = 'fb-1'`).first();
    expect(log).toEqual({ channel: 'email', status: 'success', templateId: emailTemplateId, sentBy: 'le_tan_a' });
  });

  it('rejects sending a telegram template to a guest with no telegram_chat_id (400)', async () => {
    const response = await sendMessage({ request: authedRequest('https://x', { templateId: telegramTemplateId }), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown customer', async () => {
    const response = await sendMessage({ request: authedRequest('https://x', { templateId: emailTemplateId }), env, params: { id: 'unknown' } });
    expect(response.status).toBe(404);
  });

  it('returns 404 for an unknown template', async () => {
    const response = await sendMessage({ request: authedRequest('https://x', { templateId: 999999 }), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(404);
  });

  it('logs a failed send when the provider call fails, and still returns ok:false without a 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));
    const response = await sendMessage({ request: authedRequest('https://x', { templateId: emailTemplateId }), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);

    const log = await env.DB.prepare(`SELECT status FROM message_log WHERE feedback_id = 'fb-1'`).first();
    expect(log.status).toBe('failed');
  });
});
