import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_PAYMENT_METHODS = ['cash', 'transfer'];

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const booking = await env.DB.prepare(`SELECT id, status, guest_name FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }
  if (booking.status === 'cancelled' || booking.status === 'checked_out') {
    return jsonError('Không thể thêm cọc cho đặt phòng đã huỷ hoặc đã trả phòng', 400);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { amount, paymentMethod, note } = body || {};

  if (!Number.isInteger(amount) || amount <= 0) {
    return jsonError('Số tiền cọc phải là số nguyên dương', 400);
  }
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    return jsonError('Vui lòng chọn hình thức thanh toán', 400);
  }

  const now = new Date().toISOString();
  const txNote = note ? `Cọc — ${booking.guest_name} — ${note}` : `Cọc — ${booking.guest_name}`;

  const txInsert = await env.DB.prepare(
    `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
     VALUES ('income', 'dich_vu', ?, ?, ?, 'confirmed', ?, ?)`
  ).bind(amount, txNote, now.slice(0, 10), auth.username, now).run();
  const financeTransactionId = txInsert.meta.last_row_id;

  const [depositInsert] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO booking_deposits (booking_id, amount, payment_method, note, finance_transaction_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(params.id, amount, paymentMethod, note || null, financeTransactionId, auth.username, now),
    env.DB.prepare(`UPDATE bookings SET deposit_amount = deposit_amount + ? WHERE id = ?`).bind(amount, params.id),
  ]);
  const depositId = depositInsert.meta.last_row_id;

  const updated = await env.DB.prepare(`SELECT deposit_amount FROM bookings WHERE id = ?`).bind(params.id).first();

  return new Response(
    JSON.stringify({ ok: true, depositId, financeTransactionId, newTotal: updated.deposit_amount }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );
}
