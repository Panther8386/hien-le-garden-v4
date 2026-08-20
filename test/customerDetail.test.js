import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getCustomer } from '../functions/api/customers/[id].js';
import { createSession } from '../lib/auth.js';

let managerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM feedback_responses');
  await env.DB.exec('DELETE FROM message_log');
  await env.DB.exec('DELETE FROM message_templates');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);

  await env.DB.prepare(
    `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, rating, comment, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed, stay_date, wishes_next_time, favorite_activities)
     VALUES ('fb-1', '2026-08-20T10:00:00Z', 'Nguyễn Văn A', '0900000001', 'a@example.com', 5, 'Rất tốt', 1, 'HLG-AAAA', 10, '2099-01-01T00:00:00Z', 'unused', 0, 0, '2026-08-15', 'Muốn thử BBQ', '["bbq","ca-phe-vuon"]')`
  ).run();

  const template = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('Email mặc định', 'email', 's', 'b', 1, 'system', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(
    `INSERT INTO message_log (feedback_id, template_id, channel, sent_by, status, sent_at) VALUES ('fb-1', ?, 'email', 'system', 'success', '2026-08-20T10:00:05Z')`
  ).bind(template.meta.last_row_id).run();
});

function authedRequest(url) {
  return new Request(url, { headers: { Cookie: `session=${managerToken}` } });
}

describe('GET /api/customers/:feedbackId', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await getCustomer({ request: new Request('https://x/api/customers/fb-1'), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(401);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await getCustomer({ request: authedRequest('https://x/api/customers/unknown'), env, params: { id: 'unknown' } });
    expect(response.status).toBe(404);
  });

  it('returns full detail with parsed favoriteActivities and message history', async () => {
    const response = await getCustomer({ request: authedRequest('https://x/api/customers/fb-1'), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.comment).toBe('Rất tốt');
    expect(body.stayDate).toBe('2026-08-15');
    expect(body.wishesNextTime).toBe('Muốn thử BBQ');
    expect(body.favoriteActivities).toEqual(['bbq', 'ca-phe-vuon']);
    expect(body.messageHistory).toHaveLength(1);
    expect(body.messageHistory[0]).toMatchObject({ channel: 'email', status: 'success', templateName: 'Email mặc định' });
  });

  it('still returns a message history row when its template has been deleted', async () => {
    await env.DB.prepare('DELETE FROM message_templates').run();

    const response = await getCustomer({ request: authedRequest('https://x/api/customers/fb-1'), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messageHistory).toHaveLength(1);
    expect(body.messageHistory[0]).toMatchObject({ channel: 'email', status: 'success', templateName: null });
  });
});
