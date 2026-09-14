import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const KHO_MANAGEMENT_TYPES = ['consumable', 'spare_part', 'food_beverage', 'linen'];
const SINGLE_MOVEMENT_TYPES = ['opening', 'purchase', 'consume', 'serve', 'repair_use', 'repair_return', 'damage', 'loss', 'expired', 'adjustment', 'return_out_of_scope'];
const POSITIVE_SINGLE_TYPES = ['opening', 'purchase', 'repair_return'];
const NEGATIVE_SINGLE_TYPES = ['consume', 'serve', 'repair_use', 'damage', 'loss', 'expired', 'return_out_of_scope'];
const LINEN_STATUSES = ['sach', 'cap_dung', 'ban', 'dang_giat'];
const LINEN_TRANSITIONS = {
  'sach->cap_dung': 'issue',
  'cap_dung->ban': 'soil',
  'ban->dang_giat': 'send_wash',
  'dang_giat->sach': 'return',
};

function coerceRow(r) {
  return {
    id: r.id,
    categoryId: r.category_id,
    locationId: r.location_id,
    lotId: r.lot_id,
    movementType: r.movement_type,
    linenStatus: r.linen_status,
    quantityDelta: r.quantity_delta,
    unit: r.unit,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    recipient: r.recipient,
    reason: r.reason,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
    voidedBy: r.voided_by,
    voidedAt: r.voided_at,
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const categoryId = url.searchParams.get('categoryId');
  const locationId = url.searchParams.get('locationId');
  const movementType = url.searchParams.get('movementType');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const clauses = [];
  const params = [];
  if (categoryId) { clauses.push('category_id = ?'); params.push(Number(categoryId)); }
  if (locationId) { clauses.push('location_id = ?'); params.push(Number(locationId)); }
  if (movementType) { clauses.push('movement_type = ?'); params.push(movementType); }
  if (from) { clauses.push('created_at >= ?'); params.push(from); }
  if (to) { clauses.push('created_at <= ?'); params.push(to); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT * FROM asset_inventory_transactions ${where} ORDER BY created_at DESC, id DESC`
  ).bind(...params).all();

  return new Response(JSON.stringify(results.map(coerceRow)), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function loadCategory(env, categoryId) {
  if (!Number.isInteger(categoryId)) return null;
  return env.DB.prepare(`SELECT id, management_type, default_unit FROM asset_categories WHERE id = ?`).bind(categoryId).first();
}

async function loadLocation(env, locationId) {
  if (!Number.isInteger(locationId)) return null;
  return env.DB.prepare(`SELECT id FROM asset_locations WHERE id = ?`).bind(locationId).first();
}

async function insertOutGuarded(env, p) {
  const result = await env.DB.prepare(
    `INSERT INTO asset_inventory_transactions (
       category_id, location_id, lot_id, movement_type, linen_status,
       quantity_delta, unit, reference_type, reference_id, recipient, reason, note,
       created_by, created_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (
       SELECT COALESCE(SUM(quantity_delta), 0) FROM asset_inventory_transactions
       WHERE category_id = ? AND location_id = ?
         AND ((? IS NULL AND lot_id IS NULL) OR lot_id = ?)
         AND (? IS NULL OR linen_status = ?)
         AND voided_at IS NULL
     ) + ? >= 0`
  ).bind(
    p.categoryId, p.locationId, p.lotId ?? null, p.movementType, p.linenStatus ?? null,
    p.quantityDelta, p.unit, p.referenceType ?? null, p.referenceId ?? null, p.recipient ?? null, p.reason ?? null, p.note ?? null,
    p.actor, p.now,
    p.categoryId, p.locationId, p.lotId ?? null, p.lotId ?? null, p.linenStatus ?? null, p.linenStatus ?? null,
    p.quantityDelta
  ).run();
  return result.meta.changes === 1;
}

function insertInStatement(env, p) {
  return env.DB.prepare(
    `INSERT INTO asset_inventory_transactions (
       category_id, location_id, lot_id, movement_type, linen_status,
       quantity_delta, unit, reference_type, reference_id, recipient, reason, note,
       created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    p.categoryId, p.locationId, p.lotId ?? null, p.movementType, p.linenStatus ?? null,
    p.quantityDelta, p.unit, p.referenceType ?? null, p.referenceId ?? null, p.recipient ?? null, p.reason ?? null, p.note ?? null,
    p.actor, p.now
  );
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};
  const now = new Date().toISOString();

  if (body.action === 'single') {
    const { categoryId, locationId, lotId, movementType, quantity, direction, linenStatus, referenceType, referenceId, recipient, reason, note } = body;
    if (!SINGLE_MOVEMENT_TYPES.includes(movementType)) return jsonError('Loại giao dịch không hợp lệ', 400);
    if (!Number.isFinite(quantity) || quantity <= 0) return jsonError('Số lượng phải là số dương', 400);
    const category = await loadCategory(env, categoryId);
    if (!category) return jsonError('Không tìm thấy danh mục', 404);
    if (!KHO_MANAGEMENT_TYPES.includes(category.management_type)) return jsonError('Danh mục này không thuộc phạm vi quản lý kho', 400);
    const location = await loadLocation(env, locationId);
    if (!location) return jsonError('Không tìm thấy vị trí', 404);
    if (lotId != null) {
      if (category.management_type !== 'food_beverage') return jsonError('Chỉ thực phẩm/thức uống mới có lô', 400);
      const lot = await env.DB.prepare(`SELECT id FROM asset_inventory_food_lots WHERE id = ?`).bind(lotId).first();
      if (!lot) return jsonError('Không tìm thấy lô', 404);
    }
    if (category.management_type === 'linen') {
      if (!LINEN_STATUSES.includes(linenStatus)) return jsonError('Vui lòng chọn trạng thái đồ vải', 400);
    } else if (linenStatus != null) {
      return jsonError('Chỉ danh mục đồ vải luân chuyển mới có trạng thái', 400);
    }
    if ((referenceType != null) !== (referenceId != null)) return jsonError('referenceType và referenceId phải đi cùng nhau', 400);

    let signedQuantity;
    if (POSITIVE_SINGLE_TYPES.includes(movementType)) {
      signedQuantity = quantity;
    } else if (NEGATIVE_SINGLE_TYPES.includes(movementType)) {
      signedQuantity = -quantity;
    } else {
      if (direction !== 'increase' && direction !== 'decrease') return jsonError('Vui lòng chọn tăng hoặc giảm', 400);
      signedQuantity = direction === 'decrease' ? -quantity : quantity;
    }

    const p = { categoryId, locationId, lotId: lotId ?? null, movementType, linenStatus: linenStatus ?? null, quantityDelta: signedQuantity, unit: category.default_unit, referenceType, referenceId, recipient, reason, note, actor: auth.username, now };
    if (signedQuantity < 0) {
      const ok = await insertOutGuarded(env, p);
      if (!ok) return jsonError('Không đủ tồn kho', 400);
    } else {
      await insertInStatement(env, p).run();
    }
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }

  if (body.action === 'transfer') {
    const { categoryId, fromLocationId, toLocationId, quantity, note } = body;
    if (!Number.isFinite(quantity) || quantity <= 0) return jsonError('Số lượng phải là số dương', 400);
    if (fromLocationId === toLocationId) return jsonError('Kho nguồn và kho đích phải khác nhau', 400);
    const category = await loadCategory(env, categoryId);
    if (!category) return jsonError('Không tìm thấy danh mục', 404);
    if (!KHO_MANAGEMENT_TYPES.includes(category.management_type)) return jsonError('Danh mục này không thuộc phạm vi quản lý kho', 400);
    const fromLoc = await loadLocation(env, fromLocationId);
    if (!fromLoc) return jsonError('Không tìm thấy kho nguồn', 404);
    const toLoc = await loadLocation(env, toLocationId);
    if (!toLoc) return jsonError('Không tìm thấy kho đích', 404);

    const outOk = await insertOutGuarded(env, { categoryId, locationId: fromLocationId, lotId: null, movementType: 'transfer_out', quantityDelta: -quantity, unit: category.default_unit, note, actor: auth.username, now });
    if (!outOk) return jsonError('Không đủ tồn kho', 400);
    await insertInStatement(env, { categoryId, locationId: toLocationId, lotId: null, movementType: 'transfer_in', quantityDelta: quantity, unit: category.default_unit, note, actor: auth.username, now }).run();
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }

  if (body.action === 'linenTransition') {
    const { categoryId, locationId, fromStatus, toStatus, quantity, note } = body;
    if (!Number.isFinite(quantity) || quantity <= 0) return jsonError('Số lượng phải là số dương', 400);
    const movementType = LINEN_TRANSITIONS[`${fromStatus}->${toStatus}`];
    if (!movementType) return jsonError('Chuyển trạng thái không hợp lệ', 400);
    const category = await loadCategory(env, categoryId);
    if (!category) return jsonError('Không tìm thấy danh mục', 404);
    if (category.management_type !== 'linen') return jsonError('Danh mục này không phải đồ vải luân chuyển', 400);
    const location = await loadLocation(env, locationId);
    if (!location) return jsonError('Không tìm thấy vị trí', 404);

    const outOk = await insertOutGuarded(env, { categoryId, locationId, lotId: null, movementType, linenStatus: fromStatus, quantityDelta: -quantity, unit: category.default_unit, note, actor: auth.username, now });
    if (!outOk) return jsonError('Không đủ tồn ở trạng thái này', 400);
    await insertInStatement(env, { categoryId, locationId, lotId: null, movementType, linenStatus: toStatus, quantityDelta: quantity, unit: category.default_unit, note, actor: auth.username, now }).run();
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }

  return jsonError('Loại thao tác không hợp lệ', 400);
}
