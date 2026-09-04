import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listSessions, onRequestPost as createSession } from '../functions/api/gio-xanh-sessions/index.js';
import { onRequestGet as getSession } from '../functions/api/gio-xanh-sessions/[id]/index.js';
import { createSession as createStaffSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;
let roomId1, roomId2;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM gio_xanh_session_items');
  await env.DB.exec('DELETE FROM gio_xanh_sessions');
  await env.DB.exec('DELETE FROM audit_log');
  await env.DB.exec(`DELETE FROM finance_transactions WHERE category = 'gio_xanh_hien_le'`);

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_gx', 'x', 'manager', '2026-09-04T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_gx', 'x', 'reception', '2026-09-04T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_gx', 'x', 'admin', '2026-09-04T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_gx', 'x', 'observer', '2026-09-04T00:00:00Z')`).run();
  managerToken = await createStaffSession(env.DB, m.meta.last_row_id);
  receptionToken = await createStaffSession(env.DB, r.meta.last_row_id);
  adminToken = await createStaffSession(env.DB, a.meta.last_row_id);
  observerToken = await createStaffSession(env.DB, o.meta.last_row_id);

  const rooms = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 ORDER BY id LIMIT 2`).all();
  roomId1 = rooms.results[0].id;
  roomId2 = rooms.results[1].id;
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('POST /api/gio-xanh-sessions', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await createSession({ request: new Request('https://x/api/gio-xanh-sessions', { method: 'POST' }), env });
    expect(response.status).toBe(401);
  });

  it('rejects observer (403)', async () => {
    const response = await createSession({ request: authedRequest('https://x/api/gio-xanh-sessions', observerToken, 'POST', { roomId: roomId1, guestName: 'Nguyễn Văn A' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects a missing guestName (400)', async () => {
    const response = await createSession({ request: authedRequest('https://x/api/gio-xanh-sessions', receptionToken, 'POST', { roomId: roomId1 }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a non-existent room (400)', async () => {
    const response = await createSession({ request: authedRequest('https://x/api/gio-xanh-sessions', receptionToken, 'POST', { roomId: 999999, guestName: 'Nguyễn Văn A' }), env });
    expect(response.status).toBe(400);
  });

  it('opens a session with status=open', async () => {
    const response = await createSession({ request: authedRequest('https://x/api/gio-xanh-sessions', receptionToken, 'POST', { roomId: roomId1, guestName: 'Nguyễn Văn A', phone: '0900000001' }), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    const row = await env.DB.prepare(`SELECT room_id, guest_name, phone, status, opened_by FROM gio_xanh_sessions WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ room_id: roomId1, guest_name: 'Nguyễn Văn A', phone: '0900000001', status: 'open', opened_by: 'le_tan_gx' });
  });

  it('rejects opening a second session on a room that already has one open (400)', async () => {
    await createSession({ request: authedRequest('https://x/api/gio-xanh-sessions', receptionToken, 'POST', { roomId: roomId1, guestName: 'Khách 1' }), env });
    const response = await createSession({ request: authedRequest('https://x/api/gio-xanh-sessions', receptionToken, 'POST', { roomId: roomId1, guestName: 'Khách 2' }), env });
    expect(response.status).toBe(400);
  });

  it('enforces one-open-session-per-room at the DB level via the partial unique index', async () => {
    await env.DB.prepare(
      `INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at) VALUES (?, 'Khách 1', 'open', 'le_tan_gx', '2026-09-04T08:00:00Z')`
    ).bind(roomId1).run();

    await expect(
      env.DB.prepare(
        `INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at) VALUES (?, 'Khách 2', 'open', 'le_tan_gx', '2026-09-04T08:01:00Z')`
      ).bind(roomId1).run()
    ).rejects.toThrow();
  });
});

describe('GET /api/gio-xanh-sessions', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listSessions({ request: new Request('https://x/api/gio-xanh-sessions'), env });
    expect(response.status).toBe(401);
  });

  it('defaults to status=open and computes currentTotal from posted items only', async () => {
    const session = await env.DB.prepare(`INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at) VALUES (?, 'Khách A', 'open', 'le_tan_gx', '2026-09-04T08:00:00Z')`).bind(roomId1).run();
    const sessionId = session.meta.last_row_id;
    await env.DB.prepare(`INSERT INTO gio_xanh_session_items (session_id, source, source_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'gio_combo', 1, 'Giờ Đầu Tiên', 130000, 1, 130000, 'posted', 'le_tan_gx', '2026-09-04T08:05:00Z')`).bind(sessionId).run();
    await env.DB.prepare(`INSERT INTO gio_xanh_session_items (session_id, source, source_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'mon_an_uong', 1, 'Cà phê', 25000, 1, 25000, 'voided', 'le_tan_gx', '2026-09-04T08:06:00Z')`).bind(sessionId).run();

    const response = await listSessions({ request: authedRequest('https://x/api/gio-xanh-sessions', observerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: sessionId, roomId: roomId1, guestName: 'Khách A', status: 'open', currentTotal: 130000 });
  });

  it('rejects an invalid status query param (400)', async () => {
    const response = await listSessions({ request: authedRequest('https://x/api/gio-xanh-sessions?status=deleted', receptionToken, 'GET'), env });
    expect(response.status).toBe(400);
  });
});

describe('GET /api/gio-xanh-sessions/:id', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await getSession({ request: new Request('https://x/api/gio-xanh-sessions/1'), env, params: { id: '1' } });
    expect(response.status).toBe(401);
  });

  it('404s for a non-existent id', async () => {
    const response = await getSession({ request: authedRequest('https://x/api/gio-xanh-sessions/999999', receptionToken, 'GET'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('returns session detail including its items and joined room name', async () => {
    const session = await env.DB.prepare(`INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at) VALUES (?, 'Khách B', 'open', 'le_tan_gx', '2026-09-04T08:00:00Z')`).bind(roomId1).run();
    const sessionId = session.meta.last_row_id;
    await env.DB.prepare(`INSERT INTO gio_xanh_session_items (session_id, source, source_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'gio_combo', 1, 'Giờ Đầu Tiên', 130000, 1, 130000, 'posted', 'le_tan_gx', '2026-09-04T08:05:00Z')`).bind(sessionId).run();

    const response = await getSession({ request: authedRequest(`https://x/api/gio-xanh-sessions/${sessionId}`, observerToken, 'GET'), env, params: { id: String(sessionId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.guestName).toBe('Khách B');
    expect(body.roomId).toBe(roomId1);
    expect(body.roomName).toBeTruthy();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ source: 'gio_combo', name: 'Giờ Đầu Tiên', unitPrice: 130000, quantity: 1, amount: 130000, status: 'posted' });
  });
});
