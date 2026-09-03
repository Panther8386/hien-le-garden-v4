// v4/lib/financeCategories.js
// Finance category metadata now lives in the `finance_categories` D1 table
// (admin-configurable via /api/finance/categories) rather than hardcoded here.
// This module is the single place the transaction endpoints (transactions/index.js,
// [id].js, [id]/void.js) load that table from. The client (admin/finance.js) fetches
// the same table over HTTP and keeps its own independent copy in memory — admin/*.js
// are classic <script> tags, not ES modules, so they cannot import this file.

export async function loadCategoryMeta(env) {
  const { results } = await env.DB.prepare(`SELECT slug, label, type, is_active FROM finance_categories`).all();
  return Object.fromEntries(results.map((r) => [r.slug, { label: r.label, type: r.type, isActive: !!r.is_active }]));
}

export function categoryMatchesType(categoryMeta, category, type) {
  const meta = categoryMeta[category];
  return !!meta && meta.type === type;
}

export function slugify(label) {
  return label
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')   // strip combining diacritics after NFD decomposition (à, ê, ộ, ...)
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')  // đ/Đ don't decompose via NFD, handled separately
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
