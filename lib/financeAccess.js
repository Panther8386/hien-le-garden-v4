import { hasPermission } from './permissions.js';

// Anyone without finance.view_all only ever sees the "Thu" (income) side of Sổ
// thu chi, and never hidden rows — the same filter GET /api/finance/transactions
// applies. Endpoints addressing one transaction by id treat any other row as
// not found, so guessing an id reveals nothing.
//
// finance.view_all alone does not unlock hidden rows: seeing a hidden row by id
// also requires records.hide, same as bookings/dine-in/gio-xanh — otherwise a
// finance.view_all holder without records.hide could read/edit/void a hidden row
// straight by id even though it's excluded from their own list view.
export function canSeeTransaction(auth, row) {
  if (hasPermission(auth, 'finance.view_all')) {
    return !row.is_hidden || hasPermission(auth, 'records.hide');
  }
  return row.type === 'income' && !row.is_hidden;
}
