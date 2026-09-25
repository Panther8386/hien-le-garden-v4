import { generatePromoCode, computeExpiry } from '../../lib/promoCode.js';
import { resolveActivePolicy } from '../../lib/policy.js';
import { sendPromoEmail } from '../../lib/email.js';
import { corsHeaders, handleCorsPreflight } from '../../lib/cors.js';
import { renderTemplate } from '../../lib/templates.js';
import { verifyTurnstile } from '../../lib/turnstile.js';

function jsonError(message, status, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Only the separators the SQL-side normalization strips (see STORED_PHONE_SQL),
// so a stored phone always normalizes the same way in JS and in SQL.
const PHONE_CHARS = /^[0-9 .\-+()]+$/;
const TURNSTILE_ERROR = 'Xác minh chống spam không thành công. Vui lòng thử lại.';
const DUPLICATE_VOUCHER_ERROR = 'Bạn đã nhận ưu đãi cho lần góp ý này. Ưu đãi hiện tại vẫn còn hiệu lực.';

// Digits only; Vietnamese international form 84xxxxxxxxx (11 digits) → 0xxxxxxxxx.
function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('84') ? `0${digits.slice(2)}` : digits;
}

// trim + ASCII lowercase — matches SQLite's lower(trim(email)) exactly.
function normalizeEmail(email) {
  return String(email).trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

// SQL twin of normalizePhone for the stored column.
const STRIPPED_PHONE_SQL = `replace(replace(replace(replace(replace(replace(f.phone, ' ', ''), '.', ''), '-', ''), '+', ''), '(', ''), ')', '')`;
const STORED_PHONE_SQL = `CASE WHEN length(${STRIPPED_PHONE_SQL}) = 11 AND substr(${STRIPPED_PHONE_SQL}, 1, 2) = '84'
      THEN '0' || substr(${STRIPPED_PHONE_SQL}, 3) ELSE ${STRIPPED_PHONE_SQL} END`;

function isAbsent(value) {
  return value === undefined || value === null || value === '';
}

// Returns an error message, or null when the body is valid.
function validate(body) {
  const { guestName, phone, email, wantsTelegram, rating, comment, consentGiven, stayDate, wishesNextTime, favoriteActivities } = body;

  if (!consentGiven) return 'Cần đồng ý sử dụng thông tin để tiếp tục';
  for (const value of [guestName, phone, email, comment, stayDate, wishesNextTime]) {
    if (value !== undefined && value !== null && typeof value !== 'string') return 'Dữ liệu không hợp lệ';
  }
  if (isAbsent(email) && !wantsTelegram) return 'Cần ít nhất một cách liên hệ (email hoặc Telegram)';
  if (isAbsent(guestName) || guestName.trim() === '' || isAbsent(phone) || isAbsent(rating)) {
    return 'Thiếu thông tin bắt buộc';
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'Đánh giá phải là số từ 1 đến 5';
  if (!isAbsent(email) && (email.length > 254 || !EMAIL_FORMAT.test(email))) return 'Email không hợp lệ';
  if (guestName.trim().length > 100) return 'Tên khách quá dài';
  if (phone.length > 200) return 'Số điện thoại quá dài';
  const phoneDigits = normalizePhone(phone).length;
  if (!PHONE_CHARS.test(phone) || phoneDigits < 8 || phoneDigits > 15) return 'Số điện thoại không hợp lệ';
  if (!isAbsent(comment) && comment.length > 2000) return 'Nhận xét quá dài';
  if (!isAbsent(stayDate) && (stayDate.length > 32 || isNaN(Date.parse(stayDate)))) return 'Ngày lưu trú không hợp lệ';
  if (!isAbsent(wishesNextTime) && wishesNextTime.length > 2000) return 'Mong muốn lần sau quá dài';
  if (favoriteActivities !== undefined && favoriteActivities !== null) {
    if (
      !Array.isArray(favoriteActivities) ||
      favoriteActivities.length > 10 ||
      !favoriteActivities.every((a) => typeof a === 'string' && a.length <= 100)
    ) {
      return 'Hoạt động yêu thích không hợp lệ';
    }
  }
  return null;
}

export async function onRequestOptions({ request }) {
  return handleCorsPreflight(request);
}

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request);

  // 1. Parse: must be a JSON object.
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400, cors);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError('Dữ liệu không hợp lệ', 400, cors);
  }

  // 2. Bot protection before anything touches the DB or Brevo (fail closed).
  const human = await verifyTurnstile(env, body.turnstileToken, request.headers.get('CF-Connecting-IP'));
  if (!human) {
    return jsonError(TURNSTILE_ERROR, 403, cors);
  }

  // 3. Field validation.
  const validationError = validate(body);
  if (validationError) {
    return jsonError(validationError, 400, cors);
  }

  const { phone, wantsTelegram, rating, favoriteActivities } = body;
  const guestName = body.guestName.trim();
  const email = isAbsent(body.email) ? null : body.email;
  const comment = isAbsent(body.comment) ? null : body.comment;
  const stayDate = isAbsent(body.stayDate) ? null : body.stayDate;
  const wishesNextTime = isAbsent(body.wishesNextTime) ? null : body.wishesNextTime;

  const now = new Date();
  const nowISO = now.toISOString();
  const todayISODate = nowISO.slice(0, 10);
  const policy = await resolveActivePolicy(env.DB, todayISODate);

  let giftOffered = false;
  if (policy.giftEnabled) {
    const gift = await env.DB.prepare(`SELECT stock_count FROM gift_inventory ORDER BY id DESC LIMIT 1`).first();
    giftOffered = !!gift && gift.stock_count > 0;
  }

  const feedbackId = crypto.randomUUID();
  const promoCode = generatePromoCode();
  const expiresAt = computeExpiry(now);
  const normalizedEmail = email ? normalizeEmail(email) : null;

  // 4. Atomic check-and-insert: one statement, so no concurrent request can
  // slip a second active voucher for the same phone/email in between.
  const insert = await env.DB.prepare(
    `INSERT INTO feedback_responses
     (id, submitted_at, guest_name, phone, email, wants_telegram, rating, comment, consent_given,
      promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed,
      stay_date, wishes_next_time, favorite_activities)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'unused', ?, 0, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM feedback_responses f
       WHERE f.promo_status = 'unused'
         AND f.promo_expires_at > ?
         AND (${STORED_PHONE_SQL} = ?
              OR (? IS NOT NULL AND lower(trim(f.email)) = ?))
     )`
  )
    .bind(
      feedbackId,
      nowISO,
      guestName,
      phone,
      email,
      wantsTelegram ? 1 : 0,
      rating,
      comment,
      promoCode,
      policy.discountPercent,
      expiresAt.toISOString(),
      giftOffered ? 1 : 0,
      stayDate,
      wishesNextTime,
      favoriteActivities && favoriteActivities.length ? JSON.stringify(favoriteActivities) : null,
      nowISO,
      normalizePhone(phone),
      normalizedEmail,
      normalizedEmail
    )
    .run();

  if (!insert.meta || insert.meta.changes !== 1) {
    // Never echo the existing code: that would let anyone fetch vouchers by phone number.
    return jsonError(DUPLICATE_VOUCHER_ERROR, 409, cors);
  }

  // 5. Email the voucher (the voucher already exists; a Brevo failure is logged, not fatal).
  if (email) {
    const template = await env.DB.prepare(
      `SELECT id, channel, subject, body FROM message_templates WHERE channel = 'email' AND is_active = 1 LIMIT 1`
    ).first();

    if (template) {
      const rendered = renderTemplate(template, {
        guestName,
        promoCode,
        discountPercent: policy.discountPercent,
        expiresAt,
        giftOffered,
      });
      const sent = await sendPromoEmail(env, { to: email, toName: guestName, subject: rendered.subject, html: rendered.body });
      await env.DB.prepare(
        `INSERT INTO message_log (feedback_id, template_id, channel, sent_by, status, sent_at) VALUES (?, ?, 'email', 'system', ?, ?)`
      )
        .bind(feedbackId, template.id, sent ? 'success' : 'failed', new Date().toISOString())
        .run();
    }
  }

  return new Response(
    JSON.stringify({
      feedbackId,
      promoCode,
      discountPercent: policy.discountPercent,
      expiresAt: expiresAt.toISOString(),
      giftOffered,
    }),
    { status: 201, headers: { 'Content-Type': 'application/json', ...cors } }
  );
}
