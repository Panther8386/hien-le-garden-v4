import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
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
  const { serviceCatalogId, unitPrice, quantity } = body || {};

  if (!Number.isInteger(serviceCatalogId)) {
    return jsonError('Vui lòng chọn dịch vụ', 400);
  }
  if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    return jsonError('Giá phải là số nguyên không âm', 400);
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return jsonError('Số lượng phải là số nguyên lớn hơn 0', 400);
  }

  const catalogItem = await env.DB.prepare(`SELECT id, name FROM service_catalog WHERE id = ? AND is_active = 1`).bind(serviceCatalogId).first();
  if (!catalogItem) {
    return jsonError('Dịch vụ không tồn tại hoặc đã ngừng bán', 400);
  }

  const amount = unitPrice * quantity;
  const now = new Date().toISOString();

  const result = await env.DB.prepare(
    `INSERT INTO booking_service_items (booking_id, service_catalog_id, name, unit_price, quantity, amount, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'posted', ?, ?)`
  )
    .bind(params.id, catalogItem.id, catalogItem.name, unitPrice, quantity, amount, auth.username, now)
    .run();

  return new Response(JSON.stringify({ id: result.meta.last_row_id, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
