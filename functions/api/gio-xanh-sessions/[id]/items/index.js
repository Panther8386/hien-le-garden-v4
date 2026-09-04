import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_SOURCES = ['gio_combo', 'mon_an_uong'];

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const session = await env.DB.prepare(`SELECT id, status FROM gio_xanh_sessions WHERE id = ?`).bind(params.id).first();
  if (!session) return jsonError('Không tìm thấy phiên', 404);
  if (session.status !== 'open') return jsonError('Chỉ có thể thêm dòng khi phiên còn đang mở', 400);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { source, sourceId, quantity } = body || {};

  if (!VALID_SOURCES.includes(source)) return jsonError('Loại dòng không hợp lệ', 400);
  if (!Number.isInteger(sourceId)) return jsonError('Vui lòng chọn mục cần thêm', 400);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return jsonError('Số lượng phải là số nguyên từ 1 đến 999', 400);

  let name, unitPrice;
  if (source === 'gio_combo') {
    const combo = await env.DB.prepare(
      `SELECT name, price_min AS price FROM service_catalog WHERE id = ? AND category = 'luu_tru' AND subgroup = 'Giờ Xanh Hiền Lê' AND is_active = 1`
    ).bind(sourceId).first();
    if (!combo) return jsonError('Combo giờ không tồn tại hoặc đã ngừng áp dụng', 400);
    name = combo.name;
    unitPrice = combo.price;
  } else {
    const menuItem = await env.DB.prepare(`SELECT name, price FROM dine_in_menu_items WHERE id = ? AND is_active = 1`).bind(sourceId).first();
    if (!menuItem) return jsonError('Món không tồn tại hoặc đã ngừng bán', 400);
    name = menuItem.name;
    unitPrice = menuItem.price;
  }

  const amount = unitPrice * quantity;
  const now = new Date().toISOString();
  const insert = await env.DB.prepare(
    `INSERT INTO gio_xanh_session_items (session_id, source, source_id, name, unit_price, quantity, amount, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)`
  ).bind(params.id, source, sourceId, name, unitPrice, quantity, amount, auth.username, now).run();

  return new Response(JSON.stringify({ id: insert.meta.last_row_id, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
