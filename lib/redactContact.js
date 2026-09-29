import { hasPermission } from './permissions.js';

const CONTACT_FIELDS = ['phone', 'email'];

// Single implementation of guest-contact redaction (spec §3, guests.contact_view).
// Nulls `phone` / `email` on a row or an array of rows when the caller lacks
// guests.contact_view. Only fields already present are touched, so the response
// shape stays the same. Mutates and returns its argument.
export function redactContact(auth, rowOrRows) {
  if (rowOrRows == null || hasPermission(auth, 'guests.contact_view')) return rowOrRows;
  const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const field of CONTACT_FIELDS) {
      if (field in row) row[field] = null;
    }
  }
  return rowOrRows;
}
