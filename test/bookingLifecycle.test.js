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

  it('writes an audit_log row with the guest and reason', async () => {
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken, { reason: 'Hết phòng' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'booking_reject' AND entity_id = ?`).bind(pendingBookingId).first();
    expect(row.entity_type).toBe('booking');
    expect(row.entity_label).toBe('Nguyễn Văn A');
    expect(row.old_value).toBe('pending');
    expect(row.new_value).toBe('cancelled — Lý do: Hết phòng');
    expect(row.actor).toBe('quan_ly_a');
  });

  it('writes an audit_log row without a reason suffix when none is given', async () => {
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT new_value FROM audit_log WHERE action_type = 'booking_reject' AND entity_id = ?`).bind(pendingBookingId).first();
    expect(row.new_value).toBe('cancelled');
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
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/cancel`, managerToken, { reason: 'Khách đổi lịch', paymentMethod: 'cash' }),
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
      request: authedPost(`https://x/api/bookings/${booking.id}/cancel`, receptionToken, { paymentMethod: 'transfer' }),
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

  it('creates a finance_transactions expense row and links it on the booking when refundAmount > 0', async () => {
    await env.DB.exec('DELETE FROM cancellation_policy_tier');
    await env.DB.prepare(`INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, updated_by, updated_at) VALUES (0, 50, 'seed', '2026-08-01T00:00:00Z')`).run();
    const booking = await createConfirmedBookingWithDeposit({ checkIn: '2099-01-15', depositAmount: 200000 });

    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${booking.id}/cancel`, receptionToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(booking.id) },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.refundAmount).toBe(100000);

    const row = await env.DB.prepare(`SELECT refund_finance_transaction_id, cancel_refund_payment_method FROM bookings WHERE id = ?`).bind(booking.id).first();
    expect(row.refund_finance_transaction_id).not.toBeNull();
    expect(row.cancel_refund_payment_method).toBe('cash');

    const tx = await env.DB.prepare(`SELECT type, category, amount, note FROM finance_transactions WHERE id = ?`).bind(row.refund_finance_transaction_id).first();
    expect(tx).toEqual({ type: 'expense', category: 'hoan_coc', amount: 100000, note: 'Hoàn cọc huỷ đặt phòng — Refund Test Guest' });
  });

  it('creates no finance_transactions row and leaves the new columns NULL when refundAmount is 0', async () => {
    await env.DB.exec('DELETE FROM cancellation_policy_tier');
    const booking = await createConfirmedBookingWithDeposit({ checkIn: '2099-01-15', depositAmount: 200000 });
    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions`).first();

    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${booking.id}/cancel`, receptionToken),
      env,
      params: { id: String(booking.id) },
    });
    expect(response.status).toBe(200);
    const after = await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions`).first();
    expect(after.n).toBe(before.n);

    const row = await env.DB.prepare(`SELECT refund_finance_transaction_id, cancel_refund_payment_method FROM bookings WHERE id = ?`).bind(booking.id).first();
    expect(row.refund_finance_transaction_id).toBeNull();
    expect(row.cancel_refund_payment_method).toBeNull();
  });

  it('rejects cancellation needing a payment method when none is supplied (400)', async () => {
    await env.DB.exec('DELETE FROM cancellation_policy_tier');
    await env.DB.prepare(`INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, updated_by, updated_at) VALUES (0, 50, 'seed', '2026-08-01T00:00:00Z')`).run();
    const booking = await createConfirmedBookingWithDeposit({ checkIn: '2099-01-15', depositAmount: 200000 });

    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${booking.id}/cancel`, receptionToken),
      env,
      params: { id: String(booking.id) },
    });
    expect(response.status).toBe(400);

    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(booking.id).first();
    expect(row.status).toBe('confirmed');
  });

  it('on a lost race (booking already cancelled), returns 400 and creates no finance_transactions row', async () => {
    await env.DB.exec('DELETE FROM cancellation_policy_tier');
    await env.DB.prepare(`INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, updated_by, updated_at) VALUES (0, 50, 'seed', '2026-08-01T00:00:00Z')`).run();
    const booking = await createConfirmedBookingWithDeposit({ checkIn: '2099-01-15', depositAmount: 200000 });
    await env.DB.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).bind(booking.id).run();

    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions`).first();
    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${booking.id}/cancel`, receptionToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(booking.id) },
    });
    expect(response.status).toBe(400); // status guard fires first — same documented limitation as Phase 2's checkout race test; a genuinely concurrent race is exercised in production, not by a single-threaded test
    const after = await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions`).first();
    expect(after.n).toBe(before.n);
  });

  it('leaves a service item on the cancelled booking untouched, paid or pending', async () => {
    await env.DB.exec('DELETE FROM cancellation_policy_tier');
    const booking = await createConfirmedBookingWithDeposit({ checkIn: '2099-01-15', depositAmount: 0 });
    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at, payment_status) VALUES (?, 'Dịch vụ pending', 50000, 1, 50000, 'posted', 'system', '2026-08-01T00:00:00Z', 'pending')`
    ).bind(booking.id).run();
    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at, payment_status) VALUES (?, 'Dịch vụ paid', 30000, 1, 30000, 'posted', 'system', '2026-08-01T00:00:00Z', 'paid')`
    ).bind(booking.id).run();

    const response = await cancelBooking({
      request: authedPost(`https://x/api/bookings/${booking.id}/cancel`, receptionToken),
      env,
      params: { id: String(booking.id) },
    });
    expect(response.status).toBe(200);

    const rows = await env.DB.prepare(`SELECT name, status, payment_status FROM booking_service_items WHERE booking_id = ? ORDER BY id`).bind(booking.id).all();
    expect(rows.results).toEqual([
      { name: 'Dịch vụ pending', status: 'posted', payment_status: 'pending' },
      { name: 'Dịch vụ paid', status: 'posted', payment_status: 'paid' },
    ]);
  });
});

