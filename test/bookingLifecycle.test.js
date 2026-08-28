import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as confirmBooking } from '../functions/api/bookings/[id]/confirm.js';
import { onRequestPost as rejectBooking } from '../functions/api/bookings/[id]/reject.js';
import { onRequestPost as checkInBooking } from '../functions/api/bookings/[id]/check-in.js';
import { onRequestPost as checkOutBooking } from '../functions/api/bookings/[id]/check-out.js';
import { onRequestPost as cancelBooking } from '../functions/api/bookings/[id]/cancel.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, circleRoomId, otherCircleRoomId, vipRoomId, pendingBookingId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);

  const rooms = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 2`).all();
  circleRoomId = rooms.results[0].id;
  otherCircleRoomId = rooms.results[1].id;
  const vipRoom = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
  vipRoomId = vipRoom.id;

  const inserted = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
     VALUES ('Nguyễn Văn A', '0900000001', 'circle', '2099-01-01', '2099-01-03', 'pending', 'website', '2026-08-01T00:00:00Z')`
  ).run();
  pendingBookingId = inserted.meta.last_row_id;
});

function authedPost(url, token, body) {
  return new Request(url, {
    method: 'POST',
    headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function createConfirmedBookingWithDeposit({ checkIn, depositAmount }) {
  const checkOut = new Date(checkIn);
  checkOut.setUTCDate(checkOut.getUTCDate() + 1);
  const result = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, deposit_amount, created_at) VALUES (?, ?, 'triangle', ?, ?, 'confirmed', 'website', ?, ?)`
  ).bind('Refund Test Guest', '0900000002', checkIn, checkOut.toISOString().slice(0, 10), depositAmount, new Date().toISOString()).run();
  return { id: result.meta.last_row_id };
}

describe('POST /api/bookings/:id/confirm', () => {
  it('confirms a pending booking and assigns the chosen room', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT status, room_id, confirmed_by FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row).toEqual({ status: 'confirmed', room_id: circleRoomId, confirmed_by: 'quan_ly_a' });
  });

  it('lets a reception account confirm too', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, receptionToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await confirmBooking({
      request: new Request(`https://x/api/bookings/${pendingBookingId}/confirm`, { method: 'POST', body: JSON.stringify({ rooms: [{ roomType: 'circle', roomId: circleRoomId }] }) }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(401);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await confirmBooking({
      request: authedPost('https://x/api/bookings/999999/confirm', managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('rejects confirming a booking that is not pending', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: otherCircleRoomId }] }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 409 when the chosen room already has an overlapping confirmed booking', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('Khác', '090', 'circle', ?, '2099-01-02', '2099-01-04', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(circleRoomId).run();

    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(409);
  });

  it('rejects a missing rooms array with 400 instead of crashing', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, {}),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects an empty rooms array', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [] }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a room entry with an invalid roomType', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'deluxe', roomId: circleRoomId }] }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects duplicate room ids in the same request', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }, { roomType: 'circle', roomId: circleRoomId }] }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('confirms a request into multiple rooms across different types (a group booking), creating one booking per extra room', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, {
        rooms: [
          { roomType: 'circle', roomId: circleRoomId },
          { roomType: 'circle', roomId: otherCircleRoomId },
          { roomType: 'vip', roomId: vipRoomId },
        ],
      }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const original = await env.DB.prepare(`SELECT status, room_type, room_id, confirmed_by FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(original).toEqual({ status: 'confirmed', room_type: 'circle', room_id: circleRoomId, confirmed_by: 'quan_ly_a' });

    const { results: all } = await env.DB.prepare(`SELECT room_id, room_type, status, guest_name, phone, check_in, check_out FROM bookings ORDER BY id`).all();
    expect(all).toHaveLength(3);
    expect(all.every((b) => b.status === 'confirmed')).toBe(true);
    expect(all.every((b) => b.guest_name === 'Nguyễn Văn A' && b.phone === '0900000001')).toBe(true);
    expect(all.every((b) => b.check_in === '2099-01-01' && b.check_out === '2099-01-03')).toBe(true);
    expect(new Set(all.map((b) => b.room_id))).toEqual(new Set([circleRoomId, otherCircleRoomId, vipRoomId]));
  });

  it('rejects the whole multi-room confirm if any one room has a conflict, leaving the original still pending', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('Khác', '090', 'vip', ?, '2099-01-01', '2099-01-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(vipRoomId).run();

    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, {
        rooms: [
          { roomType: 'circle', roomId: circleRoomId },
          { roomType: 'vip', roomId: vipRoomId },
        ],
      }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(409);

    const original = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(original.status).toBe('pending');
    const { results: all } = await env.DB.prepare(`SELECT id FROM bookings`).all();
    expect(all).toHaveLength(2); // the original pending + the pre-existing "Khác" booking -- no partial rows created
  });
});

describe('POST /api/bookings/:id/reject', () => {
  it('cancels a pending booking', async () => {
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row.status).toBe('cancelled');
  });

  it('accepts an optional reason', async () => {
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken, { reason: 'Hết phòng' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT cancel_reason FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row.cancel_reason).toBe('Hết phòng');
  });

  it('works with no request body at all', async () => {
    const response = await rejectBooking({
      request: new Request(`https://x/api/bookings/${pendingBookingId}/reject`, { method: 'POST', headers: { Cookie: `session=${managerToken}` } }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
  });

  it('rejects rejecting a booking that is not pending', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await rejectBooking({
      request: authedPost('https://x/api/bookings/999999/reject', managerToken),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/bookings/:id/check-in', () => {
  it('checks in a confirmed booking', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });

    const response = await checkInBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-in`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row.status).toBe('checked_in');
  });

  it('rejects checking in a booking that is still pending', async () => {
    const response = await checkInBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-in`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await checkInBooking({
      request: authedPost('https://x/api/bookings/999999/check-in', managerToken),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await checkInBooking({
      request: new Request(`https://x/api/bookings/${pendingBookingId}/check-in`, { method: 'POST' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/bookings/:id/cancel', () => {
  it('cancels a confirmed booking', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });

    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/cancel`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row.status).toBe('cancelled');
  });

  it('accepts an optional reason', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });

    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/cancel`, managerToken, { reason: 'Khách đổi lịch' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT cancel_reason FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row.cancel_reason).toBe('Khách đổi lịch');
  });

  it('writes an audit_log row with the refund summary and reason', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });
    await env.DB.exec('DELETE FROM cancellation_policy_tier');
    await env.DB.prepare(`INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, updated_by, updated_at) VALUES (0, 50, 'seed', '2026-08-01T00:00:00Z')`).run();
    await env.DB.prepare(`UPDATE bookings SET deposit_amount = 100000 WHERE id = ?`).bind(pendingBookingId).run();

    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/cancel`, managerToken, { reason: 'Khách đổi lịch' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'booking_cancel' AND entity_id = ?`).bind(pendingBookingId).first();
    expect(row.entity_type).toBe('booking');
    expect(row.entity_label).toBe('Nguyễn Văn A');
    expect(row.old_value).toBe('confirmed');
    expect(row.new_value).toBe('cancelled — hoàn 50% (50000 đ) — Lý do: Khách đổi lịch');
    expect(row.actor).toBe('quan_ly_a');
  });

  it('writes an audit_log row without a reason suffix when none is given', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });

    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/cancel`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT new_value FROM audit_log WHERE action_type = 'booking_cancel' AND entity_id = ?`).bind(pendingBookingId).first();
    expect(row.new_value).not.toContain('Lý do');
  });

  it('lets a reception account cancel too', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });

    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/cancel`, receptionToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
  });

  it('rejects cancelling a booking that is still pending', async () => {
    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/cancel`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects cancelling a booking that is already checked in', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });
    await checkInBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-in`, managerToken), env, params: { id: String(pendingBookingId) } });

    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/cancel`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await cancelBooking({
      request: new Request(`https://x/api/bookings/${pendingBookingId}/cancel`, { method: 'POST' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(401);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await cancelBooking({
      request: authedPost('https://x/api/bookings/999999/cancel', managerToken),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('computes 0% refund when no cancellation_policy_tier rows exist', async () => {
    await env.DB.exec('DELETE FROM cancellation_policy_tier');
    const booking = await createConfirmedBookingWithDeposit({ checkIn: '2099-01-15', depositAmount: 200000 });
    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${booking.id}/cancel`, receptionToken),
      env,
      params: { id: String(booking.id) },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.refundPercentApplied).toBe(0);
    expect(body.refundAmount).toBe(0);
    const row = await env.DB.prepare(`SELECT refund_percent_applied FROM bookings WHERE id = ?`).bind(booking.id).first();
    expect(row.refund_percent_applied).toBe(0);
  });

  it('applies the matching tier at the exact day-boundary', async () => {
    await env.DB.exec('DELETE FROM cancellation_policy_tier');
    await env.DB.prepare(`INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, updated_by, updated_at) VALUES (7, 100, 'seed', '2026-08-01T00:00:00Z')`).run();
    await env.DB.prepare(`INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, updated_by, updated_at) VALUES (0, 0, 'seed', '2026-08-01T00:00:00Z')`).run();

    const checkIn = new Date();
    checkIn.setUTCDate(checkIn.getUTCDate() + 7);
    const checkInStr = checkIn.toISOString().slice(0, 10);

    const booking = await createConfirmedBookingWithDeposit({ checkIn: checkInStr, depositAmount: 300000 });
    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${booking.id}/cancel`, receptionToken),
      env,
      params: { id: String(booking.id) },
    });
    const body = await response.json();
    expect(body.refundPercentApplied).toBe(100);
    expect(body.refundAmount).toBe(300000);
  });

  it('falls back to 0% below the smallest configured tier', async () => {
    await env.DB.exec('DELETE FROM cancellation_policy_tier');
    await env.DB.prepare(`INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, updated_by, updated_at) VALUES (3, 50, 'seed', '2026-08-01T00:00:00Z')`).run();

    const checkIn = new Date();
    checkIn.setUTCDate(checkIn.getUTCDate() + 1);
    const booking = await createConfirmedBookingWithDeposit({ checkIn: checkIn.toISOString().slice(0, 10), depositAmount: 100000 });
    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${booking.id}/cancel`, receptionToken),
      env,
      params: { id: String(booking.id) },
    });
    const body = await response.json();
    expect(body.refundPercentApplied).toBe(0);
    expect(body.refundAmount).toBe(0);
  });
});

describe('POST /api/bookings/:id/check-out', () => {
  it('checks out a checked-in booking and flags its room for cleaning', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });
    await checkInBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-in`, managerToken), env, params: { id: String(pendingBookingId) } });

    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-out`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const bookingRow = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(bookingRow.status).toBe('checked_out');

    const roomRow = await env.DB.prepare(`SELECT needs_cleaning FROM rooms WHERE id = ?`).bind(circleRoomId).first();
    expect(roomRow.needs_cleaning).toBe(1);
  });

  it('rejects checking out a booking that is not checked in', async () => {
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-out`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await checkOutBooking({
      request: authedPost('https://x/api/bookings/999999/check-out', managerToken),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });
});
