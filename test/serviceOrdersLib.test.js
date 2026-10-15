import { describe, it, expect } from 'vitest';
import {
  validateOrderFields, validateItems, categoryTotals, orderTotal, settlementPlan, roundDeposit, quoteNumber, LIMITS,
} from '../lib/serviceOrders.js';
import { validateQuoteSettings } from '../lib/quoteSettings.js';

const META = {
  bep_hien_le: { label: 'Bếp Hiền Lê', type: 'income', isActive: true },
  hien_le_drinks: { label: 'Hiền Lê Drinks', type: 'income', isActive: true },
  old_line: { label: 'Cũ', type: 'income', isActive: false },
  vat_tu: { label: 'Vật tư', type: 'expense', isActive: true },
};
const BASE = {
  orderType: 'dat_tiec', customerName: ' Chị Lan ', phone: '0900 000 000', organization: '', note: null,
  eventDate: '2026-12-20', eventTime: '18:30', guestCount: 50, venueNote: 'Sân vườn', bookingId: null,
  primaryCategory: 'bep_hien_le', quoteValidDays: 7, requestedDeposit: 3000000,
};

describe('validateOrderFields', () => {
  it('normalizes a valid order', () => {
    const r = validateOrderFields(BASE, META);
    expect(r.value).toMatchObject({ customerName: 'Chị Lan', organization: null, eventTime: '18:30', guestCount: 50 });
  });
  it('rejects bad type, date, phone, expense or inactive primary line', () => {
    expect(validateOrderFields({ ...BASE, orderType: 'picnic' }, META).error).toBeTruthy();
    expect(validateOrderFields({ ...BASE, eventDate: '2026-02-30' }, META).error).toBeTruthy();
    expect(validateOrderFields({ ...BASE, phone: 'abc' }, META).error).toBeTruthy();
    expect(validateOrderFields({ ...BASE, primaryCategory: 'vat_tu' }, META).error).toBeTruthy();
    expect(validateOrderFields({ ...BASE, primaryCategory: 'old_line' }, META).error).toBeTruthy();
  });
  it('keeps an inactive primary line that the order already had', () => {
    expect(validateOrderFields({ ...BASE, primaryCategory: 'old_line' }, META, 'old_line').value.primaryCategory).toBe('old_line');
  });
  it('enforces length and range limits', () => {
    expect(validateOrderFields({ ...BASE, customerName: 'x'.repeat(201) }, META).error).toBeTruthy();
    expect(validateOrderFields({ ...BASE, quoteValidDays: 0 }, META).error).toBeTruthy();
    expect(validateOrderFields({ ...BASE, guestCount: 1.5 }, META).error).toBeTruthy();
  });
});

describe('validateItems', () => {
  const item = { description: 'Set menu', quantity: 5, unitPrice: 2500000, financeCategory: 'bep_hien_le' };
  it('accepts new items and rejects foreign ids', () => {
    expect(validateItems([item], META).value[0]).toMatchObject({ id: null, quantity: 5 });
    expect(validateItems([{ ...item, id: 9 }], META, []).error).toBeTruthy();
  });
  it('keeps an inactive line only on an existing item that already used it', () => {
    const current = [{ id: 3, financeCategory: 'old_line' }];
    expect(validateItems([{ ...item, id: 3, financeCategory: 'old_line' }], META, current).value).toHaveLength(1);
    expect(validateItems([{ ...item, financeCategory: 'old_line' }], META, current).error).toBeTruthy();
  });
  it('rejects more than 100 items, non-integer prices and totals above the cap', () => {
    expect(validateItems(Array(LIMITS.items + 1).fill(item), META).error).toBeTruthy();
    expect(validateItems([{ ...item, unitPrice: 10.5 }], META).error).toBeTruthy();
    expect(validateItems(Array(20).fill({ ...item, quantity: 100000, unitPrice: 1000000 }), META).error).toBeTruthy();
  });
});

describe('totals and settlement', () => {
  const items = [
    { description: 'A', quantity: 2, unitPrice: 1000000, financeCategory: 'bep_hien_le' },
    { description: 'B', quantity: 1, unitPrice: 500000, financeCategory: 'hien_le_drinks' },
    { description: 'C', quantity: 1, unitPrice: 300000, financeCategory: 'bep_hien_le' },
  ];
  it('sums per line and overall', () => {
    expect(categoryTotals(items)).toEqual({ bep_hien_le: 2300000, hien_le_drinks: 500000 });
    expect(orderTotal(items)).toBe(2800000);
  });
  it('subtracts the deposit from the primary line and skips zero lines', () => {
    expect(settlementPlan(items, 'bep_hien_le', 1000000)).toEqual([
      { category: 'bep_hien_le', amount: 1300000 }, { category: 'hien_le_drinks', amount: 500000 },
    ]);
    expect(settlementPlan(items, 'bep_hien_le', 2300000)).toEqual([{ category: 'hien_le_drinks', amount: 500000 }]);
  });
  it('rounds the default deposit to 1.000đ and formats the quote number', () => {
    expect(roundDeposit(2800000, 30)).toBe(840000);
    expect(roundDeposit(1234567, 30)).toBe(370000);
    expect(quoteNumber(12, '2026-10-15T03:00:00.000Z')).toBe('BG-2026-0012');
  });
});

describe('validateQuoteSettings', () => {
  const ok = { businessName: 'Hiền Lê Garden', address: 'Lâm Đồng', hotline: '0968 987 311', email: '', website: '',
    defaultValidDays: 7, defaultDepositPercent: 30, taxNote: '', cancellationTerms: '', footerNote: '', bankName: '', bankAccount: '', bankHolder: '' };
  it('accepts valid settings and turns blanks into null', () => {
    expect(validateQuoteSettings(ok).value).toMatchObject({ email: null, bankAccount: null, defaultDepositPercent: 30 });
  });
  it('rejects missing business name, percent above 100 and over-long text', () => {
    expect(validateQuoteSettings({ ...ok, businessName: '' }).error).toBeTruthy();
    expect(validateQuoteSettings({ ...ok, defaultDepositPercent: 101 }).error).toBeTruthy();
    expect(validateQuoteSettings({ ...ok, footerNote: 'x'.repeat(1001) }).error).toBeTruthy();
  });
});
