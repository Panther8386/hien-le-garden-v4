import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_CATEGORIES = ['mon_an', 'do_uong'];

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { category, subgroup, direction } = body || {};
  if (!VALID_CATEGORIES.includes(category)) return jsonError('Loại món không hợp lệ', 400);
  if (direction !== 'up' && direction !== 'down') return jsonError('Hướng di chuyển không hợp lệ', 400);

  const { results: allItems } = await env.DB.prepare(
    `SELECT id, subgroup, display_order FROM dine_in_menu_items WHERE category = ? ORDER BY display_order`
  ).bind(category).all();

  const blocks = [];
  allItems.forEach((it) => {
    const key = it.subgroup || null;
    const last = blocks[blocks.length - 1];
    if (last && last.key === key) {
      last.items.push(it);
    } else {
      blocks.push({ key, items: [it] });
    }
  });

  const normalizedSubgroup = subgroup || null;
  const blockIndex = blocks.findIndex((b) => b.key === normalizedSubgroup);
  if (blockIndex === -1) return jsonError('Không tìm thấy nhóm', 404);

  const targetIndex = direction === 'up' ? blockIndex - 1 : blockIndex + 1;
  if (targetIndex < 0 || targetIndex >= blocks.length) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const blockA = blocks[blockIndex];
  const blockB = blocks[targetIndex];
  const [earlierBlock, laterBlock] = blockIndex < targetIndex ? [blockA, blockB] : [blockB, blockA];
  const combinedOrders = [...earlierBlock.items, ...laterBlock.items]
    .map((it) => it.display_order)
    .sort((a, b) => a - b);

  const statements = [];
  laterBlock.items.forEach((it, i) => {
    statements.push(env.DB.prepare(`UPDATE dine_in_menu_items SET display_order = ? WHERE id = ?`).bind(combinedOrders[i], it.id));
  });
  earlierBlock.items.forEach((it, i) => {
    statements.push(env.DB.prepare(`UPDATE dine_in_menu_items SET display_order = ? WHERE id = ?`).bind(combinedOrders[laterBlock.items.length + i], it.id));
  });
  await env.DB.batch(statements);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
