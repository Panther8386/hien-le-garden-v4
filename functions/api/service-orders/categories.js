import { json, requireOrderPermission } from '../../../lib/serviceOrders.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.view');
  if (auth instanceof Response) return auth;
  const { results } = await env.DB.prepare(`SELECT slug, label, is_active FROM finance_categories WHERE type = 'income' ORDER BY display_order, id`).all();
  return json(results.map((r) => ({ slug: r.slug, label: r.label, isActive: !!r.is_active })));
}
