import { requireAuth } from '../../../lib/requireAuth.js';

function coerceRow(r) {
  return {
    id: r.id,
    title: r.title,
    contractRef: r.contract_ref,
    documentDate: r.document_date,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(`SELECT * FROM asset_source_documents ORDER BY id`).all();
  return new Response(JSON.stringify(results.map(coerceRow)), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