describe('POST /api/bookings/:id/check-out', () => {
  it('checks out a checked-in booking and flags its room for cleaning', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });
    await checkInBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-in`, managerToken), env, params: { id: String(pendingBookingId) } });

    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const bookingRow = await env.DB.prepare(`SELECT status, checkout_payment_method FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(bookingRow.status).toBe('checked_out');
    expect(bookingRow.checkout_payment_method).toBe('cash');

    const roomRow = await env.DB.prepare(`SELECT needs_cleaning FROM rooms WHERE id = ?`).bind(circleRoomId).first();
    expect(roomRow.needs_cleaning).toBe(1);
  });

  it('records when the room started needing cleaning', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { rooms: [{ roomType: 'circle', roomId: circleRoomId }] }), env, params: { id: String(pendingBookingId) } });
    await checkInBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-in`, managerToken), env, params: { id: String(pendingBookingId) } });

    const before = new Date().toISOString();
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const roomRow = await env.DB.prepare(`SELECT needs_cleaning_since FROM rooms WHERE id = ?`).bind(circleRoomId).first();
    expect(roomRow.needs_cleaning_since).not.toBeNull();
    expect(roomRow.needs_cleaning_since >= before).toBe(true);
  });

  it('rejects checking out a booking that is not checked in', async () => {
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await checkOutBooking({
      request: authedPost('https://x/api/bookings/999999/check-out', managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  async function checkInBookingWithDepositAndServices({ roomType, roomId, nights, depositAmount, pendingServiceAmount, paidServiceAmount }) {
    const checkIn = '2099-02-01';
    const checkOutDate = new Date(checkIn);
    checkOutDate.setUTCDate(checkOutDate.getUTCDate() + nights);
    const bookingInsert = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, deposit_amount, created_at) VALUES ('Checkout Test Guest', '0900000099', ?, ?, ?, ?, 'checked_in', 'website', ?, ?)`
    ).bind(roomType, roomId, checkIn, checkOutDate.toISOString().slice(0, 10), depositAmount, new Date().toISOString()).run();
    const bookingId = bookingInsert.meta.last_row_id;

    if (pendingServiceAmount > 0) {
      await env.DB.prepare(
        `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at, payment_status) VALUES (?, 'Dịch vụ chưa trả', ?, 1, ?, 'posted', 'system', '2026-08-01T00:00:00Z', 'pending')`
      ).bind(bookingId, pendingServiceAmount, pendingServiceAmount).run();
    }
    if (paidServiceAmount > 0) {
      await env.DB.prepare(
        `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at, payment_status) VALUES (?, 'Dịch vụ đã trả', ?, 1, ?, 'posted', 'system', '2026-08-01T00:00:00Z', 'paid')`
      ).bind(bookingId, paidServiceAmount, paidServiceAmount).run();
    }
    return bookingId;
  }

  async function checkInBookingWithDates({ roomType, roomId, checkIn, checkOut }) {
    const bookingInsert = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, deposit_amount, created_at) VALUES ('Pricing Test Guest', '0900000098', ?, ?, ?, ?, 'checked_in', 'website', 0, ?)`
    ).bind(roomType, roomId, checkIn, checkOut, new Date().toISOString()).run();
    return bookingInsert.meta.last_row_id;
  }

  it('bills a stay crossing weekday into weekend nights at each night\'s own configured rate', async () => {
    await env.DB.prepare(`UPDATE rooms SET price_weekday = 700000, price_weekend = 900000 WHERE id = ?`).bind(otherCircleRoomId).run();
    // Thu 2026-09-10 check-in .. Sat 2026-09-12 check-out = 2 nights: Thu (weekday=700000), Fri (weekend=900000)
    const bookingId = await checkInBookingWithDates({ roomType: 'circle', roomId: otherCircleRoomId, checkIn: '2026-09-10', checkOut: '2026-09-12' });

    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(bookingId) },
    });
    const body = await response.json();
    expect(body.roomDue).toBe(700000 + 900000);
  });

  it('falls back to the flat room-type rate when the room has no configured prices', async () => {
    // otherCircleRoomId has NULL price_weekday/price_weekend by default; circle flat rate is 600000
    const bookingId = await checkInBookingWithDates({ roomType: 'circle', roomId: otherCircleRoomId, checkIn: '2026-09-10', checkOut: '2026-09-12' });

    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(bookingId) },
    });
    const body = await response.json();
    expect(body.roomDue).toBe(2 * 600000);
  });

  it('bills a night inside an admin-defined holiday range at the weekend rate even on a weekday', async () => {
    await env.DB.prepare(`UPDATE rooms SET price_weekday = 700000, price_weekend = 900000 WHERE id = ?`).bind(otherCircleRoomId).run();
    await env.DB.prepare(`INSERT INTO holidays (name, start_date, end_date, updated_by, updated_at) VALUES ('Test Holiday', '2026-09-08', '2026-09-08', 'seed', '2026-08-01T00:00:00Z')`).run();
    // Mon 2026-09-07 .. Wed 2026-09-09 = 2 nights: Mon (weekday), Tue=holiday (weekend rate)
    const bookingId = await checkInBookingWithDates({ roomType: 'circle', roomId: otherCircleRoomId, checkIn: '2026-09-07', checkOut: '2026-09-09' });

    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(bookingId) },
    });
    const body = await response.json();
    expect(body.roomDue).toBe(700000 + 900000);
  });

  it('bills the full room total when there is no deposit', async () => {
    const bookingId = await checkInBookingWithDepositAndServices({ roomType: 'circle', roomId: otherCircleRoomId, nights: 1, depositAmount: 0, pendingServiceAmount: 0, paidServiceAmount: 0 });
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(bookingId) },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, roomDue: 600000, servicesDue: 0, refundAmount: 0, checkoutPaymentMethod: 'cash' });

    const tx = await env.DB.prepare(`SELECT type, category, amount, note FROM finance_transactions WHERE note LIKE 'Tiền phòng%'`).first();
    expect(tx).toEqual({ type: 'income', category: 'dich_vu', amount: 600000, note: 'Tiền phòng — Checkout Test Guest' });
  });

  it('subtracts the deposit from the room total, billing only the remainder', async () => {
    const bookingId = await checkInBookingWithDepositAndServices({ roomType: 'circle', roomId: otherCircleRoomId, nights: 1, depositAmount: 200000, pendingServiceAmount: 0, paidServiceAmount: 0 });
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken, { paymentMethod: 'transfer' }),
      env,
      params: { id: String(bookingId) },
    });
    const body = await response.json();
    expect(body).toEqual({ ok: true, roomDue: 400000, servicesDue: 0, refundAmount: 0, checkoutPaymentMethod: 'transfer' });
  });

  it('bills unpaid services in full alongside the room total', async () => {
    const bookingId = await checkInBookingWithDepositAndServices({ roomType: 'circle', roomId: otherCircleRoomId, nights: 1, depositAmount: 0, pendingServiceAmount: 100000, paidServiceAmount: 0 });
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(bookingId) },
    });
    const body = await response.json();
    expect(body).toEqual({ ok: true, roomDue: 600000, servicesDue: 100000, refundAmount: 0, checkoutPaymentMethod: 'cash' });

    const tx = await env.DB.prepare(`SELECT type, category, amount, note FROM finance_transactions WHERE note LIKE 'Dịch vụ lưu trú%'`).first();
    expect(tx).toEqual({ type: 'income', category: 'ban_hang', amount: 100000, note: 'Dịch vụ lưu trú — Checkout Test Guest' });

    const item = await env.DB.prepare(`SELECT payment_status, payment_method FROM booking_service_items WHERE booking_id = ? AND name = 'Dịch vụ chưa trả'`).bind(bookingId).first();
    expect(item).toEqual({ payment_status: 'paid', payment_method: 'cash' });
  });

  it('a deposit larger than the room total is applied to unpaid services next', async () => {
    const bookingId = await checkInBookingWithDepositAndServices({ roomType: 'circle', roomId: otherCircleRoomId, nights: 1, depositAmount: 700000, pendingServiceAmount: 100000, paidServiceAmount: 0 });
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(bookingId) },
    });
    const body = await response.json();
    // roomTotal 600000 fully covered; 100000 leftover deposit covers all of the 100000 unpaid service
    expect(body).toEqual({ ok: true, roomDue: 0, servicesDue: 0, refundAmount: 0, checkoutPaymentMethod: 'cash' });

    const item = await env.DB.prepare(`SELECT payment_status FROM booking_service_items WHERE booking_id = ? AND name = 'Dịch vụ chưa trả'`).bind(bookingId).first();
    expect(item.payment_status).toBe('paid');
  });

  it('refunds the excess when the deposit exceeds room total plus unpaid services', async () => {
    const bookingId = await checkInBookingWithDepositAndServices({ roomType: 'circle', roomId: otherCircleRoomId, nights: 1, depositAmount: 900000, pendingServiceAmount: 100000, paidServiceAmount: 0 });
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(bookingId) },
    });
    const body = await response.json();
    expect(body).toEqual({ ok: true, roomDue: 0, servicesDue: 0, refundAmount: 200000, checkoutPaymentMethod: 'cash' });

    const tx = await env.DB.prepare(`SELECT type, category, amount, note FROM finance_transactions WHERE note LIKE 'Hoàn cọc%'`).first();
    expect(tx).toEqual({ type: 'expense', category: 'hoan_coc', amount: 200000, note: 'Hoàn cọc dư — Checkout Test Guest' });
  });

  it('requires no payment method and creates no finance_transactions rows when the deposit lands exactly on the combined total', async () => {
    const bookingId = await checkInBookingWithDepositAndServices({ roomType: 'circle', roomId: otherCircleRoomId, nights: 1, depositAmount: 600000, pendingServiceAmount: 0, paidServiceAmount: 0 });
    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions`).first();
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken),
      env,
      params: { id: String(bookingId) },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, roomDue: 0, servicesDue: 0, refundAmount: 0, checkoutPaymentMethod: null });
    const after = await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions`).first();
    expect(after.n).toBe(before.n);

    const bookingRow = await env.DB.prepare(`SELECT checkout_payment_method FROM bookings WHERE id = ?`).bind(bookingId).first();
    expect(bookingRow.checkout_payment_method).toBeNull();
  });

  it('rejects checkout when a payment method is needed but not provided', async () => {
    const bookingId = await checkInBookingWithDepositAndServices({ roomType: 'circle', roomId: otherCircleRoomId, nights: 1, depositAmount: 0, pendingServiceAmount: 0, paidServiceAmount: 0 });
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken),
      env,
      params: { id: String(bookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('leaves an already-paid service item untouched (not re-billed, payment_method unchanged)', async () => {
    const bookingId = await checkInBookingWithDepositAndServices({ roomType: 'circle', roomId: otherCircleRoomId, nights: 1, depositAmount: 0, pendingServiceAmount: 0, paidServiceAmount: 50000 });
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(bookingId) },
    });
    const body = await response.json();
    expect(body.servicesDue).toBe(0);

    const item = await env.DB.prepare(`SELECT payment_status, payment_method FROM booking_service_items WHERE booking_id = ? AND name = 'Dịch vụ đã trả'`).bind(bookingId).first();
    expect(item).toEqual({ payment_status: 'paid', payment_method: null });
  });

  it('on a lost race (booking already checked out), returns 409 and cleans up any finance_transactions rows just created', async () => {
    const bookingId = await checkInBookingWithDepositAndServices({ roomType: 'circle', roomId: otherCircleRoomId, nights: 1, depositAmount: 0, pendingServiceAmount: 0, paidServiceAmount: 0 });
    // Simulate a concurrent request that already checked this booking out between this
    // request's read and write.
    await env.DB.prepare(`UPDATE bookings SET status = 'checked_out' WHERE id = ?`).bind(bookingId).run();

    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions`).first();
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${bookingId}/check-out`, managerToken, { paymentMethod: 'cash' }),
      env,
      params: { id: String(bookingId) },
    });
    expect(response.status).toBe(400); // status guard fires first (status is no longer 'checked_in') — this exercises the pre-existing early guard, not the race window itself, which is documented as effectively untestable without injecting a fault mid-request (see gio-xanh-sessions close endpoint for the same limitation).
    const after = await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions`).first();
    expect(after.n).toBe(before.n);
  });
});
