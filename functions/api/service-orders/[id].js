import { redactContact } from '../../../lib/redactContact.js';
import { json, jsonError, NOT_FOUND, requireOrderPermission, loadVisibleOrder, loadItems, loadDeposits, coerceOrder } from '../../../lib/serviceOrders.js';

export async function onRequestGet({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.view');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  const out = coerceOrder(order, await loadItems(env.DB, order.id), await loadDeposits(env.DB, order.id));
  redactContact(auth, out);
  return json(out);
}
