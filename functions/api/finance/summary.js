import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthStart(month) {
  return `${month}-01`;
}

async function sumIncomeExpense(env, fromDateInclusive, toDateExclusive) {
  const clauses = [`status IN ('confirmed', 'paid')`, `voided_at IS NULL`];
  const params = [];
  if (fromDateInclusive) { clauses.push('transaction_date >= ?'); params.push(fromDateInclusive); }
  if (toDateExclusive) { clauses.push('transaction_date < ?'); params.push(toDateExclusive); }
  const where = `WHERE ${clauses.join(' AND ')}`;

  const incomeRow = await env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM finance_transactions ${where} AND type = 'income'`).bind(...params).first();
  const expenseRow = await env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM finance_transactions ${where} AND type = 'expense'`).bind(...params).first();
  return { income: incomeRow.total, expense: expenseRow.total };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const month = url.searchParams.get('month');
  if (!month || !MONTH_FORMAT.test(month)) {
    return jsonError('Tháng không hợp lệ, dùng định dạng YYYY-MM', 400);
  }

  const anchorRow = await env.DB.prepare(
    `SELECT period, opening_balance FROM finance_opening_balance WHERE period <= ? ORDER BY period DESC, id DESC LIMIT 1`
  ).bind(month).first();

  let openingBalance;
  let openingBalanceSource;
  if (!anchorRow) {
    const { income, expense } = await sumIncomeExpense(env, null, monthStart(month));
    openingBalance = income - expense;
    openingBalanceSource = 'default_zero';
  } else if (anchorRow.period === month) {
    openingBalance = anchorRow.opening_balance;
    openingBalanceSource = 'manual';
  } else {
    const { income, expense } = await sumIncomeExpense(env, monthStart(anchorRow.period), monthStart(month));
    openingBalance = anchorRow.opening_balance + income - expense;
    openingBalanceSource = 'carried_forward';
  }

  const { income: totalIncome, expense: totalExpense } = await sumIncomeExpense(env, monthStart(month), monthStart(nextMonth(month)));
  const netChange = totalIncome - totalExpense;
  const closingBalance = openingBalance + netChange;

  // Observer permission restriction: every one of the other fields here is
  // expense-derived (directly, like totalExpense, or indirectly — openingBalance/
  // netChange/closingBalance all encode expense data once totalIncome is known).
  // Stripped server-side so this role can never see or infer expense figures,
  // not just have them hidden by the UI.
  if (auth.role === 'observer') {
    return new Response(JSON.stringify({ month, totalIncome }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(
    JSON.stringify({ month, openingBalance, openingBalanceSource, totalIncome, totalExpense, netChange, closingBalance }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return next;
}
