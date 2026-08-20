import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listTemplates, onRequestPost as createTemplate } from '../functions/api/templates/index.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM message_templates');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);
});

function authedRequest(url, token, method, body) {
  return new Request(url, {
    method,
    headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/templates', () => {
  it('lets reception read the template list', async () => {
    await createTemplate({ request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'A', channel: 'email', subject: 's', body: 'b' }), env });
    const response = await listTemplates({ request: authedRequest('https://x/api/templates', receptionToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ name: 'A', channel: 'email', isActive: false });
  });

  it('rejects unauthenticated requests', async () => {
    const response = await listTemplates({ request: new Request('https://x/api/templates'), env });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/templates', () => {
  it('lets a manager create an email template', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'Lời cảm ơn', channel: 'email', subject: 'Cảm ơn bạn', body: 'Xin chào {guestName}' }),
      env,
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeTypeOf('number');
  });

  it('rejects a reception account (403)', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', receptionToken, 'POST', { name: 'x', channel: 'email', subject: 's', body: 'b' }),
      env,
    });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid channel', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'x', channel: 'sms', subject: 's', body: 'b' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects an email template with no subject', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'x', channel: 'email', subject: '', body: 'b' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects an empty body', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'x', channel: 'telegram', body: '' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/templates', { method: 'POST', headers: { Cookie: `session=${managerToken}` }, body: 'not json' });
    const response = await createTemplate({ request, env });
    expect(response.status).toBe(400);
  });

  it('a new template always starts inactive', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'x', channel: 'telegram', body: 'b' }),
      env,
    });
    const { id } = await response.json();
    const row = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(id).first();
    expect(row.is_active).toBe(0);
  });
});
