import { requireAuth } from '../../../../../lib/requireAuth.js';
import { hasPermission } from '../../../../../lib/permissions.js';
import { canSeeHidden } from '../../../../../lib/hiddenAccess.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, 'dine_in.manage');
  if (auth instanceof Response) return auth;
  // Mutating requires seeing the resource: without dine_in.view answer like a missing id.
  if (!hasPermission(auth, 'dine_in.view')) return jsonError('Không tìm thấy order', 404);

  const order = await env.DB.prepare(`SELECT id, status, is_hidden FROM dine_in_orders WHERE id = ?`).bind(params.id).first();
  // A hidden parent order answers exactly like a non-existent id for anyone without records.hide.
  if (!order || !canSeeHidden(auth, order)) return jsonError('Không tìm thấy order', 404);
  if (order.status !== 'open') return jsonError('Chỉ có thể thêm món khi bàn còn đang mở', 400);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { menuItemId, quantity } = body || {};
  if (!Number.isInteger(menuItemId)) return jsonError('Vui lòng chọn món', 400);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return jsonError('Số lượng phải là số nguyên từ 1 đến 999', 400);

  const menuItem = await env.DB.prepare(`SELECT id, name, price FROM dine_in_menu_items WHERE id = ? AND is_active = 1`).bind(menuItemId).first();
  if (!menuItem) return jsonError('Món không tồn tại hoặc đã ngừng bán', 400);

  const amount = menuItem.price * quantity;
  const now = new Date().toISOString();
  // Guarded insert: only lands while the order is still 'open', so an item can never be added to an
  // order that a concurrent close/void finished after the pre-check above.
  const insert = await env.DB.prepare(
    `INSERT INTO dine_in_order_items (order_id, menu_item_id, name, unit_price, quantity, amount, status, created_by, created_at)
     SELECT ?, ?, ?, ?, ?, ?, 'posted', ?, ?
     WHERE EXISTS (SELECT 1 FROM dine_in_orders WHERE id = ? AND status = 'open')`
  ).bind(params.id, menuItem.id, menuItem.name, menuItem.price, quantity, amount, auth.username, now, params.id).run();
  if (insert.meta.changes === 0) return jsonError('Chỉ có thể thêm món khi bàn còn đang mở', 400);

  return new Response(JSON.stringify({ id: insert.meta.last_row_id, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
