import { requireAuth } from '../../../lib/requireAuth.js';
import { hasPermission } from '../../../lib/permissions.js';
import { redactContact } from '../../../lib/redactContact.js';
import { ROOM_TYPES } from '../../../lib/roomTypes.js';
import { sendTelegramMessage, escapeMarkdown } from '../../../lib/telegram.js';
import { readJsonBody } from '../../../lib/readJsonBody.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_ROOM_TYPES = Object.keys(ROOM_TYPES);
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 16384;
const MAX_EMAIL_LENGTH = 254;
const MAX_GUESTS_COUNT = 50;
const WHITESPACE = /\s/;

// Kiểm tra email tuyến tính (không dùng regex dễ backtracking): đúng một '@',
// phần local không rỗng, domain có '.' không nằm ở đầu/cuối, không có khoảng trắng.
// Nhận chuỗi đã trim.
function isValidEmail(email) {
  if (email.length < 1 || email.length > MAX_EMAIL_LENGTH) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  if (domain.length < 3 || !domain.slice(1, -1).includes('.')) return false;
  return !WHITESPACE.test(email);
}

export async function onRequestPost({ request, env }) {
  // Thứ tự: giới hạn body → parse JSON → kiểm tra trường → ghi DB → Telegram.
  const parsed = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const { guestName, phone, email, roomType, checkIn, checkOut, guestsCount, notes } = body;

  if (typeof guestName !== 'string' || guestName.trim().length === 0) {
    return jsonError('Vui lòng nhập họ tên', 400);
  }
  if (guestName.length > 200) {
    return jsonError('Tên khách quá dài', 400);
  }
  if (typeof phone !== 'string' || phone.trim().length === 0) {
    return jsonError('Vui lòng nhập số điện thoại', 400);
  }
  if (phone.length > 200) {
    return jsonError('Số điện thoại quá dài', 400);
  }
  let cleanEmail = null;
  if (email !== undefined && email !== null && email !== '') {
    if (typeof email !== 'string' || !isValidEmail(email.trim())) {
      return jsonError('Email không hợp lệ', 400);
    }
    cleanEmail = email.trim();
  }
  if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
    return jsonError('Ghi chú không hợp lệ', 400);
  }
  if (guestsCount !== undefined && guestsCount !== null && (!Number.isInteger(guestsCount) || guestsCount < 1 || guestsCount > MAX_GUESTS_COUNT)) {
    return jsonError('Số khách không hợp lệ', 400);
  }
  if (!VALID_ROOM_TYPES.includes(roomType)) {
    return jsonError('Loại phòng không hợp lệ', 400);
  }
  if (typeof checkIn !== 'string' || typeof checkOut !== 'string' || !DATE_FORMAT.test(checkIn) || !DATE_FORMAT.test(checkOut) || isNaN(Date.parse(checkIn)) || isNaN(Date.parse(checkOut))) {
    return jsonError('Ngày không hợp lệ', 400);
  }
  if (checkOut <= checkIn) {
    return jsonError('Ngày trả phòng phải sau ngày nhận phòng', 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (checkIn < today) {
    return jsonError('Ngày nhận phòng không thể ở quá khứ', 400);
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, email, room_type, check_in, check_out, guests_count, notes, status, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'website', ?)`
  )
    .bind(guestName.trim(), phone.trim(), cleanEmail, roomType, checkIn, checkOut, guestsCount || null, notes || null, now)
    .run();

  const notifySetting = await env.DB.prepare(`SELECT booking_notify_chat_id FROM notification_settings ORDER BY id DESC LIMIT 1`).first();
  if (notifySetting) {
    const lines = [
      '🆕 *Yêu cầu đặt phòng mới*',
      '',
      `Khách: ${escapeMarkdown(guestName.trim())}`,
      `SĐT: ${escapeMarkdown(phone.trim())}`,
      `Loại phòng: ${escapeMarkdown(ROOM_TYPES[roomType].label)}`,
      `Nhận phòng: ${checkIn}`,
      `Trả phòng: ${checkOut}`,
      `Số khách: ${guestsCount || 'Chưa rõ'}`,
      `Ghi chú: ${notes ? escapeMarkdown(notes) : 'Không có'}`,
    ];
    await sendTelegramMessage(env, { chatId: notifySetting.booking_notify_chat_id, text: lines.join('\n') });
  }

  return new Response(JSON.stringify({ id: result.meta.last_row_id }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, 'bookings.view');
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const date = url.searchParams.get('date');
  const view = url.searchParams.get('view');
  const includeHidden = url.searchParams.get('includeHidden') === '1' && hasPermission(auth, 'records.hide');

  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (date && view === 'arrivals') {
    conditions.push('check_in = ?');
    params.push(date);
  } else if (date && view === 'departures') {
    conditions.push('check_out <= ?');
    params.push(date);
  } else if (date && view === 'inhouse') {
    conditions.push('check_out > ?');
    params.push(date);
  }
  if (!includeHidden) {
    conditions.push('is_hidden = 0');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT id, guest_name AS guestName, phone, email, room_type AS roomType, room_id AS roomId,
            check_in AS checkIn, check_out AS checkOut, guests_count AS guestsCount, notes, status, source,
            deposit_amount AS depositAmount, is_hidden AS isHidden,
            created_at AS createdAt, created_by AS createdBy, confirmed_by AS confirmedBy, confirmed_at AS confirmedAt,
            cancel_reason AS cancelReason
     FROM bookings ${where} ORDER BY check_in ASC`
  ).bind(...params).all();

  results.forEach((r) => { r.isHidden = !!r.isHidden; });

  redactContact(auth, results);

  results.forEach((r) => {
    r.services = [];
  });
  if (results.length > 0) {
    const { results: serviceRows } = await env.DB.prepare(
      `SELECT id, booking_id AS bookingId, name, unit_price AS unitPrice, quantity, amount, status,
              payment_status AS paymentStatus, payment_method AS paymentMethod,
              created_by AS createdBy, created_at AS createdAt, voided_by AS voidedBy, voided_at AS voidedAt,
              experience_date AS experienceDate, slot_template_id AS slotTemplateId,
              experience_slot_label AS experienceSlotLabel, experience_start_time AS experienceStartTime,
              terms_accepted_at AS termsAcceptedAt
       FROM booking_service_items
       WHERE booking_id IN (SELECT id FROM bookings ${where})
       ORDER BY created_at ASC, id ASC`
    ).bind(...params).all();

    const byBooking = {};
    serviceRows.forEach((row) => {
      if (!byBooking[row.bookingId]) byBooking[row.bookingId] = [];
      byBooking[row.bookingId].push(row);
    });
    results.forEach((r) => {
      r.services = byBooking[r.id] || [];
    });
  }

  results.forEach((r) => {
    r.deposits = [];
  });
  if (results.length > 0) {
    const { results: depositRows } = await env.DB.prepare(
      `SELECT id, booking_id AS bookingId, amount, payment_method AS paymentMethod, note,
              created_by AS createdBy, created_at AS createdAt
       FROM booking_deposits
       WHERE booking_id IN (SELECT id FROM bookings ${where}) AND voided_at IS NULL
       ORDER BY created_at ASC, id ASC`
    ).bind(...params).all();

    const depositsByBooking = {};
    depositRows.forEach((row) => {
      if (!depositsByBooking[row.bookingId]) depositsByBooking[row.bookingId] = [];
      depositsByBooking[row.bookingId].push(row);
    });
    results.forEach((r) => {
      r.deposits = depositsByBooking[r.id] || [];
    });
  }

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
