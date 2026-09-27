// FA-4: booking state transitions must be enforced at the write (guarded UPDATE + meta.changes),
// and a transition that lost a race must leave NO side effects (audit, finance, split bookings,
// room cleaning flag).
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as confirmBooking } from '../functions/api/bookings/[id]/confirm.js';
import { onRequestPost as rejectBooking } from '../functions/api/bookings/[id]/reject.js';
import { onRequestPost as checkInBooking } from '../functions/api/bookings/[id]/check-in.js';
import { onRequestPost as checkOutBooking } from '../functions/api/bookings/[id]/check-out.js';
import { onRequestPost as cancelBooking } from '../functions/api/bookings/[id]/cancel.js';
import { createSession } from '../lib/auth.js';
import { envWithHookBefore } from './helpers/raceEnv.js';

let token, circleRoomIds;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM booking_service_items');
  await env.DB.exec('DELETE FROM booking_deposits');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('DELETE FROM audit_log');
  await env.DB.exec('DELETE FROM finance_transactions');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0, needs_cleaning_since = NULL');
  await env.DB.exec('DELETE FROM cancellation_policy_tier');
  await env.DB.prepare(
    `INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, updated_by, updated_at) VALUES (0, 100, 'seed', '2026-08-01T00:00:00Z')`
  ).run();

  const s = await env.DB.prepare(
    `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_race', 'x', 'manager', '2026-08-01T00:00:00Z')`
  ).run();
  token = await createSession(env.DB, s.meta.last_row_id);

  const rooms = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' AND is_active = 1 ORDER BY id LIMIT 2`).all();
  circleRoomIds = rooms.results.map((r) => r.id);
});

function post(path, body) {
  return new Request(`https://x${path}`, {
    method: 'POST',
    headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function insertBooking({ status, roomId = null, deposit = 0, checkIn = '2099-01-01', checkOut = '2099-01-03' }) {
  const r = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, deposit_amount, created_at)
     VALUES ('Khách Race', '0900000777', 'circle', ?, ?, ?, ?, 'website', ?, '2026-08-01T00:00:00Z')`
  ).bind(roomId, checkIn, checkOut, status, deposit).run();
  return r.meta.last_row_id;
}

const count = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).first()).n;
const bookingStatus = async (id) => (await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first()).status;

const call = (fn, id, action, body, e = env) => fn({ request: post(`/api/bookings/${id}/${action}`, body), env: e, params: { id: String(id) } });

describe('FA-4 check-in', () => {
  it('stale state: a cancel landing between pre-check and write makes check-in fail with no status change', async () => {
    const id = await insertBooking({ status: 'confirmed', deposit: 500000 });
    let cancelRes;
    const racedEnv = envWithHookBefore(/UPDATE bookings SET status = 'checked_in'/, async () => {
      cancelRes = await call(cancelBooking, id, 'cancel', { paymentMethod: 'cash' });
    });
    const res = await call(checkInBooking, id, 'check-in', null, racedEnv);
    expect(cancelRes.status).toBe(200);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Chỉ có thể check-in từ trạng thái đã xác nhận');
    expect(await bookingStatus(id)).toBe('cancelled');
  });

  it('check-in vs cancel in parallel: exactly one transition applies and finance matches the final state', async () => {
    const id = await insertBooking({ status: 'confirmed', deposit: 500000 });
    const [ci, ca] = await Promise.all([
      call(checkInBooking, id, 'check-in'),
      call(cancelBooking, id, 'cancel', { paymentMethod: 'cash' }),
    ]);
    const ok = [ci.status, ca.status].filter((s) => s === 200).length;
    expect(ok).toBe(1);
    const status = await bookingStatus(id);
    const refunds = await count(`SELECT COUNT(*) AS n FROM finance_transactions WHERE category = 'hoan_coc'`);
    const cancelAudits = await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'booking_cancel'`);
    if (ci.status === 200) {
      expect(status).toBe('checked_in');
      expect(refunds).toBe(0);
      expect(cancelAudits).toBe(0);
    } else {
      expect(status).toBe('cancelled');
      expect(refunds).toBe(1);
      expect(cancelAudits).toBe(1);
    }
  });
});

