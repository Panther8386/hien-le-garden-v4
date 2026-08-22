import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getNotificationSettings } from '../functions/api/notification-settings.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM notification_settings');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);
});

function authedRequest(url, token) {
  return new Request(url, { headers: { Cookie: `session=${token}` } });
}

describe('GET /api/notification-settings', () => {
  it('returns connected:false when no chat id has ever been registered', async () => {
    const response = await getNotificationSettings({ request: authedRequest('https://x/api/notification-settings', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ connected: false });
  });

  it('returns connected:true after a chat id has been registered', async () => {
    await env.DB.prepare(`INSERT INTO notification_settings (booking_notify_chat_id, updated_at) VALUES ('555', '2026-08-01T00:00:00Z')`).run();
    const response = await getNotificationSettings({ request: authedRequest('https://x/api/notification-settings', managerToken), env });
    const body = await response.json();
    expect(body).toEqual({ connected: true });
  });

  it('does not leak the raw chat id', async () => {
    await env.DB.prepare(`INSERT INTO notification_settings (booking_notify_chat_id, updated_at) VALUES ('555', '2026-08-01T00:00:00Z')`).run();
    const response = await getNotificationSettings({ request: authedRequest('https://x/api/notification-settings', managerToken), env });
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('555');
  });

  it('lets reception read this too (matches other config-view permissions)', async () => {
    const response = await getNotificationSettings({ request: authedRequest('https://x/api/notification-settings', receptionToken), env });
    expect(response.status).toBe(200);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await getNotificationSettings({ request: new Request('https://x/api/notification-settings'), env });
    expect(response.status).toBe(401);
  });
});
