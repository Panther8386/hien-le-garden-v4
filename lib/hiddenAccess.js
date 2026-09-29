// A hidden record (is_hidden = 1) on bookings / dine_in_orders / gio_xanh_sessions is
// visible only to a user who may view hidden records. records.hide is that permission's
// own gate (it also gates hiding/unhiding), so a holder can always see what they hide.
// Accepts either the raw D1 column (is_hidden) or a camelCase alias (isHidden) some
// SELECTs use, since callers vary in how they name the column in their query.
import { hasPermission } from './permissions.js';

export function canSeeHidden(auth, row) {
  const hidden = !!(row && (row.is_hidden ?? row.isHidden));
  return !hidden || hasPermission(auth, 'records.hide');
}