describe('FA-4 cancel', () => {
  it('stale state: a check-in landing before the write leaves no refund row and no cancel audit row', async () => {
    const id = await insertBooking({ status: 'confirmed', deposit: 500000 });
    let ciRes;
    const racedEnv = envWithHookBefore(/UPDATE bookings SET status = 'cancelled'/, async () => {
      ciRes = await call(checkInBooking, id, 'check-in');
    });
    const res = await call(cancelBooking, id, 'cancel', { paymentMethod: 'cash' }, racedEnv);
    expect(ciRes.status).toBe(200);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Đặt phòng này vừa được xử lý bởi thao tác khác, vui lòng tải lại');
    expect(await bookingStatus(id)).toBe('checked_in');
    expect(await count(`SELECT COUNT(*) AS n FROM finance_transactions`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'booking_cancel'`)).toBe(0);
  });
});

describe('FA-4 reject', () => {
  it('stale state: a booking confirmed between pre-check and write is not rejected and gets no reject audit', async () => {
    const id = await insertBooking({ status: 'pending' });
    const racedEnv = envWithHookBefore(/UPDATE bookings SET status = 'cancelled'/, async () => {
      await env.DB.prepare(`UPDATE bookings SET status = 'confirmed', room_id = ? WHERE id = ?`).bind(circleRoomIds[0], id).run();
    });
    const res = await call(rejectBooking, id, 'reject', { reason: 'hết phòng' }, racedEnv);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Yêu cầu này không còn ở trạng thái chờ xử lý');
    expect(await bookingStatus(id)).toBe('confirmed');
    expect(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'booking_reject'`)).toBe(0);
  });
});

describe('FA-4 confirm', () => {
  it('stale state: a booking rejected between pre-check and write is not confirmed and no split booking is created', async () => {
    const id = await insertBooking({ status: 'pending' });
    let rejectRes;
    const racedEnv = envWithHookBefore(/UPDATE bookings SET status = 'confirmed'/, async () => {
      rejectRes = await call(rejectBooking, id, 'reject', { reason: 'khách huỷ' });
    });
    const rooms = circleRoomIds.map((roomId) => ({ roomType: 'circle', roomId }));
    const res = await call(confirmBooking, id, 'confirm', { rooms }, racedEnv);
    expect(rejectRes.status).toBe(200);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Yêu cầu này không còn ở trạng thái chờ xử lý');
    expect(await bookingStatus(id)).toBe('cancelled');
    expect(await count(`SELECT COUNT(*) AS n FROM bookings`)).toBe(1);
  });

  it('confirm vs reject in parallel: exactly one applies; split bookings exist only when confirmed', async () => {
    const id = await insertBooking({ status: 'pending' });
    const rooms = circleRoomIds.map((roomId) => ({ roomType: 'circle', roomId }));
    const [co, re] = await Promise.all([
      call(confirmBooking, id, 'confirm', { rooms }),
      call(rejectBooking, id, 'reject', {}),
    ]);
    expect([co.status, re.status].filter((s) => s === 200).length).toBe(1);
    const status = await bookingStatus(id);
    const total = await count(`SELECT COUNT(*) AS n FROM bookings`);
    const rejectAudits = await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'booking_reject'`);
    if (co.status === 200) {
      expect(status).toBe('confirmed');
      expect(total).toBe(2);
      expect(rejectAudits).toBe(0);
    } else {
      expect(status).toBe('cancelled');
      expect(total).toBe(1);
      expect(rejectAudits).toBe(1);
    }
  });
});

describe('FA-4 check-out', () => {
  it('stale state: the losing check-out leaves no finance rows and does not re-flag the room for cleaning', async () => {
    const id = await insertBooking({ status: 'checked_in', roomId: circleRoomIds[0], checkIn: '2026-09-10', checkOut: '2026-09-12' });
    let winner;
    const racedEnv = envWithHookBefore(/UPDATE bookings SET status = 'checked_out'/, async () => {
      winner = await call(checkOutBooking, id, 'check-out', { paymentMethod: 'cash' });
      // Housekeeping cleans the room before the losing request's write lands.
      await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 0, needs_cleaning_since = NULL WHERE id = ?`).bind(circleRoomIds[0]).run();
    });
    const loser = await call(checkOutBooking, id, 'check-out', { paymentMethod: 'transfer' }, racedEnv);
    expect(winner.status).toBe(200);
    expect(loser.status).toBe(409);
    expect((await loser.json()).error).toBe('Đặt phòng này vừa được check-out bởi thao tác khác, vui lòng tải lại');
    const b = await env.DB.prepare(`SELECT status, checkout_payment_method FROM bookings WHERE id = ?`).bind(id).first();
    expect(b).toEqual({ status: 'checked_out', checkout_payment_method: 'cash' });
    expect(await count(`SELECT COUNT(*) AS n FROM finance_transactions WHERE category = 'dich_vu'`)).toBe(1);
    const room = await env.DB.prepare(`SELECT needs_cleaning FROM rooms WHERE id = ?`).bind(circleRoomIds[0]).first();
    expect(room.needs_cleaning).toBe(0);
  });
});
