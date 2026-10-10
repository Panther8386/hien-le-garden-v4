import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { createSession } from '../lib/auth.js';
import { onRequestPost as checkout } from '../functions/api/bookings/[id]/check-out.js';
import { onRequestPost as closeOrder } from '../functions/api/dine-in-orders/[id]/close.js';
import { onRequestPost as closeGX } from '../functions/api/gio-xanh-sessions/[id]/close.js';
import { envWithHookBefore } from './helpers/raceEnv.js';

let token;
beforeEach(async () => {
  for (const table of ['sessions', 'staff_accounts', 'gio_xanh_session_items', 'gio_xanh_sessions',
    'dine_in_order_items', 'dine_in_orders', 'booking_service_items', 'booking_deposits', 'bookings', 'audit_log', 'finance_transactions']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare('UPDATE rooms SET needs_cleaning=0, needs_cleaning_since=NULL, price_weekday=500000, price_weekend=500000').run();
  await env.DB.prepare("INSERT INTO staff_accounts(id,username,password_hash,role,created_at) VALUES(1,'atomic_audit','x','admin','2026-10-09')").run();
  token = await createSession(env.DB, 1);
});

async function fixture(kind, refund = false) {
  let inserted, handler, parent, closed;
  if (kind === 'booking') {
    inserted = await env.DB.prepare(`INSERT INTO bookings(guest_name,phone,room_type,room_id,check_in,check_out,status,source,created_at,deposit_amount)
      VALUES('Atomic audit','0000000000','triangle',1,'2026-09-10','2026-09-11','checked_in','phone','2026-10-09',?)`).bind(refund ? 575000 : 0).run();
    await env.DB.prepare(`INSERT INTO booking_service_items(booking_id,name,unit_price,quantity,amount,status,created_by,created_at,payment_status)
      VALUES(?,'Audit service',50000,1,50000,'posted','audit','2026-10-09','pending')`).bind(inserted.meta.last_row_id).run();
    handler = checkout; parent = 'bookings'; closed = 'checked_out';
  } else if (kind === 'order') {
    inserted = await env.DB.prepare("INSERT INTO dine_in_orders(table_label,status,opened_by,opened_at) VALUES('Atomic audit','open','audit','2026-10-09')").run();
    await env.DB.prepare(`INSERT INTO dine_in_order_items(order_id,name,unit_price,quantity,amount,status,created_by,created_at)
      VALUES(?,'Audit drink',50000,1,50000,'posted','audit','2026-10-09')`).bind(inserted.meta.last_row_id).run();
    handler = closeOrder; parent = 'dine_in_orders'; closed = 'closed';
  } else {
    inserted = await env.DB.prepare("INSERT INTO gio_xanh_sessions(room_id,guest_name,status,opened_by,opened_at) VALUES(1,'Atomic audit','open','audit','2026-10-09')").run();
    await env.DB.prepare(`INSERT INTO gio_xanh_session_items(session_id,source,source_id,name,unit_price,quantity,amount,status,created_by,created_at)
      VALUES(?,'gio_combo',1,'Audit combo',50000,1,50000,'posted','audit','2026-10-09')`).bind(inserted.meta.last_row_id).run();
    handler = closeGX; parent = 'gio_xanh_sessions'; closed = 'closed';
  }
  const id = inserted.meta.last_row_id;
  const call = (e = env) => handler({ env: e, params: { id: String(id) }, request: new Request('https://audit.invalid', {
    method: 'POST', headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentMethod: 'transfer' }),
  }) });
  return { id, parent, closed, call };
}

async function snapshot(f) {
  return {
    parent: await env.DB.prepare(`SELECT * FROM ${f.parent} WHERE id=?`).bind(f.id).first(),
    finance: (await env.DB.prepare('SELECT * FROM finance_transactions ORDER BY id').all()).results,
    audit: (await env.DB.prepare('SELECT * FROM audit_log ORDER BY id').all()).results,
    services: (await env.DB.prepare('SELECT * FROM booking_service_items ORDER BY id').all()).results,
    room: await env.DB.prepare('SELECT needs_cleaning, needs_cleaning_since FROM rooms WHERE id=1').first(),
  };
}

