import { requireAuth } from '../../../lib/requireAuth.js';
import { ROOM_TYPES } from '../../../lib/roomTypes.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_CATEGORIES = ['luu_tru', 'fnb_hoat_dong', 'su_kien_team_building'];
const VALID_PRICE_TYPES = ['range', 'fixed', 'label'];
const VALID_ROOM_TYPE_KEYS = Object.keys(ROOM_TYPES);

function validateCatalogFields(body) {
  const { category, name, priceType, priceMin, priceMax, priceLabel, roomTypeKey, subgroup, unitCapacity, note } = body;

  if (!VALID_CATEGORIES.includes(category)) return 'Hạng mục không hợp lệ';
  if (typeof name !== 'string' || name.trim() === '') return 'Tên dịch vụ không được để trống';
  if (!VALID_PRICE_TYPES.includes(priceType)) return 'Kiểu giá không hợp lệ';

  if (priceType === 'range') {
    if (!Number.isInteger(priceMin) || priceMin < 0 || !Number.isInteger(priceMax) || priceMax < priceMin) {
      return 'Khoảng giá không hợp lệ: cần Giá A và Giá B là số nguyên không âm, Giá B >= Giá A';
    }
  } else if (priceType === 'fixed') {
    if (!Number.isInteger(priceMin) || priceMin < 0) return 'Giá cố định phải là số nguyên không âm';
  } else if (priceType === 'label') {
    if (typeof priceLabel !== 'string' || priceLabel.trim() === '') return 'Nhãn giá không được để trống';
  }

  if (roomTypeKey != null && !VALID_ROOM_TYPE_KEYS.includes(roomTypeKey)) return 'Loại phòng liên kết không hợp lệ';
  if (subgroup != null && typeof subgroup !== 'string') return 'Nhóm phụ không hợp lệ';
  if (unitCapacity != null && typeof unitCapacity !== 'string') return 'Đơn vị/Sức chứa không hợp lệ';
  if (note != null && typeof note !== 'string') return 'Ghi chú không hợp lệ';
  return null;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const wantsAll = url.searchParams.get('all') === '1';

  if (wantsAll) {
    const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
    if (auth instanceof Response) return auth;
  }

  const baseSelect = `SELECT id, category, subgroup, name, price_type AS priceType, price_min AS priceMin, price_max AS priceMax,
              price_label AS priceLabel, unit_capacity AS unitCapacity, note, room_type_key AS roomTypeKey,
              display_order AS displayOrder, is_active AS isActive
       FROM service_catalog`;
  const query = wantsAll
    ? `${baseSelect} ORDER BY category, subgroup, display_order`
    : `${baseSelect} WHERE is_active = 1 ORDER BY category, subgroup, display_order`;

  const { results } = await env.DB.prepare(query).all();
  const coerced = results.map((row) => ({ ...row, isActive: !!row.isActive }));

  return new Response(JSON.stringify(coerced), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }

  const validationError = validateCatalogFields(body);
  if (validationError) return jsonError(validationError, 400);

  const { category, subgroup, name, priceType, priceMin, priceMax, priceLabel, unitCapacity, note, roomTypeKey, displayOrder } = body;

  if (roomTypeKey) {
    const conflict = await env.DB.prepare(`SELECT id FROM service_catalog WHERE room_type_key = ? AND is_active = 1`).bind(roomTypeKey).first();
    if (conflict) return jsonError('Loại phòng này đã được liên kết với 1 dòng khác', 400);
  }

  const finalPriceMin = priceType === 'label' ? null : priceMin;
  const finalPriceMax = priceType === 'range' ? priceMax : null;
  const finalPriceLabel = priceType === 'label' ? priceLabel : null;

  await env.DB.prepare(
    `INSERT INTO service_catalog (category, subgroup, name, price_type, price_min, price_max, price_label, unit_capacity, note, room_type_key, display_order, is_active, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  )
    .bind(
      category,
      subgroup || null,
      name.trim(),
      priceType,
      finalPriceMin,
      finalPriceMax,
      finalPriceLabel,
      unitCapacity || null,
      note || null,
      roomTypeKey || null,
      Number.isInteger(displayOrder) ? displayOrder : 0,
      auth.username,
      new Date().toISOString()
    )
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
