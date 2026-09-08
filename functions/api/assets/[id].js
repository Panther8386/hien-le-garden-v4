import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_SOURCE_TYPES = ['handover_a', 'purchased_b', 'other'];
const VALID_PHYSICAL_CONDITIONS = ['tot', 'kha', 'trung_binh', 'can_sua', 'chua_danh_gia'];
const VALID_OPERATIONAL_STATUSES = ['san_sang', 'dang_su_dung', 'ngung_su_dung', 'dang_sua'];
const VALID_LIFECYCLE_STATUSES = ['dang_quan_ly', 'da_hoan_tra', 'da_thanh_ly'];
const INDIVIDUAL_MANAGEMENT_TYPES = ['individual_device', 'device_set'];

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(
    `SELECT a.*, c.management_type FROM assets a JOIN asset_categories c ON c.id = a.category_id WHERE a.id = ?`
  ).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy tài sản', 404);
  if (existing.is_deleted) return jsonError('Tài sản này đã bị xoá', 400);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};
  if ('categoryId' in body) return jsonError('Không thể đổi danh mục của tài sản đã tạo', 400);

  const name = 'name' in body ? body.name : existing.name;
  const brand = 'brand' in body ? body.brand : existing.brand;
  const serialNumber = 'serialNumber' in body ? body.serialNumber : existing.serial_number;
  const sourceType = 'sourceType' in body ? body.sourceType : existing.source_type;
  const acquiredDate = 'acquiredDate' in body ? body.acquiredDate : existing.acquired_date;
  const purchasePrice = 'purchasePrice' in body ? body.purchasePrice : existing.purchase_price;
  const locationId = 'locationId' in body ? body.locationId : existing.location_id;
  const holder = 'holder' in body ? body.holder : existing.holder;
  const physicalCondition = 'physicalCondition' in body ? body.physicalCondition : existing.physical_condition;
  const operationalStatus = 'operationalStatus' in body ? body.operationalStatus : existing.operational_status;
  const lifecycleStatus = 'lifecycleStatus' in body ? body.lifecycleStatus : existing.lifecycle_status;
  const note = 'note' in body ? body.note : existing.note;

  const isIndividual = INDIVIDUAL_MANAGEMENT_TYPES.includes(existing.management_type);
  const quantity = isIndividual ? 1 : ('quantity' in body ? body.quantity : existing.quantity);

  if (typeof name !== 'string' || name.trim() === '') return jsonError('Vui lòng nhập tên tài sản', 400);
  if (!VALID_SOURCE_TYPES.includes(sourceType)) return jsonError('Nguồn hình thành không hợp lệ', 400);
  if (!VALID_PHYSICAL_CONDITIONS.includes(physicalCondition)) return jsonError('Tình trạng vật lý không hợp lệ', 400);
  if (!VALID_OPERATIONAL_STATUSES.includes(operationalStatus)) return jsonError('Trạng thái hoạt động không hợp lệ', 400);
  if (!VALID_LIFECYCLE_STATUSES.includes(lifecycleStatus)) return jsonError('Trạng thái vòng đời không hợp lệ', 400);
  if (quantity !== null && quantity !== undefined && !Number.isInteger(quantity)) return jsonError('Số lượng phải là số nguyên', 400);

  if (locationId !== null && locationId !== undefined) {
    const location = await env.DB.prepare(`SELECT id FROM asset_locations WHERE id = ?`).bind(locationId).first();
    if (!location) return jsonError('Không tìm thấy vị trí', 400);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE assets SET name = ?, brand = ?, serial_number = ?, source_type = ?, acquired_date = ?, purchase_price = ?, location_id = ?, holder = ?, quantity = ?, physical_condition = ?, operational_status = ?, lifecycle_status = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).bind(name.trim(), brand || null, serialNumber || null, sourceType, acquiredDate || null, purchasePrice ?? null, locationId ?? null, holder || null, quantity ?? null, physicalCondition, operationalStatus, lifecycleStatus, note || null, auth.username, now, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('asset_update', 'asset', ?, ?, ?, ?, ?, ?)`
    ).bind(params.id, name.trim(), existing.name, name.trim(), auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, null);
  if (auth instanceof Response) return auth;
  if (!auth.canDeleteAsset || auth.role === 'observer') return jsonError('Tài khoản không có quyền xoá tài sản', 403);

  const existing = await env.DB.prepare(`SELECT id, name, is_deleted FROM assets WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy tài sản', 404);
  if (existing.is_deleted) return jsonError('Tài sản này đã bị xoá', 400);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE assets SET is_deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?`).bind(auth.username, now, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('asset_delete', 'asset', ?, ?, NULL, NULL, ?, ?)`
    ).bind(params.id, existing.name, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
