import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

async function computeRemaining(env, slotTemplateId, experienceDate, capacity) {
  const bookedRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(quantity), 0) AS booked FROM booking_service_items
     WHERE slot_template_id = ? AND experience_date = ? AND status = 'posted'`
  ).bind(slotTemplateId, experienceDate).first();
  return capacity - bookedRow.booked;
}

async function findAlternativeSlots(env, catalogId, fromDate, requiredQuantity) {
  const settingsRow = await env.DB.prepare(
    `SELECT suggestion_window_days AS suggestionWindowDays, max_suggestions AS maxSuggestions FROM experience_booking_settings ORDER BY id DESC LIMIT 1`
  ).first();
  const { suggestionWindowDays, maxSuggestions } = settingsRow || { suggestionWindowDays: 14, maxSuggestions: 5 };

  const { results: templates } = await env.DB.prepare(
    `SELECT id, label, start_time AS startTime, capacity, days_of_week AS daysOfWeek FROM service_slot_template WHERE service_catalog_id = ? AND is_active = 1`
  ).bind(catalogId).all();

  const candidates = [];
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const startDate = new Date(Date.UTC(fy, fm - 1, fd));

  for (let offset = 0; offset <= suggestionWindowDays; offset++) {
    const candidateDate = new Date(startDate.getTime() + offset * 86400000);
    const dateStr = candidateDate.toISOString().slice(0, 10);
    const weekday = candidateDate.getUTCDay();

    for (const template of templates) {
      if (!template.daysOfWeek.split(',').map(Number).includes(weekday)) continue;
      const remaining = await computeRemaining(env, template.id, dateStr, template.capacity);
      if (remaining >= requiredQuantity) {
        candidates.push({ date: dateStr, slotTemplateId: template.id, label: template.label, startTime: template.startTime, remaining });
      }
    }
  }

  candidates.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));
  return candidates.slice(0, maxSuggestions);
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const booking = await env.DB.prepare(`SELECT id, status FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }
  if (booking.status !== 'confirmed' && booking.status !== 'checked_in') {
    return jsonError('Chỉ có thể thêm dịch vụ cho đặt phòng đã xác nhận hoặc đang lưu trú', 400);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { serviceCatalogId, unitPrice, quantity, paid, paymentMethod, experienceDate, slotTemplateId, termsAccepted } = body || {};

  if (!Number.isInteger(serviceCatalogId)) {
    return jsonError('Vui lòng chọn dịch vụ', 400);
  }
  if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    return jsonError('Giá phải là số nguyên không âm', 400);
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return jsonError('Số lượng phải là số nguyên lớn hơn 0', 400);
  }
  if (paid === true && paymentMethod !== 'cash' && paymentMethod !== 'transfer') {
    return jsonError('Vui lòng chọn hình thức thanh toán', 400);
  }

  const catalogItem = await env.DB.prepare(
    `SELECT id, name, is_scheduled AS isScheduled, terms_and_conditions AS termsAndConditions FROM service_catalog WHERE id = ? AND is_active = 1`
  ).bind(serviceCatalogId).first();
  if (!catalogItem) {
    return jsonError('Dịch vụ không tồn tại hoặc đã ngừng bán', 400);
  }

  let template = null;
  if (catalogItem.isScheduled) {
    if (typeof experienceDate !== 'string' || !DATE_FORMAT.test(experienceDate)) {
      return jsonError('Vui lòng chọn ngày hợp lệ', 400);
    }
    if (!Number.isInteger(slotTemplateId)) {
      return jsonError('Vui lòng chọn khung giờ', 400);
    }

    template = await env.DB.prepare(
      `SELECT id, label, start_time, capacity, days_of_week FROM service_slot_template WHERE id = ? AND service_catalog_id = ? AND is_active = 1`
    ).bind(slotTemplateId, catalogItem.id).first();
    if (!template) {
      return jsonError('Khung giờ không hợp lệ hoặc đã ngừng áp dụng', 400);
    }

    const weekday = weekdayOf(experienceDate);
    if (!template.days_of_week.split(',').map(Number).includes(weekday)) {
      return jsonError('Khung giờ này không áp dụng cho ngày đã chọn', 400);
    }

    const remaining = await computeRemaining(env, slotTemplateId, experienceDate, template.capacity);
    if (quantity > remaining) {
      const alternatives = await findAlternativeSlots(env, catalogItem.id, experienceDate, quantity);
      return new Response(
        JSON.stringify({ error: `Suất này chỉ còn ${remaining} chỗ, không đủ cho ${quantity} khách`, alternatives }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (catalogItem.termsAndConditions && termsAccepted !== true) {
      return jsonError('Vui lòng xác nhận đã thông báo điều khoản dịch vụ cho khách', 400);
    }
  }

  const amount = unitPrice * quantity;
  const now = new Date().toISOString();
  const paymentStatus = paid === true ? 'paid' : 'pending';
  const resolvedPaymentMethod = paid === true ? paymentMethod : null;
  const resolvedTermsAcceptedAt = template && catalogItem.termsAndConditions && termsAccepted === true ? now : null;

  const result = await env.DB.prepare(
    `INSERT INTO booking_service_items (booking_id, service_catalog_id, name, unit_price, quantity, amount, status, created_by, created_at, payment_status, payment_method, experience_date, slot_template_id, experience_slot_label, experience_start_time, terms_accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      params.id,
      catalogItem.id,
      catalogItem.name,
      unitPrice,
      quantity,
      amount,
      auth.username,
      now,
      paymentStatus,
      resolvedPaymentMethod,
      template ? experienceDate : null,
      template ? slotTemplateId : null,
      template ? template.label : null,
      template ? template.start_time : null,
      resolvedTermsAcceptedAt
    )
    .run();

  return new Response(JSON.stringify({ id: result.meta.last_row_id, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
