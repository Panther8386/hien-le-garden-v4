// v4/lib/financeCategories.js
// Single source of truth for the finance category -> type classification table.
// Both transaction endpoints (transactions/index.js, transactions/[id].js) import
// this so the 13-slug list and its Thu/Chi pairing can never drift between them.
// The client (admin/finance.js) keeps its own independent copy of the same table —
// admin/*.js are classic <script> tags, not ES modules, so they cannot import this.

export const CATEGORY_META = {
  cay_giong: { label: 'Cây giống', type: 'expense' },
  vat_tu: { label: 'Vật tư', type: 'expense' },
  nhan_cong: { label: 'Nhân công', type: 'expense' },
  van_chuyen: { label: 'Vận chuyển', type: 'expense' },
  bao_tri: { label: 'Bảo trì', type: 'expense' },
  thuc_pham: { label: 'Thực phẩm', type: 'expense' },
  am_thuc_lien_ket: { label: 'Ẩm thực liên kết', type: 'expense' },
  khac: { label: 'Chi phí khác', type: 'expense' },
  ban_hang: { label: 'Bán hàng', type: 'income' },
  dich_vu: { label: 'Lưu trú Hiền Lê', type: 'income' },
  bep_hien_le: { label: 'Bếp Hiền Lê', type: 'income' },
  hien_le_drinks: { label: 'Hiền Lê Drinks', type: 'income' },
  hh_am_thuc_lien_ket: { label: 'HH Ẩm thực liên kết', type: 'income' },
};

export const VALID_CATEGORIES = Object.keys(CATEGORY_META);

export const CATEGORY_LABELS = Object.fromEntries(
  Object.entries(CATEGORY_META).map(([slug, meta]) => [slug, meta.label])
);

export function categoryMatchesType(category, type) {
  const meta = CATEGORY_META[category];
  return !!meta && meta.type === type;
}
