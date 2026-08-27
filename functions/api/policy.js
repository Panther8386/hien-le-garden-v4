import { requireAuth } from '../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { discountPercent, validFrom, validTo, giftEnabled } = body;

  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    return jsonError('Phần trăm giảm giá phải là số nguyên từ 0 đến 100', 400);
  }
  if (typeof validFrom !== 'string' || isNaN(Date.parse(validFrom))) {
    return jsonError('Ngày bắt đầu không hợp lệ', 400);
  }
  if (typeof validTo !== 'string' || isNaN(Date.parse(validTo))) {
    return jsonError('Ngày kết thúc không hợp lệ', 400);
  }
  if (Date.parse(validFrom) > Date.parse(validTo)) {
    return jsonError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc', 400);
  }

  await env.DB.prepare(
    `INSERT INTO promo_policy (discount_percent, valid_from, valid_to, is_active, gift_enabled, updated_by, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`
  )
    .bind(discountPercent, validFrom, validTo, giftEnabled ? 1 : 0, auth.username, new Date().toISOString())
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    `SELECT id, discount_percent AS discountPercent, valid_from AS validFrom, valid_to AS validTo,
            is_active AS isActive, gift_enabled AS giftEnabled
     FROM promo_policy ORDER BY id DESC`
  ).all();

  const coercedResults = results.map(row => ({
    ...row,
    isActive: !!row.isActive,
    giftEnabled: !!row.giftEnabled,
  }));

  return new Response(JSON.stringify(coercedResults), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT is_active, valid_from, valid_to FROM promo_policy WHERE id = ?`).bind(params.id).first();
  if (!existing) {
    return jsonError('Không tìm thấy chương trình khuyến mãi', 404);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (existing.is_active && existing.valid_from <= today && existing.valid_to >= today) {
    return jsonError('Không thể xoá chương trình đang áp dụng cho hôm nay', 400);
  }

  await env.DB.prepare(`DELETE FROM promo_policy WHERE id = ?`).bind(params.id).run();
  return new Response(null, { status: 204 });
}
