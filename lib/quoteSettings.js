// Versioned quote template: every save inserts a row; readers take the newest.
export const QUOTE_SETTINGS_MAX_BYTES = 16384;
export const QUOTE_DEFAULTS = Object.freeze({
  businessName: 'Hiền Lê Garden', address: 'Tổ Dân Phố 6 Bờ Đập, Nam Gia Nghĩa, Lâm Đồng', hotline: '0968 987 311',
  email: 'hello@hienlegarden.vn', website: 'hienlegarden.vn', defaultValidDays: 7, defaultDepositPercent: 30,
  taxNote: 'Giá trên chưa bao gồm thuế VAT',
  cancellationTerms: 'Tiền cọc được hoàn hoặc giữ lại theo thoả thuận khi huỷ dịch vụ; vui lòng báo trước tối thiểu 7 ngày.',
  footerNote: null, bankName: null, bankAccount: null, bankHolder: null, updatedBy: null, updatedAt: null,
});

const TEXT_FIELDS = {
  businessName: [200, true], address: [300, true], hotline: [50, true], email: [200, false], website: [200, false],
  taxNote: [500, false], cancellationTerms: [1000, false], footerNote: [1000, false],
  bankName: [200, false], bankAccount: [50, false], bankHolder: [200, false],
};

export async function loadQuoteSettings(db) {
  const r = await db.prepare('SELECT * FROM quote_settings ORDER BY id DESC LIMIT 1').first();
  if (!r) return { ...QUOTE_DEFAULTS };
  return {
    businessName: r.business_name, address: r.address, hotline: r.hotline, email: r.email, website: r.website,
    defaultValidDays: r.default_valid_days, defaultDepositPercent: r.default_deposit_percent, taxNote: r.tax_note,
    cancellationTerms: r.cancellation_terms, footerNote: r.footer_note, bankName: r.bank_name, bankAccount: r.bank_account,
    bankHolder: r.bank_holder, updatedBy: r.updated_by, updatedAt: r.updated_at,
  };
}

export function validateQuoteSettings(body) {
  if (!body || typeof body !== 'object') return { error: 'Dữ liệu không hợp lệ' };
  const value = {};
  for (const [key, [max, required]] of Object.entries(TEXT_FIELDS)) {
    const raw = body[key];
    if (raw != null && typeof raw !== 'string') return { error: `Trường ${key} không hợp lệ` };
    const v = raw == null ? '' : raw.trim();
    if (required && !v) return { error: 'Vui lòng nhập tên cơ sở, địa chỉ và hotline' };
    if (v.length > max) return { error: `Trường ${key} tối đa ${max} ký tự` };
    value[key] = v || null;
  }
  if (!Number.isInteger(body.defaultValidDays) || body.defaultValidDays < 1 || body.defaultValidDays > 365) {
    return { error: 'Hiệu lực mặc định phải từ 1 đến 365 ngày' };
  }
  if (!Number.isInteger(body.defaultDepositPercent) || body.defaultDepositPercent < 0 || body.defaultDepositPercent > 100) {
    return { error: 'Tỷ lệ cọc đề nghị phải từ 0 đến 100%' };
  }
  value.defaultValidDays = body.defaultValidDays;
  value.defaultDepositPercent = body.defaultDepositPercent;
  return { value };
}
