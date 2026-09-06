import { requireAuth } from '../../../../lib/requireAuth.js';
import { loadCategoryMeta, categoryMatchesType } from '../../../../lib/financeCategories.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_TYPES = ['income', 'expense'];
const VALID_STATUSES = ['draft', 'confirmed', 'paid'];
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function summarize(row, categoryMeta) {
  const typeLabel = row.type === 'income' ? 'Thu' : 'Chi';
  const label = (categoryMeta && categoryMeta[row.category] && categoryMeta[row.category].label) || row.category;
  return `${typeLabel} · ${label} · ${Number(row.amount).toLocaleString('vi-VN')}đ`;
}

function coerceRow(r) {
  return {
    id: r.id,
    type: r.type,
    category: r.category,
    amount: r.amount,
    note: r.note,
    transactionDate: r.transaction_date,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
    voidedBy: r.voided_by,
    voidedAt: r.voided_at,
    receiptKey: r.receipt_key,
    receiptFilename: r.receipt_filename,
    receiptUploadedAt: r.receipt_uploaded_at,
    isHidden: !!r.is_hidden,
  };
}

const VALID_PAGE_SIZES = [10, 25, 50, 100];

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const type = url.searchParams.get('type');
  const category = url.searchParams.get('category');
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');
  const includeHidden = url.searchParams.get('includeHidden') === '1' && auth.role === 'admin';

  const pageParam = url.searchParams.get('page');
  const pageSizeParam = url.searchParams.get('pageSize');
  const page = pageParam ? Number(pageParam) : 1;
  const pageSize = pageSizeParam ? Number(pageSizeParam) : 25;
  if (!Number.isInteger(page) || page < 1) return jsonError('Trang không hợp lệ', 400);
  if (!VALID_PAGE_SIZES.includes(pageSize)) return jsonError('Số mục/trang không hợp lệ', 400);

  const clauses = [];
  const params = [];
  if (from) { clauses.push('transaction_date >= ?'); params.push(from); }
  if (to) { clauses.push('transaction_date <= ?'); params.push(to); }
  if (type) { clauses.push('type = ?'); params.push(type); }
  if (category) { clauses.push('category = ?'); params.push(category); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (q) { clauses.push('note LIKE ? COLLATE NOCASE'); params.push(`%${q}%`); }
  if (!includeHidden) { clauses.push('is_hidden = 0'); }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results: allRows } = await env.DB.prepare(
    `SELECT * FROM finance_transactions ${where} ORDER BY transaction_date DESC, id DESC`
  ).bind(...params).all();

  const total = allRows.length;
  let sumIncome = 0;
  let sumExpense = 0;
  const categoryTotals = {};
  const chartRows = [];
  for (const r of allRows) {
    chartRows.push({ transactionDate: r.transaction_date, type: r.type, amount: r.amount, status: r.status, voidedAt: r.voided_at });
    // sumIncome/sumExpense/categoryTotals represent settled revenue — matching
    // the same confirmed/paid-and-not-voided filter that GET /api/finance/summary
    // and the client's own time-chart bucketing already use for the other two
    // money figures on this page. The raw transactions/total above (and chartRows,
    // whose consumer applies this same filter itself) still include every row
    // regardless of status, so the "Giao dịch" list keeps showing drafts/voided
    // rows unchanged.
    const isSettled = !r.voided_at && (r.status === 'confirmed' || r.status === 'paid');
    if (!isSettled) continue;
    if (r.type === 'income') sumIncome += r.amount; else sumExpense += r.amount;
    if (!categoryTotals[r.category]) categoryTotals[r.category] = { income: 0, expense: 0 };
    categoryTotals[r.category][r.type] += r.amount;
  }

  const offset = (page - 1) * pageSize;
  const pageRows = allRows.slice(offset, offset + pageSize);

  return new Response(JSON.stringify({
    transactions: pageRows.map(coerceRow),
    total,
    page,
    pageSize,
    sumIncome,
    sumExpense,
    categoryTotals,
    chartRows,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
  const { type, category, amount, note, transactionDate, status } = body || {};

  const categoryMeta = await loadCategoryMeta(env);

  if (!VALID_TYPES.includes(type)) return jsonError('Loại giao dịch không hợp lệ', 400);
  if (!categoryMeta[category]) return jsonError('Danh mục không hợp lệ', 400);
  if (!categoryMeta[category].isActive) return jsonError('Danh mục không hợp lệ', 400);
  if (!categoryMatchesType(categoryMeta, category, type)) return jsonError('Danh mục không phù hợp với loại giao dịch đã chọn', 400);
  if (!Number.isInteger(amount) || amount <= 0) return jsonError('Số tiền phải là số nguyên dương', 400);
  if (typeof transactionDate !== 'string' || !DATE_FORMAT.test(transactionDate)) return jsonError('Ngày không hợp lệ', 400);
  const resolvedStatus = status !== undefined ? status : 'draft';
  if (!VALID_STATUSES.includes(resolvedStatus)) return jsonError('Trạng thái không hợp lệ', 400);

  const now = new Date().toISOString();
  const summary = summarize({ type, category, amount }, categoryMeta);

  const insert = env.DB.prepare(
    `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(type, category, amount, note || null, transactionDate, resolvedStatus, auth.username, now);

  const result = await insert.run();
  const newId = result.meta.last_row_id;

  await env.DB.prepare(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
     VALUES ('finance_transaction_create', 'finance_transaction', ?, ?, NULL, ?, ?, ?)`
  ).bind(newId, summary, summary, auth.username, now).run();

  return new Response(JSON.stringify({ id: newId, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
