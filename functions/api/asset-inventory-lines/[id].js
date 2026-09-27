// v4/functions/api/asset-inventory-lines/[id].js
import { requireAuth } from '../../../lib/requireAuth.js';
import { hasPermission } from '../../../lib/permissions.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_CONDITIONS = ['tot', 'kha', 'trung_binh', 'can_sua', 'chua_danh_gia'];

function canWriteLine(auth, batchStatus) {
  if (batchStatus === 'counting') return true;
  if (batchStatus === 'pending_close') return hasPermission(auth, 'assets.manage');
  return false;
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, 'assets.count');
  if (auth instanceof Response) return auth;
  // Mutating requires seeing the resource: without assets.view answer like a missing id.
  if (!hasPermission(auth, 'assets.view')) return jsonError('Không tìm thấy dòng kiểm kê', 404);

  const line = await env.DB.prepare(
    `SELECT l.*, b.status AS batch_status FROM asset_inventory_lines l JOIN asset_inventory_batches b ON b.id = l.batch_id WHERE l.id = ?`
  ).bind(params.id).first();
  if (!line) return jsonError('Không tìm thấy dòng kiểm kê', 404);
  if (!canWriteLine(auth, line.batch_status)) return jsonError('Không thể sửa dòng kiểm kê ở trạng thái đợt hiện tại', 400);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};

  const actualQuantity = 'actualQuantity' in body ? body.actualQuantity : line.actual_quantity;
  const conditionFound = 'conditionFound' in body ? body.conditionFound : line.condition_found;
  const note = 'note' in body ? body.note : line.note;
  const suggestedAction = 'suggestedAction' in body ? body.suggestedAction : line.suggested_action;

  if (actualQuantity !== null && actualQuantity !== undefined && (!Number.isInteger(actualQuantity) || actualQuantity < 0)) {
    return jsonError('Số lượng thực tế phải là số nguyên không âm', 400);
  }
  if (conditionFound !== null && conditionFound !== undefined && conditionFound !== '' && !VALID_CONDITIONS.includes(conditionFound)) {
    return jsonError('Tình trạng không hợp lệ', 400);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE asset_inventory_lines SET actual_quantity = ?, condition_found = ?, note = ?, suggested_action = ?, updated_by = ?, updated_at = ? WHERE id = ?`
  ).bind(actualQuantity ?? null, conditionFound || null, note || null, suggestedAction || null, auth.username, now, params.id).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
