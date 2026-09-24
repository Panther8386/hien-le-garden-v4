import { hasPermission } from './permissions.js';

// Anyone without finance.view_all only ever sees the "Thu" (income) side of Sổ
// thu chi, and never hidden rows — the same filter GET /api/finance/transactions
// applies. Endpoints addressing one transaction by id treat any other row as
// not found, so guessing an id reveals nothing.
export function canSeeTransaction(auth, row) {
  return hasPermission(auth, 'finance.view_all') || (row.type === 'income' && !row.is_hidden);
}
