import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as activate } from '../functions/api/templates/[id]/activate.js';
import { onRequestPost as deactivate } from '../functions/api/templates/[id]/deactivate.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, templateAId, templateBId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM message_templates');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);

  const a = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('A', 'email', 's', 'b', 1, 'system', '2026-08-01T00:00:00Z')`).run();
  const b = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('B', 'email', 's', 'b', 0, 'system', '2026-08-01T00:00:00Z')`).run();
  templateAId = a.meta.last_row_id;
  templateBId = b.meta.last_row_id;
});

function authedRequest(url, token, method) {
  return new Request(url, { method, headers: { Cookie: `session=${token}` } });
}

describe('POST /api/templates/:id/activate', () => {
  it('activates the target template and deactivates the other one on the same channel', async () => {
    const response = await activate({ request: authedRequest(`https://x/api/templates/${templateBId}/activate`, managerToken, 'POST'), env, params: { id: String(templateBId) } });
    expect(response.status).toBe(200);

    const a = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(templateAId).first();
    const b = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(templateBId).first();
    expect(a.is_active).toBe(0);
    expect(b.is_active).toBe(1);
  });

  it('rejects a reception account (403)', async () => {
    const response = await activate({ request: authedRequest(`https://x/api/templates/${templateBId}/activate`, receptionToken, 'POST'), env, params: { id: String(templateBId) } });
    expect(response.status).toBe(403);
  });
});

describe('POST /api/templates/:id/deactivate', () => {
  it('deactivates the target template without activating any other', async () => {
    const response = await deactivate({ request: authedRequest(`https://x/api/templates/${templateAId}/deactivate`, managerToken, 'POST'), env, params: { id: String(templateAId) } });
    expect(response.status).toBe(200);

    const a = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(templateAId).first();
    const b = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(templateBId).first();
    expect(a.is_active).toBe(0);
    expect(b.is_active).toBe(0);
  });

  it('rejects a reception account (403)', async () => {
    const response = await deactivate({ request: authedRequest(`https://x/api/templates/${templateAId}/deactivate`, receptionToken, 'POST'), env, params: { id: String(templateAId) } });
    expect(response.status).toBe(403);
  });
});
