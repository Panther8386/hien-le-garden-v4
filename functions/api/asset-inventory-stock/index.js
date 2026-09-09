import { requireAuth } from '../../../lib/requireAuth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const categoryId = url.searchParams.get('categoryId');
  const locationId = url.searchParams.get('locationId');
  const managementType = url.searchParams.get('managementType');

  const clauses = ['t.voided_at IS NULL'];
  const params = [];
  if (categoryId) { clauses.push('t.category_id = ?'); params.push(Number(categoryId)); }
  if (locationId) { clauses.push('t.location_id = ?'); params.push(Number(locationId)); }
  if (managementType) { clauses.push('c.management_type = ?'); params.push(managementType); }

  const { results } = await env.DB.prepare(
    `SELECT t.category_id AS categoryId, t.location_id AS locationId, c.name AS categoryName,
            c.management_type AS managementType, c.default_unit AS unit, l.name AS locationName,
            SUM(t.quantity_delta) AS quantity,
            SUM(CASE WHEN t.linen_status = 'sach' THEN t.quantity_delta ELSE 0 END) AS sach,
            SUM(CASE WHEN t.linen_status = 'cap_dung' THEN t.quantity_delta ELSE 0 END) AS capDung,
            SUM(CASE WHEN t.linen_status = 'ban' THEN t.quantity_delta ELSE 0 END) AS ban,
            SUM(CASE WHEN t.linen_status = 'dang_giat' THEN t.quantity_delta ELSE 0 END) AS dangGiat
     FROM asset_inventory_transactions t
     JOIN asset_categories c ON c.id = t.category_id
     JOIN asset_locations l ON l.id = t.location_id
     WHERE ${clauses.join(' AND ')}
     GROUP BY t.category_id, t.location_id
     ORDER BY c.management_type, c.name, l.name`
  ).bind(...params).all();

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
