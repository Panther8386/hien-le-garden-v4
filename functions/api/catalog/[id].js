import { requireAuth } from '../../../lib/requireAuth.js';
import { ROOM_TYPES } from '../../../lib/roomTypes.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_CATEGORIES = ['luu_tru', 'fnb_hoat_dong', 'su_kien_team_building'];
const VALID_PRICE_TYPES = ['range', 'fixed', 'label'];
const VALID_ROOM_TYPE_KEYS = Object.keys(ROOM_TYPES);

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM service_catalog WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy dịch vụ', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }

  const category = body.category !== undefined ? body.category : existing.category;
  const subgroup = body.subgroup !== undefined ? body.subgroup : existing.subgroup;
  const name = body.name !== undefined ? body.name : existing.name;
  const priceType = body.priceType !== undefined ? body.priceType : existing.price_type;
  const priceMin = body.priceMin !== undefined ? body.priceMin : existing.price_min;
  const priceMax = body.priceMax !== undefined ? body.priceMax : existing.price_max;
  const priceLabel = body.priceLabel !== undefined ? body.priceLabel : existing.price_label;
  const unitCapacity = body.unitCapacity !== undefined ? body.unitCapacity : existing.unit_capacity;
  const note = body.note !== undefined ? body.note : existing.note;
  const roomTypeKey = body.roomTypeKey !== undefined ? body.roomTypeKey : existing.room_type_key;
  const displayOrder = body.displayOrder !== undefined ? body.displayOrder : existing.display_order;
  const isActive = body.isActive !== undefined ? body.isActive : !!existing.is_active;
  const isScheduled = body.isScheduled !== undefined ? body.isScheduled : !!existing.is_scheduled;
  const termsAndConditions = body.termsAndConditions !== undefined ? body.termsAndConditions : existing.terms_and_conditions;

  if (!VALID_CATEGORIES.includes(category)) return jsonError('Hạng mục không hợp lệ', 400);
  if (typeof name !== 'string' || name.trim() === '') return jsonError('Tên dịch vụ không được để trống', 400);
  if (!VALID_PRICE_TYPES.includes(priceType)) return jsonError('Kiểu giá không hợp lệ', 400);
  if (priceType === 'range' && (!Number.isInteger(priceMin) || priceMin < 0 || !Number.isInteger(priceMax) || priceMax < priceMin)) {
    return jsonError('Khoảng giá không hợp lệ: cần Giá A và Giá B là số nguyên không âm, Giá B >= Giá A', 400);
  }
  if (priceType === 'fixed' && (!Number.isInteger(priceMin) || priceMin < 0)) {
    return jsonError('Giá cố định phải là số nguyên không âm', 400);
  }
  if (priceType === 'label' && (typeof priceLabel !== 'string' || priceLabel.trim() === '')) {
    return jsonError('Nhãn giá không được để trống', 400);
  }
  if (roomTypeKey != null && !VALID_ROOM_TYPE_KEYS.includes(roomTypeKey)) return jsonError('Loại phòng liên kết không hợp lệ', 400);
  if (termsAndConditions != null && typeof termsAndConditions !== 'string') return jsonError('Điều khoản & điều kiện không hợp lệ', 400);

  if (roomTypeKey && isActive) {
    const conflict = await env.DB.prepare(`SELECT id FROM service_catalog WHERE room_type_key = ? AND is_active = 1 AND id != ?`).bind(roomTypeKey, params.id).first();
    if (conflict) return jsonError('Loại phòng này đã được liên kết với 1 dòng khác', 400);
  }

  const finalPriceMin = priceType === 'label' ? null : priceMin;
  const finalPriceMax = priceType === 'range' ? priceMax : null;
  const finalPriceLabel = priceType === 'label' ? priceLabel : null;

  await env.DB.prepare(
    `UPDATE service_catalog SET category = ?, subgroup = ?, name = ?, price_type = ?, price_min = ?, price_max = ?,
       price_label = ?, unit_capacity = ?, note = ?, room_type_key = ?, display_order = ?, is_active = ?, is_scheduled = ?, terms_and_conditions = ?,
       updated_by = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      category,
      subgroup || null,
      typeof name === 'string' ? name.trim() : name,
      priceType,
      finalPriceMin,
      finalPriceMax,
      finalPriceLabel,
      unitCapacity || null,
      note || null,
      roomTypeKey || null,
      Number.isInteger(displayOrder) ? displayOrder : 0,
      isActive ? 1 : 0,
      isScheduled ? 1 : 0,
      termsAndConditions || null,
      auth.username,
      new Date().toISOString(),
      params.id
    )
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT id FROM service_catalog WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy dịch vụ', 404);

  await env.DB.prepare(`DELETE FROM service_catalog WHERE id = ?`).bind(params.id).run();
  return new Response(null, { status: 204 });
}