for (const kind of ['booking', 'order', 'gx']) {
  it(`${kind}: final state write failure rolls back every preceding receipt and audit`, async () => {
    const f = await fixture(kind), before = await snapshot(f);
    await env.DB.prepare(`CREATE TRIGGER fail_atomic BEFORE UPDATE OF status ON ${f.parent}
      WHEN NEW.status='${f.closed}' BEGIN SELECT RAISE(ABORT,'injected final write failure'); END`).run();
    try {
      expect((await f.call()).status).toBe(500);
      expect(await snapshot(f)).toEqual(before);
    } finally { await env.DB.prepare('DROP TRIGGER fail_atomic').run(); }
    expect((await f.call()).status).toBe(200);
  });

  it(`${kind}: receipt failure leaves parent and all side effects unchanged`, async () => {
    const f = await fixture(kind), before = await snapshot(f);
    await env.DB.prepare("CREATE TRIGGER fail_atomic BEFORE INSERT ON finance_transactions BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END").run();
    try {
      expect((await f.call()).status).toBe(500);
      expect(await snapshot(f)).toEqual(before);
    } finally { await env.DB.prepare('DROP TRIGGER fail_atomic').run(); }
  });

  it(`${kind}: two simultaneous closes commit exactly one settlement`, async () => {
    const f = await fixture(kind);
    const responses = await Promise.all([f.call(), f.call()]);
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(responses.every(r => [200, 400, 409].includes(r.status))).toBe(true);
    const state = await snapshot(f);
    expect(state.parent.status).toBe(f.closed);
    expect(state.finance).toHaveLength(kind === 'booking' ? 2 : 1);
    if (kind === 'booking') expect(state.finance.every(row => row.checkout_booking_id === f.id)).toBe(true);
    expect(state.audit).toHaveLength(1);
    if (kind !== 'booking') {
      expect(state.parent.finance_transaction_id).toBe(state.finance[0].id);
      expect(state.parent.total_amount).toBe(state.finance[0].amount);
    }
  });

  it(`${kind}: lost response after commit preserves settlement; retry cannot duplicate or delete receipts`, async () => {
    const f = await fixture(kind);
    const DB = new Proxy(env.DB, {get(target, prop) {
      if (prop === 'batch') return async statements => { await target.batch(statements); throw new Error('Simulated lost commit response'); };
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    }});
    expect((await f.call({...env, DB})).status).toBe(500);
    const committed = await snapshot(f);
    expect(committed.parent.status).toBe(f.closed);
    expect(committed.finance).toHaveLength(kind === 'booking' ? 2 : 1);
    expect((await f.call()).status).toBe(400);
    expect(await snapshot(f)).toEqual(committed);
  });

  it(`${kind}: a competing close before the batch leaves only the winner's receipts`, async () => {
    const f = await fixture(kind);
    const raced = envWithHookBefore(/INSERT INTO finance_transactions/, async () => { expect((await f.call()).status).toBe(200); });
    expect((await f.call(raced)).status).toBe(409);
    const state = await snapshot(f);
    expect(state.finance).toHaveLength(kind === 'booking' ? 2 : 1);
    expect(state.audit).toHaveLength(1);
  });
}

it.each(['second receipt', 'service settlement', 'room cleaning', 'refund'])('booking: rollback on %s failure is complete', async stage => {
  const f = await fixture('booking', stage === 'refund'), before = await snapshot(f);
  const trigger = {
    'second receipt': "BEFORE INSERT ON finance_transactions WHEN NEW.category='ban_hang'",
    'service settlement': "BEFORE UPDATE OF payment_status ON booking_service_items WHEN NEW.payment_status='paid'",
    'room cleaning': 'BEFORE UPDATE OF needs_cleaning ON rooms WHEN NEW.needs_cleaning=1',
    refund: "BEFORE INSERT ON finance_transactions WHEN NEW.category='hoan_coc'",
  }[stage];
  await env.DB.prepare(`CREATE TRIGGER fail_atomic ${trigger} BEGIN SELECT RAISE(ABORT,'injected settlement failure'); END`).run();
  try {
    expect((await f.call()).status).toBe(500);
    expect(await snapshot(f)).toEqual(before);
  } finally { await env.DB.prepare('DROP TRIGGER fail_atomic').run(); }
  const retry = await f.call(); expect(retry.status).toBe(200);
  if (stage === 'refund') {
    expect((await retry.json()).refundAmount).toBe(25000);
    expect((await snapshot(f)).finance).toHaveLength(1);
  }
});

it.each(['deposit', 'room price', 'holiday'])('booking: changed %s before settlement rejects all writes', async field => {
  const f = await fixture('booking');
  const change = {
    deposit: () => env.DB.prepare('UPDATE bookings SET deposit_amount=100000 WHERE id=?').bind(f.id).run(),
    'room price': () => env.DB.prepare('UPDATE rooms SET price_weekday=600000, price_weekend=600000 WHERE id=1').run(),
    holiday: () => env.DB.prepare("INSERT INTO holidays(name,start_date,end_date,updated_by,updated_at) VALUES('Audit holiday','2026-09-10','2026-09-11','audit','2026-10-09')").run(),
  }[field];
  const raced = envWithHookBefore(/INSERT INTO finance_transactions/, change);
  expect((await f.call(raced)).status).toBe(409);
  const state = await snapshot(f);
  expect(state.parent.status).toBe('checked_in');
  expect(state.finance).toEqual([]);
  expect(state.audit).toEqual([]);
  expect(state.services[0].payment_status).toBe('pending');
  expect(state.room.needs_cleaning).toBe(0);
});
