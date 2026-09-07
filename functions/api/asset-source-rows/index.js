import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

function coerceRow(r) {
  return {
    id: r.id,
    sourceDocumentId: r.source_document_id,
    sourceGroupLabel: r.source_group_label,
    stt: r.stt,
    rawName: r.raw_name,
    rawUnit: r.raw_unit,
    rawQuantity: r.raw_quantity,
    rawCondition: r.raw_condition,
    rawNote: r.raw_note,
    createdAt: r.created_at,
    reconciledCount: r.reconciled_count,
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const documentIdParam = url.searchParams.get('documentId');
  if (!documentIdParam) return jsonError('Thiếu documentId', 400);
  const documentId = Number(documentIdParam);
  if (!Number.isInteger(documentId)) return jsonError('documentId không hợp lệ', 400);

  const { results } = await env.DB.prepare(
    `SELECT r.*, (SELECT COALESCE(SUM(quantity), 0) FROM assets WHERE assets.source_row_id = r.id) AS reconciled_count
     FROM asset_source_rows r WHERE r.source_document_id = ? ORDER BY r.stt`
  ).bind(documentId).all();

  return new Response(JSON.stringify(results.map(coerceRow)), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
