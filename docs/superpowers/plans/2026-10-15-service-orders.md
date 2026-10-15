# Service Orders, Deposits by Revenue Line and Quote Template (PR B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can create service orders (catering on request, events, parties, other), take deposits into the order's primary revenue line, settle each revenue line, cancel with a controlled refund, print a professional quote and edit the quote template — with every finance row linked to its order.

**Architecture:** A standalone module: three tables (`service_orders`, `service_order_items`, `service_order_deposits`), a nullable `finance_transactions.service_order_id`, and a versioned `quote_settings` table, all in migration `0046`. Shared rules live in `lib/serviceOrders.js` and `lib/quoteSettings.js`. Every mutating endpoint is one D1 batch whose first statement inserts an audit row only while the order still matches what the request read (status, `deposit_amount`, JSON snapshot of the items); every later statement is gated on that exact audit row (the `atomicSaleClose` pattern), so a stale or competing request writes nothing. Three admin pages (orders, printable quote, quote settings) follow the Spec 2 patterns.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite JSON1), Vitest + `@cloudflare/vitest-pool-workers`, vanilla JS admin pages, `admin/tabs.js`, Playwright check script.

**Spec:** `docs/superpowers/specs/2026-10-15-service-orders-design.md` (§4 PR B, decisions D1–D12). **Prerequisite:** PR A (`docs/superpowers/plans/2026-10-15-finance-linked-edit-guard.md`) merged first.

**Implementation clarifications (owner to confirm when reviewing this plan):**
1. `service_orders.creation_key` (unique, internal) lets one batch insert the order, its audit row and its items without knowing the new id in advance.
2. `service_orders.refund_payment_method` stores the refund method (spec mentions the method on cancel but no column).
3. `GET /api/service-orders/categories` (needs `service_orders.view`) returns income categories, because reception cannot read `/api/finance/categories` (needs `finance.view_income`).
4. Hiding uses the existing audit action `record_hide` with `entity_type = 'service_order'` (spec §4.2 named `service_order_hide`); this keeps one audit filter for every hide.
5. Order phone numbers are redacted with the existing `redactContact` for users without `guests.contact_view`, as bookings are.

## Global Constraints

- Order types: `an_uong_theo_yeu_cau` (Ăn uống theo yêu cầu), `su_kien` (Tổ chức sự kiện), `dat_tiec` (Đặt tiệc), `khac` (Khác).
- Statuses: `draft` → `confirmed` → `settled`; `draft`/`confirmed` → `cancelled`; no reopening.
- Deposits are income rows in `primary_category`; always `deposit_amount ≤ value of the primary line`.
- Settlement: one income row per revenue line with value > 0; primary line = line value − `deposit_amount` (skipped when 0).
- Cancel: reason required; `refund_amount` 0…`deposit_amount` entered by staff; refund > 0 → expense `hoan_coc`; an order with `deposit_amount > 0` can be cancelled only with `service_orders.refund` (even when refund is 0); deleting a deposit needs `service_orders.refund`.
- Permissions added (catalog 38 → 42): `service_orders.view` (reception, manager, observer), `service_orders.manage` (reception, manager), `service_orders.refund` (manager), `settings.quote_template` (manager). Admin has all implicitly.
- Every write also requires `service_orders.view`; missing view or a hidden order (without `records.hide`) answers 404 exactly like a missing id.
- Limits: names/organization 200, phone 30 (`^[0-9+().\s-]{6,30}$`), note/venue 2000, item description 500, reason 1000; quantity 1–100000; unit price 0–1000000000; order total ≤ 10000000000; ≤ 100 items; guest count 1–100000; quote validity 1–365 days; JSON body ≤ 64 KiB (quote settings ≤ 16 KiB).
- Every finance row created by an order carries `service_order_id`; `blockedFinanceLinks` treats such rows as linked (cannot be voided or edited from Thu chi).
- Audit actions: `service_order_create`, `service_order_update`, `service_order_confirm`, `service_order_deposit`, `service_order_deposit_delete`, `service_order_settle`, `service_order_cancel`, `quote_settings_update`, plus existing `record_hide`. `entity_label` = `Đơn #<id>`. Never copy phone numbers or bank details into audit.
- Quote defaults: validity 7 days; requested deposit 30% of total rounded to 1.000đ; tax note `Giá trên chưa bao gồm thuế VAT`; cancellation terms `Tiền cọc được hoàn hoặc giữ lại theo thoả thuận khi huỷ dịch vụ; vui lòng báo trước tối thiểu 7 ngày.`; bank fields empty. Business info seed: `Hiền Lê Garden`, `Tổ Dân Phố 6 Bờ Đập, Nam Gia Nghĩa, Lâm Đồng`, `0968 987 311`, `hello@hienlegarden.vn`, `hienlegarden.vn`.
- Quote number `BG-<year of created_at>-<id padded to 4 digits>`; issue date = order creation date; valid until = issue date + `quote_valid_days`.
- All UI text rendered with `textContent` (never `innerHTML` with data). Responsive at 390/800/1440 px.
- Tests run on Linux (CI or WSL), never on the Windows workerd runtime.

## Review Focus

- A stale edit (two staff editing the same order) must not overwrite the other's items — pinned in Task 5 (`stale snapshot returns 409`).
- Deposit that would exceed the primary line, including when an edit lowers the primary line or moves items to another line — pinned in Tasks 5 and 6.
- Cancelling an order that has a deposit by a reception user (who lacks `refund`) with refund 0 must be refused — pinned in Task 8.
- A settlement where the deposit covers the whole primary line and there are no other lines must succeed with no receipt and no payment method — pinned in Task 7.
- A manage user without `guests.contact_view` editing an order must not wipe the stored phone — pinned in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `migrations/0046_service_orders.sql` (create) | Tables, column, indexes, quote settings seed, role permissions |
| `lib/permissions.js` (modify) | Catalog + role defaults for the 4 new keys |
| `lib/serviceOrders.js` (create) | Constants, validation, totals, settlement plan, SQL guards, loaders, JSON shaping |
| `lib/quoteSettings.js` (create) | Load/validate quote settings |
| `lib/financeVoidGuard.js` (modify) | Treat `service_order_id` rows as linked |
| `functions/api/service-orders/index.js` (create) | GET list, POST create |
| `functions/api/service-orders/categories.js` (create) | GET income categories for the order form |
| `functions/api/service-orders/[id].js` (create) | GET detail, PATCH update |
| `functions/api/service-orders/[id]/confirm.js` (create) | POST confirm |
| `functions/api/service-orders/[id]/deposits/index.js` (create) | POST deposit |
| `functions/api/service-orders/[id]/deposits/[depositId].js` (create) | DELETE deposit |
| `functions/api/service-orders/[id]/settle.js` (create) | POST settle |
| `functions/api/service-orders/[id]/cancel.js` (create) | POST cancel |
| `functions/api/service-orders/[id]/hide.js` (create) | PATCH hide |
| `functions/api/quote-settings.js` (create) | GET/PUT quote settings |
| `functions/api/audit-log/index.js`, `admin/audit-log.js` (modify) | New action types + labels |
| `functions/api/finance/transactions/index.js` (modify) | `source` per row, `depositsOnly` filter |
| `functions/api/bookings/index.js` (modify) | `serviceOrders` per booking |
| `admin/service-orders.html`, `admin/service-orders.js` (create) | Orders page |
| `admin/service-order-quote.html`, `admin/service-order-quote.js` (create) | Printable quote |
| `admin/quote-settings.html`, `admin/quote-settings.js` (create) | Quote template settings |
| `admin/nav-drawer.js`, `_redirects`, `scripts/dist-policy.mjs` (modify) | Menu, clean URLs, required assets |
| `admin/reception.html`, `admin/reception.js` (modify) | Booking badge + checkout warning |
| `admin/finance.html`, `admin/finance.js` (modify) | Source label + deposits filter |
| `test/serviceOrders.test.js` (create) | API tests |
| `test/serviceOrdersLib.test.js` (create) | Pure helper tests |
| `test/permissions.test.js`, `test/migrations.test.js`, `test/financeTransactions.test.js`, `test/bookingsEndpoints.test.js` (modify) | Catalog, migration, finance and booking additions |
| `scripts/check-admin-refresh.mjs` (modify) | Browser checks for the three pages and integrations |

---

### Task 1: Migration 0046 and permission catalog

**Files:**
- Create: `migrations/0046_service_orders.sql`
- Modify: `lib/permissions.js`
- Test: `test/permissions.test.js`, `test/migrations.test.js`

**Interfaces:**
- Produces: tables `service_orders`, `service_order_items`, `service_order_deposits`, `quote_settings`; column `finance_transactions.service_order_id`; permission keys `service_orders.view|manage|refund`, `settings.quote_template`.

- [ ] **Step 1: Write the failing tests**

In `test/permissions.test.js` replace the first two `it` blocks of `describe('permission catalog')` with:

```js
  it('has 42 unique keys matching the spec table', () => {
    expect(PERMISSION_KEYS.length).toBe(42);
    expect(new Set(PERMISSION_KEYS).size).toBe(42);
  });

  it('only uses valid keys in role defaults', () => {
    for (const role of EDITABLE_ROLES) {
      for (const key of ROLE_DEFAULTS[role]) expect(isValidPermission(key)).toBe(true);
    }
  });

  it('grants service order and quote template keys per the service orders spec', () => {
    expect(ROLE_DEFAULTS.reception).toEqual(expect.arrayContaining(['service_orders.view', 'service_orders.manage']));
    expect(ROLE_DEFAULTS.reception).not.toContain('service_orders.refund');
    expect(ROLE_DEFAULTS.manager).toEqual(expect.arrayContaining(['service_orders.view', 'service_orders.manage', 'service_orders.refund', 'settings.quote_template']));
  });
```

and change the observer test to:

```js
  it('gives observer today-ops view, finance income view and service order view', () => {
    expect([...ROLE_DEFAULTS.observer].sort()).toEqual(['bookings.view', 'finance.view_income', 'service_orders.view']);
  });
```

Append to `test/migrations.test.js`:

```js
describe('migration 0046', () => {
  it('creates the service order tables and the finance link column', async () => {
    for (const table of ['service_orders', 'service_order_items', 'service_order_deposits', 'quote_settings']) {
      const row = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(table).first();
      expect(row?.name).toBe(table);
    }
    const cols = (await env.DB.prepare(`SELECT name FROM pragma_table_info('finance_transactions')`).all()).results.map((c) => c.name);
    expect(cols).toContain('service_order_id');
  });

  it('seeds one quote settings row with the agreed defaults', async () => {
    const row = await env.DB.prepare('SELECT * FROM quote_settings ORDER BY id DESC LIMIT 1').first();
    expect(row).toMatchObject({
      business_name: 'Hiền Lê Garden', default_valid_days: 7, default_deposit_percent: 30,
      tax_note: 'Giá trên chưa bao gồm thuế VAT',
      cancellation_terms: 'Tiền cọc được hoàn hoặc giữ lại theo thoả thuận khi huỷ dịch vụ; vui lòng báo trước tối thiểu 7 ngày.',
      bank_name: null, bank_account: null, bank_holder: null,
    });
  });

  it('rejects an unknown order type and a negative deposit', async () => {
    const insert = (type, deposit) => env.DB.prepare(`INSERT INTO service_orders
      (creation_key, order_type, customer_name, phone, event_date, primary_category, deposit_amount, quote_valid_days, created_by, created_at)
      VALUES (?, ?, 'A', '0900000000', '2026-12-01', 'bep_hien_le', ?, 7, 'x', '2026-10-15T00:00:00Z')`).bind(crypto.randomUUID(), type, deposit).run();
    await expect(insert('picnic', 0)).rejects.toThrow();
    await expect(insert('dat_tiec', -1)).rejects.toThrow();
    await expect(insert('dat_tiec', 0)).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run test/permissions.test.js test/migrations.test.js test/permissionsMigration.test.js`
Expected: FAIL — catalog is 38, tables do not exist.

- [ ] **Step 3: Create the migration**

`migrations/0046_service_orders.sql`:

```sql
-- Service orders (catering on request, events, parties) with deposits recorded
-- in each revenue line, and a versioned quote template. Additive only.

CREATE TABLE service_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creation_key TEXT NOT NULL UNIQUE,
  order_type TEXT NOT NULL CHECK (order_type IN ('an_uong_theo_yeu_cau', 'su_kien', 'dat_tiec', 'khac')),
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  organization TEXT,
  note TEXT,
  event_date TEXT NOT NULL,
  event_time TEXT,
  guest_count INTEGER CHECK (guest_count IS NULL OR guest_count > 0),
  venue_note TEXT,
  booking_id INTEGER REFERENCES bookings(id),
  primary_category TEXT NOT NULL,
  deposit_amount INTEGER NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  quote_valid_days INTEGER NOT NULL CHECK (quote_valid_days BETWEEN 1 AND 365),
  requested_deposit INTEGER NOT NULL DEFAULT 0 CHECK (requested_deposit >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'settled', 'cancelled')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT,
  settled_by TEXT,
  settled_at TEXT,
  settlement_payment_method TEXT CHECK (settlement_payment_method IN ('cash', 'transfer')),
  cancelled_by TEXT,
  cancelled_at TEXT,
  cancellation_origin TEXT CHECK (cancellation_origin IN ('hotel', 'guest')),
  cancel_reason TEXT,
  refund_amount INTEGER CHECK (refund_amount IS NULL OR refund_amount >= 0),
  refund_payment_method TEXT CHECK (refund_payment_method IN ('cash', 'transfer')),
  refund_finance_transaction_id INTEGER REFERENCES finance_transactions(id),
  is_hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_service_orders_status_date ON service_orders(status, event_date);
CREATE INDEX idx_service_orders_booking ON service_orders(booking_id);

CREATE TABLE service_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES service_orders(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  finance_category TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_service_order_items_order ON service_order_items(order_id);

CREATE TABLE service_order_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES service_orders(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer')),
  note TEXT,
  finance_transaction_id INTEGER REFERENCES finance_transactions(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_by TEXT,
  voided_at TEXT
);
CREATE INDEX idx_service_order_deposits_order ON service_order_deposits(order_id);

ALTER TABLE finance_transactions ADD COLUMN service_order_id INTEGER REFERENCES service_orders(id);
CREATE INDEX idx_finance_transactions_service_order ON finance_transactions(service_order_id);

CREATE TABLE quote_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL,
  address TEXT NOT NULL,
  hotline TEXT NOT NULL,
  email TEXT,
  website TEXT,
  default_valid_days INTEGER NOT NULL CHECK (default_valid_days BETWEEN 1 AND 365),
  default_deposit_percent INTEGER NOT NULL CHECK (default_deposit_percent BETWEEN 0 AND 100),
  tax_note TEXT,
  cancellation_terms TEXT,
  footer_note TEXT,
  bank_name TEXT,
  bank_account TEXT,
  bank_holder TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO quote_settings (business_name, address, hotline, email, website, default_valid_days, default_deposit_percent,
  tax_note, cancellation_terms, footer_note, bank_name, bank_account, bank_holder, updated_by, updated_at)
VALUES ('Hiền Lê Garden', 'Tổ Dân Phố 6 Bờ Đập, Nam Gia Nghĩa, Lâm Đồng', '0968 987 311', 'hello@hienlegarden.vn', 'hienlegarden.vn',
  7, 30, 'Giá trên chưa bao gồm thuế VAT',
  'Tiền cọc được hoàn hoặc giữ lại theo thoả thuận khi huỷ dịch vụ; vui lòng báo trước tối thiểu 7 ngày.',
  NULL, NULL, NULL, NULL, 'system', '2026-10-15T00:00:00Z');

INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
  ('reception', 'service_orders.view'), ('reception', 'service_orders.manage'),
  ('manager', 'service_orders.view'), ('manager', 'service_orders.manage'), ('manager', 'service_orders.refund'),
  ('manager', 'settings.quote_template'),
  ('observer', 'service_orders.view');
```

- [ ] **Step 4: Update the permission catalog**

In `lib/permissions.js`:

1. In the `'Vận hành & đặt phòng'` group, after the `records.hide` entry add:

```js
    { key: 'service_orders.view', label: 'Xem đơn dịch vụ (tiệc, sự kiện, ăn uống theo yêu cầu)' },
    { key: 'service_orders.manage', label: 'Tạo / sửa / chốt đơn dịch vụ, nhận cọc, tất toán, huỷ đơn chưa có cọc' },
    { key: 'service_orders.refund', label: 'Huỷ đơn dịch vụ đã có cọc (kể cả hoàn 0đ), xoá cọc đơn dịch vụ' },
```

2. In the `'Cài đặt'` group, after `settings.reminders` add:

```js
    { key: 'settings.quote_template', label: 'Sửa mẫu phiếu báo giá' },
```

3. Add `'service_orders.view', 'service_orders.manage'` to the end of the `RECEPTION` array; add `'service_orders.refund', 'settings.quote_template'` to the end of the manager list; change observer to `['bookings.view', 'finance.view_income', 'service_orders.view']`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run test/permissions.test.js test/migrations.test.js test/permissionsMigration.test.js test/permissionsAdmin.test.js`
Expected: PASS (`permissionsMigration` compares seeded `role_permissions` to `ROLE_DEFAULTS`; both now include the new keys).

- [ ] **Step 6: Commit**

```bash
git add migrations/0046_service_orders.sql lib/permissions.js test/permissions.test.js test/migrations.test.js
git commit -m "feat(service-orders): schema, quote settings seed and permission keys"
```

---

### Task 2: Shared rules `lib/serviceOrders.js` and `lib/quoteSettings.js`

**Files:**
- Create: `lib/serviceOrders.js`, `lib/quoteSettings.js`
- Test: `test/serviceOrdersLib.test.js`

**Interfaces:**
- Consumes: `requireAuth` (`lib/requireAuth.js`), `hasPermission` (`lib/permissions.js`), `canSeeHidden` (`lib/hiddenAccess.js`).
- Produces (all named exports of `lib/serviceOrders.js`):
  - Constants: `ORDER_TYPES: string[]`, `ORDER_TYPE_LABELS: Record<string,string>`, `PAYMENT_METHODS`, `OPEN_STATUSES = ['draft','confirmed']`, `MAX_BODY_BYTES = 65536`, `LIMITS`, `NOT_FOUND`, `STALE`, `DEPOSIT_EXCEEDS`.
  - `json(body, status = 200): Response`, `jsonError(message, status): Response`.
  - `validateOrderFields(body, categoryMeta, currentPrimary = null): { value } | { error }` — `value` = `{ orderType, customerName, phone, organization, note, eventDate, eventTime, guestCount, venueNote, bookingId, primaryCategory, quoteValidDays, requestedDeposit }`.
  - `validateItems(items, categoryMeta, currentItems = []): { value: Array<{id:number|null, description, quantity, unitPrice, financeCategory}> } | { error }`.
  - `categoryTotals(items): Record<string, number>`, `orderTotal(items): number`.
  - `settlementPlan(items, primaryCategory, depositAmount): Array<{category, amount}>` (amount > 0, sorted by category).
  - `roundDeposit(total, percent): number`, `quoteNumber(id, createdAt): string`.
  - `itemsSnapshotSql` (SQL, one `?` = order id), `readSnapshot(db, orderId): Promise<string>`.
  - `orderGuardSql(statuses): string` — binds `[orderId, depositAmount, orderId, snapshot]`.
  - `gateSql(action): string` — binds `[orderId, auditNewValue]`.
  - `auditInsert(db, action, orderId, newValue, actor, now, guardSql, guardBinds): D1PreparedStatement`.
  - `requireOrderPermission(request, env, permission): Promise<Session | Response>`.
  - `loadVisibleOrder(env, auth, id): Promise<row | null>`, `loadItems(db, orderId)`, `loadDeposits(db, orderId)`.
  - `checkBookingLink(env, auth, bookingId): Promise<Response | null>`.
  - `coerceOrder(row, items, deposits)`, `coerceOrderSummary(row)`.
- Produces (`lib/quoteSettings.js`): `QUOTE_DEFAULTS`, `loadQuoteSettings(db)`, `validateQuoteSettings(body): { value } | { error }`, `QUOTE_SETTINGS_MAX_BYTES = 16384`.

- [ ] **Step 1: Write the failing tests**

`test/serviceOrdersLib.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrdersLib.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `lib/serviceOrders.js`**

```js
// Shared rules for service orders (spec 2026-10-15). Server-side only.
import { requireAuth } from './requireAuth.js';
import { hasPermission } from './permissions.js';
import { canSeeHidden } from './hiddenAccess.js';

export const ORDER_TYPES = ['an_uong_theo_yeu_cau', 'su_kien', 'dat_tiec', 'khac'];
export const ORDER_TYPE_LABELS = {
  an_uong_theo_yeu_cau: 'Ăn uống theo yêu cầu', su_kien: 'Tổ chức sự kiện', dat_tiec: 'Đặt tiệc', khac: 'Khác',
};
export const PAYMENT_METHODS = ['cash', 'transfer'];
export const OPEN_STATUSES = ['draft', 'confirmed'];
export const MAX_BODY_BYTES = 65536;
export const LIMITS = Object.freeze({
  customerName: 200, organization: 200, phone: 30, note: 2000, venueNote: 2000, description: 500, reason: 1000,
  items: 100, quantity: 100000, unitPrice: 1000000000, total: 10000000000, guestCount: 100000, validDays: 365,
});
export const NOT_FOUND = 'Không tìm thấy đơn dịch vụ';
export const STALE = 'Đơn vừa thay đổi, vui lòng tải lại';
export const DEPOSIT_EXCEEDS = 'Tổng cọc không được vượt giá trị mảng chính của đơn';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_RE = /^[0-9+().\s-]{6,30}$/;
// Identifiers interpolated into SQL come only from these server-owned lists.
const ACTIONS = new Set(['service_order_update', 'service_order_confirm', 'service_order_deposit',
  'service_order_deposit_delete', 'service_order_settle', 'service_order_cancel']);
const STATUS_SET = new Set(['draft', 'confirmed', 'settled', 'cancelled']);

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
export function jsonError(message, status) {
  return json({ error: message }, status);
}

function text(value, max, required = false) {
  if (value == null) return required ? { error: true } : { value: null };
  if (typeof value !== 'string') return { error: true };
  const v = value.trim();
  if (!v) return required ? { error: true } : { value: null };
  if (v.length > max) return { error: true };
  return { value: v };
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isIncomeChoice(categoryMeta, slug, keptSlug) {
  const meta = categoryMeta[slug];
  return !!meta && meta.type === 'income' && (meta.isActive || slug === keptSlug);
}

export function validateOrderFields(body, categoryMeta, currentPrimary = null) {
  if (!body || typeof body !== 'object') return { error: 'Dữ liệu không hợp lệ' };
  if (!ORDER_TYPES.includes(body.orderType)) return { error: 'Loại đơn không hợp lệ' };
  const customerName = text(body.customerName, LIMITS.customerName, true);
  if (customerName.error) return { error: 'Vui lòng nhập tên khách (tối đa 200 ký tự)' };
  const phone = text(body.phone, LIMITS.phone, true);
  if (phone.error || !PHONE_RE.test(phone.value)) return { error: 'Số điện thoại không hợp lệ' };
  const organization = text(body.organization, LIMITS.organization);
  if (organization.error) return { error: 'Tên đơn vị tối đa 200 ký tự' };
  const note = text(body.note, LIMITS.note);
  if (note.error) return { error: 'Ghi chú tối đa 2000 ký tự' };
  const venueNote = text(body.venueNote, LIMITS.venueNote);
  if (venueNote.error) return { error: 'Khu vực / yêu cầu tối đa 2000 ký tự' };
  if (!isValidDate(body.eventDate)) return { error: 'Ngày diễn ra không hợp lệ' };
  const eventTime = body.eventTime == null || body.eventTime === '' ? null : body.eventTime;
  if (eventTime !== null && !TIME_RE.test(eventTime)) return { error: 'Giờ diễn ra không hợp lệ' };
  const guestCount = body.guestCount == null || body.guestCount === '' ? null : body.guestCount;
  if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > LIMITS.guestCount)) {
    return { error: 'Số khách không hợp lệ' };
  }
  const bookingId = body.bookingId == null || body.bookingId === '' ? null : body.bookingId;
  if (bookingId !== null && (!Number.isInteger(bookingId) || bookingId < 1)) return { error: 'Booking liên kết không hợp lệ' };
  if (!isIncomeChoice(categoryMeta, body.primaryCategory, currentPrimary)) {
    return { error: 'Mảng chính phải là danh mục thu đang hoạt động' };
  }
  if (!Number.isInteger(body.quoteValidDays) || body.quoteValidDays < 1 || body.quoteValidDays > LIMITS.validDays) {
    return { error: 'Hiệu lực báo giá phải từ 1 đến 365 ngày' };
  }
  if (!Number.isInteger(body.requestedDeposit) || body.requestedDeposit < 0 || body.requestedDeposit > LIMITS.total) {
    return { error: 'Cọc đề nghị không hợp lệ' };
  }
  return { value: {
    orderType: body.orderType, customerName: customerName.value, phone: phone.value, organization: organization.value,
    note: note.value, eventDate: body.eventDate, eventTime, guestCount, venueNote: venueNote.value, bookingId,
    primaryCategory: body.primaryCategory, quoteValidDays: body.quoteValidDays, requestedDeposit: body.requestedDeposit,
  } };
}

export function validateItems(items, categoryMeta, currentItems = []) {
  if (!Array.isArray(items)) return { error: 'Danh sách dòng không hợp lệ' };
  if (items.length > LIMITS.items) return { error: `Tối đa ${LIMITS.items} dòng mỗi đơn` };
  const byId = new Map(currentItems.map((i) => [i.id, i]));
  const seen = new Set();
  const out = [];
  let total = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') return { error: 'Dòng không hợp lệ' };
    let id = null;
    if (raw.id != null) {
      if (!byId.has(raw.id) || seen.has(raw.id)) return { error: 'Dòng không thuộc đơn này' };
      id = raw.id;
      seen.add(id);
    }
    const description = text(raw.description, LIMITS.description, true);
    if (description.error) return { error: 'Mỗi dòng cần mô tả (tối đa 500 ký tự)' };
    if (!Number.isInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > LIMITS.quantity) return { error: 'Số lượng không hợp lệ' };
    if (!Number.isInteger(raw.unitPrice) || raw.unitPrice < 0 || raw.unitPrice > LIMITS.unitPrice) return { error: 'Đơn giá không hợp lệ' };
    const kept = id !== null ? byId.get(id).financeCategory : null;
    if (!isIncomeChoice(categoryMeta, raw.financeCategory, kept)) return { error: 'Mảng của dòng phải là danh mục thu đang hoạt động' };
    total += raw.quantity * raw.unitPrice;
    if (total > LIMITS.total) return { error: 'Tổng đơn vượt giới hạn cho phép' };
    out.push({ id, description: description.value, quantity: raw.quantity, unitPrice: raw.unitPrice, financeCategory: raw.financeCategory });
  }
  return { value: out };
}

export function categoryTotals(items) {
  const totals = {};
  for (const i of items) totals[i.financeCategory] = (totals[i.financeCategory] || 0) + i.quantity * i.unitPrice;
  return totals;
}

export function orderTotal(items) {
  return items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
}

export function settlementPlan(items, primaryCategory, depositAmount) {
  return Object.entries(categoryTotals(items))
    .map(([category, total]) => ({ category, amount: category === primaryCategory ? total - depositAmount : total }))
    .filter((p) => p.amount > 0)
    .sort((a, b) => a.category.localeCompare(b.category));
}

export function roundDeposit(total, percent) {
  return Math.round((total * percent) / 100 / 1000) * 1000;
}

export function quoteNumber(id, createdAt) {
  return `BG-${String(createdAt).slice(0, 4)}-${String(id).padStart(4, '0')}`;
}

export const itemsSnapshotSql = `(SELECT COALESCE(json_group_array(json_array(id, description, quantity, unit_price, finance_category)), '[]')
  FROM (SELECT id, description, quantity, unit_price, finance_category FROM service_order_items WHERE order_id = ? ORDER BY id))`;

export async function readSnapshot(db, orderId) {
  const row = await db.prepare(`SELECT ${itemsSnapshotSql} AS snap`).bind(orderId).first();
  return row.snap;
}

export function orderGuardSql(statuses) {
  if (!statuses.length || !statuses.every((s) => STATUS_SET.has(s))) throw new Error('Unknown status');
  return `EXISTS (SELECT 1 FROM service_orders WHERE id = ? AND status IN (${statuses.map((s) => `'${s}'`).join(', ')})
    AND deposit_amount = ? AND ${itemsSnapshotSql} = ?)`;
}

export function gateSql(action) {
  if (!ACTIONS.has(action)) throw new Error('Unknown action');
  return `EXISTS (SELECT 1 FROM audit_log WHERE action_type = '${action}' AND entity_type = 'service_order'
    AND entity_id = ? AND new_value = ?)`;
}

// First statement of every mutating batch: the audit row exists only if the guard held.
export function auditInsert(db, action, orderId, newValue, actor, now, guardSql, guardBinds) {
  if (!ACTIONS.has(action)) throw new Error('Unknown action');
  return db.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
    SELECT ?, 'service_order', ?, ?, NULL, ?, ?, ? WHERE ${guardSql}`)
    .bind(action, orderId, `Đơn #${orderId}`, newValue, actor, now, ...guardBinds);
}

export async function requireOrderPermission(request, env, permission) {
  const auth = await requireAuth(request, env, permission);
  if (auth instanceof Response) return auth;
  if (permission !== 'service_orders.view' && !hasPermission(auth, 'service_orders.view')) return jsonError(NOT_FOUND, 404);
  return auth;
}

export async function loadVisibleOrder(env, auth, id) {
  const row = await env.DB.prepare('SELECT * FROM service_orders WHERE id = ?').bind(id).first();
  return row && canSeeHidden(auth, row) ? row : null;
}

export async function loadItems(db, orderId) {
  const { results } = await db.prepare(`SELECT id, description, quantity, unit_price AS unitPrice, finance_category AS financeCategory
    FROM service_order_items WHERE order_id = ? ORDER BY display_order, id`).bind(orderId).all();
  return results;
}

export async function loadDeposits(db, orderId) {
  const { results } = await db.prepare(`SELECT id, amount, payment_method AS paymentMethod, note, finance_transaction_id AS financeTransactionId,
      created_by AS createdBy, created_at AS createdAt, voided_by AS voidedBy, voided_at AS voidedAt
    FROM service_order_deposits WHERE order_id = ? ORDER BY id`).bind(orderId).all();
  return results;
}

export async function checkBookingLink(env, auth, bookingId) {
  if (bookingId == null) return null;
  const booking = await env.DB.prepare('SELECT id, is_hidden FROM bookings WHERE id = ?').bind(bookingId).first();
  if (!booking || !hasPermission(auth, 'bookings.view') || !canSeeHidden(auth, booking)) {
    return jsonError('Booking liên kết không tồn tại', 400);
  }
  return null;
}

export function coerceOrderSummary(r) {
  return {
    id: r.id, quoteNumber: quoteNumber(r.id, r.created_at), orderType: r.order_type, customerName: r.customer_name, phone: r.phone,
    organization: r.organization, eventDate: r.event_date, eventTime: r.event_time, guestCount: r.guest_count,
    bookingId: r.booking_id, primaryCategory: r.primary_category, depositAmount: r.deposit_amount, status: r.status,
    total: r.total ?? 0, isHidden: !!r.is_hidden, createdAt: r.created_at, settledAt: r.settled_at, cancelledAt: r.cancelled_at,
  };
}

export function coerceOrder(r, items, deposits) {
  return {
    ...coerceOrderSummary({ ...r, total: orderTotal(items) }),
    note: r.note, venueNote: r.venue_note, quoteValidDays: r.quote_valid_days, requestedDeposit: r.requested_deposit,
    createdBy: r.created_by, updatedBy: r.updated_by, updatedAt: r.updated_at, confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at,
    settledBy: r.settled_by, settlementPaymentMethod: r.settlement_payment_method, cancelledBy: r.cancelled_by,
    cancellationOrigin: r.cancellation_origin, cancelReason: r.cancel_reason, refundAmount: r.refund_amount,
    refundPaymentMethod: r.refund_payment_method, items, deposits, categoryTotals: categoryTotals(items),
  };
}
```

- [ ] **Step 4: Implement `lib/quoteSettings.js`**

```js
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
```

- [ ] **Step 5: Run to verify pass**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrdersLib.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/serviceOrders.js lib/quoteSettings.js test/serviceOrdersLib.test.js
git commit -m "feat(service-orders): shared validation, totals, settlement and guard helpers"
```

---

### Task 3: Treat order-linked finance rows as linked

**Files:**
- Modify: `lib/financeVoidGuard.js`
- Test: `test/financeTransactions.test.js`

**Interfaces:**
- Consumes: column `finance_transactions.service_order_id` (Task 1); PR A's PATCH guard and `void.js` both consume `blockedFinanceLinks`.
- Produces: `blockedFinanceLinks` true for any row with `service_order_id IS NOT NULL`.

- [ ] **Step 1: Write the failing test**

In the top-level `beforeEach` of `test/financeTransactions.test.js`, replace `await env.DB.exec('DELETE FROM finance_transactions');` with (D1 enforces foreign keys, so children first):

```js
  await env.DB.exec('DELETE FROM service_order_deposits');
  await env.DB.exec('DELETE FROM booking_deposits');
  await env.DB.exec('DELETE FROM finance_transactions');
  await env.DB.exec('DELETE FROM service_orders');
```

Then append:

```js
describe('service order finance rows are linked (PR B)', () => {
  it('cannot be voided or have their amount edited from Thu chi', async () => {
    const order = await env.DB.prepare(`INSERT INTO service_orders
      (creation_key, order_type, customer_name, phone, event_date, primary_category, quote_valid_days, created_by, created_at)
      VALUES ('k-fin', 'dat_tiec', 'A', '0900000000', '2026-12-01', 'bep_hien_le', 7, 'x', '2026-10-15T00:00:00Z')`).run();
    const tx = await env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, service_order_id)
      VALUES ('income', 'bep_hien_le', 500000, 'Cọc đơn', '2026-10-15', 'confirmed', 'x', '2026-10-15T00:00:00Z', ?)`).bind(order.meta.last_row_id).run();
    const id = String(tx.meta.last_row_id);
    const voided = await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${id}/void`, adminToken, 'PATCH', {}), env, params: { id } });
    expect(voided.status).toBe(409);
    const edited = await patchTransaction({ request: authedRequest(`https://x/api/finance/transactions/${id}`, adminToken, 'PATCH',
      { type: 'income', category: 'bep_hien_le', amount: 1, transactionDate: '2026-10-15', status: 'confirmed', note: 'Cọc đơn' }), env, params: { id } });
    expect(edited.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node node_modules/vitest/vitest.mjs run test/financeTransactions.test.js -t "service order finance rows"`
Expected: FAIL — void returns 200.

- [ ] **Step 3: Implement**

In `lib/financeVoidGuard.js`, change the first line of the `blockedFinanceLinks` template from

```js
  finance_transactions.checkout_booking_id IS NOT NULL
```

to

```js
  finance_transactions.service_order_id IS NOT NULL
  OR finance_transactions.checkout_booking_id IS NOT NULL
```

- [ ] **Step 4: Run to verify pass**

Run: `node node_modules/vitest/vitest.mjs run test/financeTransactions.test.js`
Expected: PASS (all prior void/PATCH tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/financeVoidGuard.js test/financeTransactions.test.js
git commit -m "feat(finance): treat service order rows as linked to their order"
```

---

### Task 4: List, categories, create and detail endpoints

**Files:**
- Create: `functions/api/service-orders/index.js`, `functions/api/service-orders/categories.js`, `functions/api/service-orders/[id].js` (GET only in this task)
- Test: `test/serviceOrders.test.js` (create)

**Interfaces:**
- Consumes: everything from `lib/serviceOrders.js`, `loadQuoteSettings` from `lib/quoteSettings.js`, `loadCategoryMeta`, `readJsonBody`, `redactContact`.
- Produces:
  - `GET /api/service-orders?status=open|history&type=&from=&to=&q=&includeHidden=1` → `200 [summary]` where summary = `coerceOrderSummary`.
  - `POST /api/service-orders` body = order fields + `items` (optional `quoteValidDays`, `requestedDeposit` default from settings) → `201 { id }`.
  - `GET /api/service-orders/categories` → `200 [{ slug, label, isActive }]` (income only).
  - `GET /api/service-orders/:id` → `200 coerceOrder(...)`.
  - Test helpers inside `test/serviceOrders.test.js` reused by Tasks 5–9: `call(handler, { method, url, token, body, params })`, `createOrder(overrides)`, tokens `adminToken`, `managerToken`, `receptionToken`, `observerToken`, staff ids.

- [ ] **Step 1: Write the failing tests**

`test/serviceOrders.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSession } from '../lib/auth.js';
import { setOverride } from './helpers/permissions.js';
import { envWithHookBefore } from './helpers/raceEnv.js';
import * as ordersIndex from '../functions/api/service-orders/index.js';
import * as ordersCategories from '../functions/api/service-orders/categories.js';
import * as orderById from '../functions/api/service-orders/[id].js';

let adminToken, managerToken, receptionToken, observerToken;
let receptionId;

beforeEach(async () => {
  // D1 enforces foreign keys: children before parents.
  for (const t of ['audit_log', 'service_order_deposits', 'service_order_items', 'booking_deposits', 'finance_transactions',
    'service_orders', 'bookings', 'user_permission_overrides', 'sessions', 'staff_accounts']) {
    await env.DB.exec(`DELETE FROM ${t}`);
  }
  const staff = async (u, role) => {
    const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES (?, 'x', ?, '2026-08-01T00:00:00Z')`).bind(u, role).run();
    return r.meta.last_row_id;
  };
  adminToken = await createSession(env.DB, await staff('qt_so', 'admin'));
  managerToken = await createSession(env.DB, await staff('ql_so', 'manager'));
  receptionId = await staff('lt_so', 'reception');
  receptionToken = await createSession(env.DB, receptionId);
  observerToken = await createSession(env.DB, await staff('qs_so', 'observer'));
});

export function call(handler, { method = 'GET', url = 'https://x/api/service-orders', token, body, params = {}, testEnv = env }) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return handler({ request: new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined }), env: testEnv, params });
}

const ORDER = {
  orderType: 'dat_tiec', customerName: 'Chị Lan', phone: '0900000000', organization: 'Công ty A', note: null,
  eventDate: '2026-12-20', eventTime: '18:30', guestCount: 50, venueNote: 'Sân vườn', bookingId: null,
  primaryCategory: 'bep_hien_le',
  items: [
    { description: 'Set menu 8 món', quantity: 5, unitPrice: 2000000, financeCategory: 'bep_hien_le' },
    { description: 'Nước uống', quantity: 1, unitPrice: 1000000, financeCategory: 'hien_le_drinks' },
  ],
};

export async function createOrder(overrides = {}, token = managerToken) {
  const response = await call(ordersIndex.onRequestPost, { method: 'POST', token, body: { ...ORDER, ...overrides } });
  expect(response.status).toBe(201);
  return (await response.json()).id;
}

describe('POST /api/service-orders', () => {
  it('creates a draft with items, settings defaults and one creation audit without the phone', async () => {
    const id = await createOrder();
    const row = await env.DB.prepare('SELECT * FROM service_orders WHERE id = ?').bind(id).first();
    expect(row).toMatchObject({ status: 'draft', deposit_amount: 0, quote_valid_days: 7, requested_deposit: 3300000, created_by: 'ql_so' });
    const items = (await env.DB.prepare('SELECT description, display_order FROM service_order_items WHERE order_id = ? ORDER BY display_order').bind(id).all()).results;
    expect(items.map((i) => i.description)).toEqual(['Set menu 8 món', 'Nước uống']);
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'service_order_create'`).first();
    expect(audit).toMatchObject({ entity_type: 'service_order', entity_id: id, entity_label: `Đơn #${id}`, actor: 'ql_so' });
    expect(audit.new_value).not.toContain('0900000000');
  });

  it('lets reception create but not observer (403)', async () => {
    await createOrder({}, receptionToken);
    const denied = await call(ordersIndex.onRequestPost, { method: 'POST', token: observerToken, body: ORDER });
    expect(denied.status).toBe(403);
  });

  it('rejects an expense primary line, a bad item and an unknown booking', async () => {
    for (const body of [{ ...ORDER, primaryCategory: 'vat_tu' }, { ...ORDER, items: [{ ...ORDER.items[0], quantity: 0 }] }, { ...ORDER, bookingId: 999999 }]) {
      const response = await call(ordersIndex.onRequestPost, { method: 'POST', token: managerToken, body });
      expect(response.status).toBe(400);
    }
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM service_orders').first()).n).toBe(0);
  });

  it('rejects a body above 64 KiB with 413', async () => {
    const response = await call(ordersIndex.onRequestPost, { method: 'POST', token: managerToken, body: { ...ORDER, note: 'x'.repeat(70000) } });
    expect(response.status).toBe(413);
  });
});

describe('GET /api/service-orders and /:id', () => {
  it('lists open orders by event date and hides phone without guests.contact_view', async () => {
    const late = await createOrder({ eventDate: '2026-12-30' });
    const early = await createOrder({ eventDate: '2026-12-01' });
    const response = await call(ordersIndex.onRequestGet, { url: 'https://x/api/service-orders?status=open', token: observerToken });
    const rows = await response.json();
    expect(rows.map((r) => r.id)).toEqual([early, late]);
    expect(rows[0]).toMatchObject({ total: 11000000, quoteNumber: expect.stringMatching(/^BG-\d{4}-\d{4}$/), phone: null });
  });

  it('returns the detail with items, deposits, totals per line and 404 for a hidden order without records.hide', async () => {
    const id = await createOrder();
    const detail = await (await call(orderById.onRequestGet, { url: `https://x/api/service-orders/${id}`, token: receptionToken, params: { id: String(id) } })).json();
    expect(detail.categoryTotals).toEqual({ bep_hien_le: 10000000, hien_le_drinks: 1000000 });
    expect(detail.phone).toBe('0900000000');
    await env.DB.prepare('UPDATE service_orders SET is_hidden = 1 WHERE id = ?').bind(id).run();
    const hidden = await call(orderById.onRequestGet, { url: `https://x/api/service-orders/${id}`, token: receptionToken, params: { id: String(id) } });
    expect(hidden.status).toBe(404);
  });

  it('serves income categories to reception', async () => {
    const rows = await (await call(ordersCategories.onRequestGet, { url: 'https://x/api/service-orders/categories', token: receptionToken })).json();
    expect(rows.find((c) => c.slug === 'bep_hien_le')).toMatchObject({ label: expect.any(String), isActive: true });
    expect(rows.some((c) => c.slug === 'vat_tu')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js`
Expected: FAIL — endpoint modules missing.

- [ ] **Step 3: Implement `functions/api/service-orders/categories.js`**

```js
import { json, requireOrderPermission } from '../../../lib/serviceOrders.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.view');
  if (auth instanceof Response) return auth;
  const { results } = await env.DB.prepare(`SELECT slug, label, is_active FROM finance_categories WHERE type = 'income' ORDER BY display_order, id`).all();
  return json(results.map((r) => ({ slug: r.slug, label: r.label, isActive: !!r.is_active })));
}
```

- [ ] **Step 4: Implement `functions/api/service-orders/index.js`**

```js
import { hasPermission } from '../../../lib/permissions.js';
import { readJsonBody } from '../../../lib/readJsonBody.js';
import { loadCategoryMeta } from '../../../lib/financeCategories.js';
import { redactContact } from '../../../lib/redactContact.js';
import { loadQuoteSettings } from '../../../lib/quoteSettings.js';
import {
  ORDER_TYPES, MAX_BODY_BYTES, json, jsonError, requireOrderPermission, validateOrderFields, validateItems,
  orderTotal, roundDeposit, checkBookingLink, coerceOrderSummary,
} from '../../../lib/serviceOrders.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ request, env }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.view');
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const type = url.searchParams.get('type');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const q = url.searchParams.get('q');
  const includeHidden = url.searchParams.get('includeHidden') === '1';
  const clauses = [];
  const params = [];
  if (status === 'open') clauses.push(`status IN ('draft', 'confirmed')`);
  else if (status === 'history') clauses.push(`status IN ('settled', 'cancelled')`);
  else if (status) return jsonError('Trạng thái không hợp lệ', 400);
  if (type) {
    if (!ORDER_TYPES.includes(type)) return jsonError('Loại đơn không hợp lệ', 400);
    clauses.push('order_type = ?'); params.push(type);
  }
  if (from) { if (!DATE_RE.test(from)) return jsonError('Ngày không hợp lệ', 400); clauses.push('event_date >= ?'); params.push(from); }
  if (to) { if (!DATE_RE.test(to)) return jsonError('Ngày không hợp lệ', 400); clauses.push('event_date <= ?'); params.push(to); }
  if (q) {
    if (q.length > 100) return jsonError('Từ khoá quá dài', 400);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    clauses.push(`(customer_name LIKE ? ESCAPE '\\' OR organization LIKE ? ESCAPE '\\'${hasPermission(auth, 'guests.contact_view') ? ` OR phone LIKE ? ESCAPE '\\'` : ''})`);
    params.push(like, like);
    if (hasPermission(auth, 'guests.contact_view')) params.push(like);
  }
  if (includeHidden && !hasPermission(auth, 'records.hide')) return jsonError('Không đủ quyền', 403);
  if (!includeHidden) clauses.push('is_hidden = 0');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = status === 'history' ? 'COALESCE(settled_at, cancelled_at) DESC, id DESC' : 'event_date ASC, event_time ASC, id ASC';
  const { results } = await env.DB.prepare(`SELECT o.*, (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM service_order_items i WHERE i.order_id = o.id) AS total
    FROM service_orders o ${where} ORDER BY ${order} LIMIT 500`).bind(...params).all();
  const rows = results.map(coerceOrderSummary);
  redactContact(auth, rows);
  return json(rows);
}

export async function onRequestPost({ request, env }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const parsed = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const categoryMeta = await loadCategoryMeta(env);
  const items = validateItems(body.items ?? [], categoryMeta, []);
  if (items.error) return jsonError(items.error, 400);
  const settings = await loadQuoteSettings(env.DB);
  const fields = validateOrderFields({
    ...body,
    quoteValidDays: body.quoteValidDays ?? settings.defaultValidDays,
    requestedDeposit: body.requestedDeposit ?? roundDeposit(orderTotal(items.value), settings.defaultDepositPercent),
  }, categoryMeta, null);
  if (fields.error) return jsonError(fields.error, 400);
  const linkError = await checkBookingLink(env, auth, fields.value.bookingId);
  if (linkError) return linkError;

  const f = fields.value;
  const now = new Date().toISOString();
  const key = crypto.randomUUID();
  const orderRef = '(SELECT id FROM service_orders WHERE creation_key = ?)';
  const summary = JSON.stringify({ orderType: f.orderType, eventDate: f.eventDate, total: orderTotal(items.value), items: items.value.length });
  const statements = [
    env.DB.prepare(`INSERT INTO service_orders (creation_key, order_type, customer_name, phone, organization, note, event_date, event_time,
        guest_count, venue_note, booking_id, primary_category, quote_valid_days, requested_deposit, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind(key, f.orderType, f.customerName, f.phone, f.organization, f.note, f.eventDate, f.eventTime, f.guestCount, f.venueNote,
        f.bookingId, f.primaryCategory, f.quoteValidDays, f.requestedDeposit, auth.username, now),
    env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
      SELECT 'service_order_create', 'service_order', id, 'Đơn #' || id, NULL, ?, ?, ? FROM service_orders WHERE creation_key = ?`)
      .bind(summary, auth.username, now, key),
    ...items.value.map((it, index) => env.DB.prepare(`INSERT INTO service_order_items (order_id, description, quantity, unit_price, finance_category, display_order)
      SELECT ${orderRef}, ?, ?, ?, ?, ?`).bind(key, it.description, it.quantity, it.unitPrice, it.financeCategory, index)),
  ];
  const results = await env.DB.batch(statements);
  return json({ id: results[0].results[0].id }, 201);
}
```

- [ ] **Step 5: Implement GET in `functions/api/service-orders/[id].js`**

```js
import { redactContact } from '../../../lib/redactContact.js';
import { json, jsonError, NOT_FOUND, requireOrderPermission, loadVisibleOrder, loadItems, loadDeposits, coerceOrder } from '../../../lib/serviceOrders.js';

export async function onRequestGet({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.view');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  const out = coerceOrder(order, await loadItems(env.DB, order.id), await loadDeposits(env.DB, order.id));
  redactContact(auth, out);
  return json(out);
}
```

- [ ] **Step 6: Run to verify pass**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/api/service-orders/index.js functions/api/service-orders/categories.js "functions/api/service-orders/[id].js" test/serviceOrders.test.js
git commit -m "feat(service-orders): list, categories, create and detail endpoints"
```

---

### Task 5: Update and confirm endpoints

**Files:**
- Modify: `functions/api/service-orders/[id].js` (add PATCH)
- Create: `functions/api/service-orders/[id]/confirm.js`
- Test: `test/serviceOrders.test.js` (append)

**Interfaces:**
- Consumes: Task 2 helpers; Task 4 test helpers `call`, `createOrder`, `ORDER`.
- Produces: `PATCH /api/service-orders/:id` (full order body incl. `items` with `id` for kept rows) → `200 { ok }`; `POST /api/service-orders/:id/confirm` → `200 { ok }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/serviceOrders.test.js` (add `import * as confirmOrder from '../functions/api/service-orders/[id]/confirm.js';` at the top):

```js
async function detail(id, token = managerToken) {
  return (await call(orderById.onRequestGet, { url: `https://x/api/service-orders/${id}`, token, params: { id: String(id) } })).json();
}
function patch(id, body, token = managerToken, testEnv = env) {
  return call(orderById.onRequestPatch, { method: 'PATCH', url: `https://x/api/service-orders/${id}`, token, body, params: { id: String(id) }, testEnv });
}
function bodyFrom(d, changes = {}) {
  return {
    orderType: d.orderType, customerName: d.customerName, phone: d.phone, organization: d.organization, note: d.note,
    eventDate: d.eventDate, eventTime: d.eventTime, guestCount: d.guestCount, venueNote: d.venueNote, bookingId: d.bookingId,
    primaryCategory: d.primaryCategory, quoteValidDays: d.quoteValidDays, requestedDeposit: d.requestedDeposit,
    items: d.items.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, financeCategory: i.financeCategory })),
    ...changes,
  };
}

describe('PATCH /api/service-orders/:id', () => {
  it('updates header and items (keep, change, remove, add) and writes one update audit', async () => {
    const id = await createOrder();
    const d = await detail(id);
    const items = [{ ...bodyFrom(d).items[0], quantity: 6 }, { description: 'Thuê âm thanh', quantity: 1, unitPrice: 3000000, financeCategory: 'ban_hang' }];
    expect((await patch(id, bodyFrom(d, { customerName: 'Anh Minh', items }))).status).toBe(200);
    const after = await detail(id);
    expect(after.customerName).toBe('Anh Minh');
    expect(after.items.map((i) => [i.description, i.quantity])).toEqual([['Set menu 8 món', 6], ['Thuê âm thanh', 1]]);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'service_order_update'`).first()).n).toBe(1);
  });

  it('stale snapshot returns 409 and writes nothing', async () => {
    const id = await createOrder();
    const d = await detail(id);
    const raced = envWithHookBefore(/INSERT INTO audit_log/, async () => {
      await env.DB.prepare('UPDATE service_order_items SET quantity = 9 WHERE order_id = ?').bind(id).run();
    });
    const response = await patch(id, bodyFrom(d, { customerName: 'Muộn' }), managerToken, raced);
    expect(response.status).toBe(409);
    expect((await detail(id)).customerName).toBe('Chị Lan');
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'service_order_update'`).first()).n).toBe(0);
  });

  it('refuses edits that would push the primary line below the deposit', async () => {
    const id = await createOrder();
    await env.DB.prepare('UPDATE service_orders SET deposit_amount = 5000000 WHERE id = ?').bind(id).run();
    const d = await detail(id);
    const moved = bodyFrom(d).items.map((i) => ({ ...i, financeCategory: 'hien_le_drinks' }));
    expect((await patch(id, bodyFrom(d, { items: moved }))).status).toBe(400);
    expect((await patch(id, bodyFrom(d, { primaryCategory: 'hien_le_drinks' }))).status).toBe(400);
  });

  it('keeps the stored phone when the editor cannot see contacts', async () => {
    const id = await createOrder();
    await setOverride(env.DB, receptionId, 'guests.contact_view', 'deny');
    const d = await detail(id, receptionToken);
    expect(d.phone).toBeNull();
    expect((await patch(id, bodyFrom(d, { note: 'Đổi ghi chú' }), receptionToken)).status).toBe(200);
    expect((await env.DB.prepare('SELECT phone FROM service_orders WHERE id = ?').bind(id).first()).phone).toBe('0900000000');
  });

  it('rejects edits on settled or cancelled orders and from observers', async () => {
    const id = await createOrder();
    const d = await detail(id);
    expect((await patch(id, bodyFrom(d), observerToken)).status).toBe(403);
    await env.DB.prepare(`UPDATE service_orders SET status = 'cancelled' WHERE id = ?`).bind(id).run();
    expect((await patch(id, bodyFrom(d))).status).toBe(400);
  });
});

describe('POST /api/service-orders/:id/confirm', () => {
  it('confirms a draft with items once', async () => {
    const id = await createOrder();
    const ok = await call(confirmOrder.onRequestPost, { method: 'POST', token: receptionToken, params: { id: String(id) } });
    expect(ok.status).toBe(200);
    expect((await env.DB.prepare('SELECT status, confirmed_by FROM service_orders WHERE id = ?').bind(id).first())).toEqual({ status: 'confirmed', confirmed_by: 'lt_so' });
    const again = await call(confirmOrder.onRequestPost, { method: 'POST', token: receptionToken, params: { id: String(id) } });
    expect(again.status).toBe(400);
  });

  it('refuses to confirm an order without items', async () => {
    const id = await createOrder({ items: [] });
    const response = await call(confirmOrder.onRequestPost, { method: 'POST', token: managerToken, params: { id: String(id) } });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js -t "PATCH|confirm"`
Expected: FAIL — `onRequestPatch` and `confirm.js` missing.

- [ ] **Step 3: Implement PATCH**

Append to `functions/api/service-orders/[id].js` and extend its imports to:

```js
import { hasPermission } from '../../../lib/permissions.js';
import { readJsonBody } from '../../../lib/readJsonBody.js';
import { loadCategoryMeta } from '../../../lib/financeCategories.js';
import { redactContact } from '../../../lib/redactContact.js';
import {
  json, jsonError, NOT_FOUND, STALE, DEPOSIT_EXCEEDS, OPEN_STATUSES, MAX_BODY_BYTES, requireOrderPermission, loadVisibleOrder,
  loadItems, loadDeposits, coerceOrder, validateOrderFields, validateItems, categoryTotals, orderTotal, checkBookingLink,
  readSnapshot, orderGuardSql, gateSql, auditInsert,
} from '../../../lib/serviceOrders.js';
```

```js
export async function onRequestPatch({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (!OPEN_STATUSES.includes(order.status)) return jsonError('Chỉ sửa được đơn nháp hoặc đã chốt', 400);
  const parsed = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  // An editor who cannot see contacts receives phone = null; never overwrite the stored value.
  if (!hasPermission(auth, 'guests.contact_view')) body.phone = order.phone;
  const categoryMeta = await loadCategoryMeta(env);
  const fields = validateOrderFields(body, categoryMeta, order.primary_category);
  if (fields.error) return jsonError(fields.error, 400);
  const currentItems = await loadItems(env.DB, order.id);
  const items = validateItems(body.items, categoryMeta, currentItems);
  if (items.error) return jsonError(items.error, 400);
  if (order.status === 'confirmed' && items.value.length === 0) return jsonError('Đơn đã chốt phải có ít nhất 1 dòng', 400);
  const linkError = await checkBookingLink(env, auth, fields.value.bookingId);
  if (linkError) return linkError;
  if (order.deposit_amount > (categoryTotals(items.value)[fields.value.primaryCategory] || 0)) return jsonError(DEPOSIT_EXCEEDS, 400);

  const f = fields.value;
  const snapshot = await readSnapshot(env.DB, order.id);
  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID(), total: orderTotal(items.value), items: items.value.length });
  const gate = gateSql('service_order_update');
  const gateBinds = [order.id, auditValue];
  const keep = new Set(items.value.filter((i) => i.id !== null).map((i) => i.id));
  const statements = [
    auditInsert(env.DB, 'service_order_update', order.id, auditValue, auth.username, now,
      orderGuardSql(OPEN_STATUSES), [order.id, order.deposit_amount, order.id, snapshot]),
    env.DB.prepare(`UPDATE service_orders SET order_type = ?, customer_name = ?, phone = ?, organization = ?, note = ?, event_date = ?,
        event_time = ?, guest_count = ?, venue_note = ?, booking_id = ?, primary_category = ?, quote_valid_days = ?, requested_deposit = ?,
        updated_by = ?, updated_at = ? WHERE id = ? AND ${gate}`)
      .bind(f.orderType, f.customerName, f.phone, f.organization, f.note, f.eventDate, f.eventTime, f.guestCount, f.venueNote,
        f.bookingId, f.primaryCategory, f.quoteValidDays, f.requestedDeposit, auth.username, now, order.id, ...gateBinds),
    ...currentItems.filter((c) => !keep.has(c.id)).map((c) => env.DB.prepare(
      `DELETE FROM service_order_items WHERE id = ? AND order_id = ? AND ${gate}`).bind(c.id, order.id, ...gateBinds)),
    ...items.value.map((it, index) => (it.id !== null
      ? env.DB.prepare(`UPDATE service_order_items SET description = ?, quantity = ?, unit_price = ?, finance_category = ?, display_order = ?
          WHERE id = ? AND order_id = ? AND ${gate}`)
        .bind(it.description, it.quantity, it.unitPrice, it.financeCategory, index, it.id, order.id, ...gateBinds)
      : env.DB.prepare(`INSERT INTO service_order_items (order_id, description, quantity, unit_price, finance_category, display_order)
          SELECT ?, ?, ?, ?, ?, ? WHERE ${gate}`)
        .bind(order.id, it.description, it.quantity, it.unitPrice, it.financeCategory, index, ...gateBinds))),
  ];
  const results = await env.DB.batch(statements);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ ok: true });
}
```

- [ ] **Step 4: Implement `functions/api/service-orders/[id]/confirm.js`**

```js
import {
  json, jsonError, NOT_FOUND, STALE, requireOrderPermission, loadVisibleOrder, readSnapshot, orderGuardSql, gateSql, auditInsert,
} from '../../../../lib/serviceOrders.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (order.status !== 'draft') return jsonError('Chỉ chốt được đơn nháp', 400);
  const snapshot = await readSnapshot(env.DB, order.id);
  if (snapshot === '[]') return jsonError('Đơn cần ít nhất 1 dòng trước khi chốt', 400);
  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID() });
  const results = await env.DB.batch([
    auditInsert(env.DB, 'service_order_confirm', order.id, auditValue, auth.username, now,
      orderGuardSql(['draft']), [order.id, order.deposit_amount, order.id, snapshot]),
    env.DB.prepare(`UPDATE service_orders SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ? AND ${gateSql('service_order_confirm')}`)
      .bind(auth.username, now, order.id, order.id, auditValue),
  ]);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ ok: true });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "functions/api/service-orders/[id].js" "functions/api/service-orders/[id]/confirm.js" test/serviceOrders.test.js
git commit -m "feat(service-orders): guarded update and confirm"
```

---

### Task 6: Deposits (add and delete)

**Files:**
- Create: `functions/api/service-orders/[id]/deposits/index.js`, `functions/api/service-orders/[id]/deposits/[depositId].js`
- Test: `test/serviceOrders.test.js` (append)

**Interfaces:**
- Produces: `POST /api/service-orders/:id/deposits` body `{ amount, paymentMethod, note? }` → `201 { depositId, depositAmount }`; `DELETE /api/service-orders/:id/deposits/:depositId` → `200 { ok }`. Test helper `addDeposit(id, amount, token = managerToken)` returns the Response.

- [ ] **Step 1: Write the failing tests**

Append (add imports `import * as orderDeposits from '../functions/api/service-orders/[id]/deposits/index.js';` and `import * as orderDeposit from '../functions/api/service-orders/[id]/deposits/[depositId].js';`):

```js
function addDeposit(id, amount, token = managerToken, testEnv = env, extra = {}) {
  return call(orderDeposits.onRequestPost, { method: 'POST', token, params: { id: String(id) }, body: { amount, paymentMethod: 'transfer', ...extra }, testEnv });
}

describe('service order deposits', () => {
  it('records an income row in the primary line linked to the order', async () => {
    const id = await createOrder();
    const response = await addDeposit(id, 3000000, receptionToken, env, { note: 'đợt 1' });
    expect(response.status).toBe(201);
    expect((await response.json()).depositAmount).toBe(3000000);
    const tx = await env.DB.prepare('SELECT type, category, amount, service_order_id, note FROM finance_transactions WHERE service_order_id = ?').bind(id).first();
    expect(tx).toMatchObject({ type: 'income', category: 'bep_hien_le', amount: 3000000, service_order_id: id });
    expect(tx.note).toBe(`Cọc đơn #${id} — Chị Lan — đợt 1`);
    const dep = await env.DB.prepare('SELECT finance_transaction_id FROM service_order_deposits WHERE order_id = ?').bind(id).first();
    expect(dep.finance_transaction_id).toBeGreaterThan(0);
  });

  it('refuses a deposit above the primary line value', async () => {
    const id = await createOrder();
    expect((await addDeposit(id, 10000001)).status).toBe(400);
    expect((await addDeposit(id, 6000000)).status).toBe(201);
    expect((await addDeposit(id, 4000001)).status).toBe(400);
    expect((await env.DB.prepare('SELECT deposit_amount FROM service_orders WHERE id = ?').bind(id).first()).deposit_amount).toBe(6000000);
  });

  it('two concurrent deposits that together exceed the line: exactly one wins', async () => {
    const id = await createOrder();
    let inner;
    const raced = envWithHookBefore(/INSERT INTO audit_log/, async () => { inner = await addDeposit(id, 6000000); });
    const outer = await addDeposit(id, 6000000, managerToken, raced);
    expect([inner.status, outer.status].sort()).toEqual([201, 409]);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM finance_transactions WHERE service_order_id = ?').bind(id).first()).n).toBe(1);
  });

  it('deleting a deposit needs service_orders.refund and voids its income row', async () => {
    const id = await createOrder();
    const { depositId } = await (await addDeposit(id, 2000000)).json();
    const del = (token) => call(orderDeposit.onRequestDelete, { method: 'DELETE', token, params: { id: String(id), depositId: String(depositId) } });
    expect((await del(receptionToken)).status).toBe(403);
    expect((await del(managerToken)).status).toBe(200);
    const order = await env.DB.prepare('SELECT deposit_amount FROM service_orders WHERE id = ?').bind(id).first();
    expect(order.deposit_amount).toBe(0);
    const tx = await env.DB.prepare('SELECT voided_at FROM finance_transactions WHERE service_order_id = ?').bind(id).first();
    expect(tx.voided_at).not.toBeNull();
    expect((await del(managerToken)).status).toBe(400);
  });

  it('refuses deposits on settled or cancelled orders', async () => {
    const id = await createOrder();
    await env.DB.prepare(`UPDATE service_orders SET status = 'settled' WHERE id = ?`).bind(id).run();
    expect((await addDeposit(id, 100000)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js -t "deposits"`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `deposits/index.js`**

```js
import { readJsonBody } from '../../../../../lib/readJsonBody.js';
import {
  json, jsonError, NOT_FOUND, STALE, DEPOSIT_EXCEEDS, OPEN_STATUSES, PAYMENT_METHODS, LIMITS, requireOrderPermission, loadVisibleOrder,
  loadItems, categoryTotals, readSnapshot, orderGuardSql, gateSql, auditInsert,
} from '../../../../../lib/serviceOrders.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (!OPEN_STATUSES.includes(order.status)) return jsonError('Chỉ nhận cọc cho đơn nháp hoặc đã chốt', 400);
  const parsed = await readJsonBody(request, { maxBytes: 4096 });
  if (!parsed.ok) return parsed.response;
  const { amount, paymentMethod, note } = parsed.body;
  if (!Number.isInteger(amount) || amount <= 0 || amount > LIMITS.total) return jsonError('Số tiền cọc phải là số nguyên dương', 400);
  if (!PAYMENT_METHODS.includes(paymentMethod)) return jsonError('Vui lòng chọn hình thức thanh toán', 400);
  if (note != null && (typeof note !== 'string' || note.length > 500)) return jsonError('Ghi chú tối đa 500 ký tự', 400);
  const items = await loadItems(env.DB, order.id);
  if (order.deposit_amount + amount > (categoryTotals(items)[order.primary_category] || 0)) return jsonError(DEPOSIT_EXCEEDS, 400);

  const snapshot = await readSnapshot(env.DB, order.id);
  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID(), amount, paymentMethod });
  const gate = gateSql('service_order_deposit');
  const gateBinds = [order.id, auditValue];
  const cleanNote = note && note.trim() ? note.trim() : null;
  const txNote = `Cọc đơn #${order.id} — ${order.customer_name}${cleanNote ? ` — ${cleanNote}` : ''}`;
  const results = await env.DB.batch([
    auditInsert(env.DB, 'service_order_deposit', order.id, auditValue, auth.username, now,
      orderGuardSql(OPEN_STATUSES), [order.id, order.deposit_amount, order.id, snapshot]),
    env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, service_order_id)
      SELECT 'income', ?, ?, ?, ?, 'confirmed', ?, ?, ? WHERE ${gate}`)
      .bind(order.primary_category, amount, txNote, now.slice(0, 10), auth.username, now, order.id, ...gateBinds),
    // Immediately follows the receipt INSERT in the same transaction.
    env.DB.prepare(`INSERT INTO service_order_deposits (order_id, amount, payment_method, note, finance_transaction_id, created_by, created_at)
      SELECT ?, ?, ?, ?, last_insert_rowid(), ?, ? WHERE ${gate}`)
      .bind(order.id, amount, paymentMethod, cleanNote, auth.username, now, ...gateBinds),
    env.DB.prepare(`UPDATE service_orders SET deposit_amount = deposit_amount + ? WHERE id = ? AND ${gate}`).bind(amount, order.id, ...gateBinds),
  ]);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ depositId: results[2].meta.last_row_id, depositAmount: order.deposit_amount + amount }, 201);
}
```

- [ ] **Step 4: Implement `deposits/[depositId].js`**

```js
import {
  json, jsonError, NOT_FOUND, STALE, requireOrderPermission, loadVisibleOrder, gateSql, auditInsert,
} from '../../../../../lib/serviceOrders.js';

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.refund');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (!['draft', 'confirmed'].includes(order.status)) return jsonError('Chỉ xoá cọc của đơn nháp hoặc đã chốt', 400);
  const deposit = await env.DB.prepare('SELECT * FROM service_order_deposits WHERE id = ? AND order_id = ?').bind(params.depositId, order.id).first();
  if (!deposit) return jsonError('Không tìm thấy dòng cọc', 404);
  if (deposit.voided_at) return jsonError('Dòng cọc này đã được xoá', 400);
  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID(), depositId: deposit.id, amount: deposit.amount });
  const gate = gateSql('service_order_deposit_delete');
  const gateBinds = [order.id, auditValue];
  const guard = `EXISTS (SELECT 1 FROM service_orders WHERE id = ? AND status IN ('draft', 'confirmed') AND deposit_amount = ?)
    AND EXISTS (SELECT 1 FROM service_order_deposits WHERE id = ? AND order_id = ? AND voided_at IS NULL)`;
  const results = await env.DB.batch([
    auditInsert(env.DB, 'service_order_deposit_delete', order.id, auditValue, auth.username, now, guard,
      [order.id, order.deposit_amount, deposit.id, order.id]),
    env.DB.prepare(`UPDATE service_order_deposits SET voided_by = ?, voided_at = ? WHERE id = ? AND voided_at IS NULL AND ${gate}`)
      .bind(auth.username, now, deposit.id, ...gateBinds),
    env.DB.prepare(`UPDATE finance_transactions SET voided_by = ?, voided_at = ? WHERE id = ? AND voided_at IS NULL AND ${gate}`)
      .bind(auth.username, now, deposit.finance_transaction_id, ...gateBinds),
    env.DB.prepare(`UPDATE service_orders SET deposit_amount = deposit_amount - ? WHERE id = ? AND ${gate}`).bind(deposit.amount, order.id, ...gateBinds),
  ]);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ ok: true });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "functions/api/service-orders/[id]/deposits" test/serviceOrders.test.js
git commit -m "feat(service-orders): deposits into the primary revenue line"
```

---

### Task 7: Settlement

**Files:**
- Create: `functions/api/service-orders/[id]/settle.js`
- Test: `test/serviceOrders.test.js` (append)

**Interfaces:**
- Produces: `POST /api/service-orders/:id/settle` body `{ paymentMethod }` (required only when the plan has amounts) → `200 { receipts: [{ category, amount }] }`.

- [ ] **Step 1: Write the failing tests**

Append (import `import * as settleOrder from '../functions/api/service-orders/[id]/settle.js';`):

```js
async function confirmed(overrides = {}) {
  const id = await createOrder(overrides);
  expect((await call(confirmOrder.onRequestPost, { method: 'POST', token: managerToken, params: { id: String(id) } })).status).toBe(200);
  return id;
}
function settle(id, body = { paymentMethod: 'cash' }, token = managerToken, testEnv = env) {
  return call(settleOrder.onRequestPost, { method: 'POST', token, params: { id: String(id) }, body, testEnv });
}

describe('POST /api/service-orders/:id/settle', () => {
  it('writes one income row per line, subtracting the deposit from the primary line', async () => {
    const id = await confirmed();
    await addDeposit(id, 3000000);
    const response = await settle(id);
    expect(response.status).toBe(200);
    const rows = (await env.DB.prepare(`SELECT category, amount, note FROM finance_transactions
      WHERE service_order_id = ? AND id NOT IN (SELECT finance_transaction_id FROM service_order_deposits) ORDER BY category`).bind(id).all()).results;
    expect(rows.map((r) => [r.category, r.amount])).toEqual([['bep_hien_le', 7000000], ['hien_le_drinks', 1000000]]);
    expect(rows[0].note).toBe(`Tất toán đơn #${id} — Chị Lan`);
    expect(await env.DB.prepare('SELECT status, settlement_payment_method FROM service_orders WHERE id = ?').bind(id).first())
      .toEqual({ status: 'settled', settlement_payment_method: 'cash' });
  });

  it('succeeds with no receipt and no payment method when the deposit covers everything', async () => {
    const id = await confirmed({ items: [{ description: 'Tiệc', quantity: 1, unitPrice: 2000000, financeCategory: 'bep_hien_le' }] });
    await addDeposit(id, 2000000);
    const response = await settle(id, {});
    expect(response.status).toBe(200);
    expect((await response.json()).receipts).toEqual([]);
  });

  it('requires a payment method when something is due, and only for confirmed orders', async () => {
    const draft = await createOrder();
    expect((await settle(draft)).status).toBe(400);
    const id = await confirmed();
    expect((await settle(id, {})).status).toBe(400);
  });

  it('a deposit landing after preflight makes settlement return 409 with no receipts', async () => {
    const id = await confirmed();
    const raced = envWithHookBefore(/INSERT INTO audit_log/, async () => { await addDeposit(id, 1000000); });
    expect((await settle(id, { paymentMethod: 'cash' }, managerToken, raced)).status).toBe(409);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions WHERE service_order_id = ? AND note LIKE 'Tất toán%'`).bind(id).first()).n).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js -t "settle"`
Expected: FAIL.

- [ ] **Step 3: Implement `settle.js`**

```js
import { readJsonBody } from '../../../../lib/readJsonBody.js';
import {
  json, jsonError, NOT_FOUND, STALE, PAYMENT_METHODS, requireOrderPermission, loadVisibleOrder, loadItems, settlementPlan,
  readSnapshot, orderGuardSql, gateSql, auditInsert,
} from '../../../../lib/serviceOrders.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (order.status !== 'confirmed') return jsonError('Chỉ tất toán được đơn đã chốt', 400);
  const parsed = await readJsonBody(request, { maxBytes: 1024 });
  if (!parsed.ok) return parsed.response;
  const items = await loadItems(env.DB, order.id);
  const plan = settlementPlan(items, order.primary_category, order.deposit_amount);
  const paymentMethod = plan.length ? parsed.body.paymentMethod : null;
  if (plan.length && !PAYMENT_METHODS.includes(paymentMethod)) return jsonError('Vui lòng chọn hình thức thanh toán', 400);

  const snapshot = await readSnapshot(env.DB, order.id);
  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID(), paymentMethod, receipts: plan });
  const gate = gateSql('service_order_settle');
  const gateBinds = [order.id, auditValue];
  const note = `Tất toán đơn #${order.id} — ${order.customer_name}`;
  const results = await env.DB.batch([
    auditInsert(env.DB, 'service_order_settle', order.id, auditValue, auth.username, now,
      orderGuardSql(['confirmed']), [order.id, order.deposit_amount, order.id, snapshot]),
    ...plan.map((p) => env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, service_order_id)
      SELECT 'income', ?, ?, ?, ?, 'confirmed', ?, ?, ? WHERE ${gate}`)
      .bind(p.category, p.amount, note, now.slice(0, 10), auth.username, now, order.id, ...gateBinds)),
    env.DB.prepare(`UPDATE service_orders SET status = 'settled', settled_by = ?, settled_at = ?, settlement_payment_method = ? WHERE id = ? AND ${gate}`)
      .bind(auth.username, now, paymentMethod, order.id, ...gateBinds),
  ]);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ receipts: plan });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "functions/api/service-orders/[id]/settle.js" test/serviceOrders.test.js
git commit -m "feat(service-orders): settle each revenue line atomically"
```

---

### Task 8: Cancel and hide

**Files:**
- Create: `functions/api/service-orders/[id]/cancel.js`, `functions/api/service-orders/[id]/hide.js`
- Test: `test/serviceOrders.test.js` (append)

**Interfaces:**
- Produces: `POST /api/service-orders/:id/cancel` body `{ origin: 'hotel'|'guest', reason, refundAmount?, refundPaymentMethod? }` → `200 { refundAmount }`; `PATCH /api/service-orders/:id/hide` body `{ hidden: boolean }` → `200 { ok }`.

- [ ] **Step 1: Write the failing tests**

Append (imports `import * as cancelOrder from '../functions/api/service-orders/[id]/cancel.js';` and `import * as hideOrder from '../functions/api/service-orders/[id]/hide.js';`):

```js
function cancel(id, body, token = managerToken) {
  return call(cancelOrder.onRequestPost, { method: 'POST', token, params: { id: String(id) }, body });
}

describe('POST /api/service-orders/:id/cancel', () => {
  it('lets reception cancel an order without deposit; reason is required', async () => {
    const id = await createOrder();
    expect((await cancel(id, { origin: 'guest', reason: '' }, receptionToken)).status).toBe(400);
    expect((await cancel(id, { origin: 'guest', reason: 'Khách đổi kế hoạch' }, receptionToken)).status).toBe(200);
    expect(await env.DB.prepare('SELECT status, cancellation_origin, refund_amount FROM service_orders WHERE id = ?').bind(id).first())
      .toEqual({ status: 'cancelled', cancellation_origin: 'guest', refund_amount: 0 });
  });

  it('refuses reception (no refund permission) on an order with a deposit, even with refund 0', async () => {
    const id = await createOrder();
    await addDeposit(id, 1000000);
    const response = await cancel(id, { origin: 'guest', reason: 'Huỷ', refundAmount: 0 }, receptionToken);
    expect(response.status).toBe(403);
    expect((await env.DB.prepare('SELECT status FROM service_orders WHERE id = ?').bind(id).first()).status).toBe('draft');
  });

  it('records a hoan_coc expense for a partial refund and keeps the rest as revenue', async () => {
    const id = await createOrder();
    await addDeposit(id, 2000000);
    const response = await cancel(id, { origin: 'hotel', reason: 'Trùng lịch', refundAmount: 1500000, refundPaymentMethod: 'transfer' });
    expect(response.status).toBe(200);
    const order = await env.DB.prepare('SELECT refund_amount, refund_payment_method, refund_finance_transaction_id FROM service_orders WHERE id = ?').bind(id).first();
    expect(order).toMatchObject({ refund_amount: 1500000, refund_payment_method: 'transfer' });
    const tx = await env.DB.prepare('SELECT type, category, amount, service_order_id FROM finance_transactions WHERE id = ?').bind(order.refund_finance_transaction_id).first();
    expect(tx).toEqual({ type: 'expense', category: 'hoan_coc', amount: 1500000, service_order_id: id });
  });

  it('rejects a refund above the deposit, a missing method and a refund without any deposit', async () => {
    const id = await createOrder();
    expect((await cancel(id, { origin: 'guest', reason: 'x', refundAmount: 1 })).status).toBe(400);
    await addDeposit(id, 1000000);
    expect((await cancel(id, { origin: 'guest', reason: 'x', refundAmount: 1000001, refundPaymentMethod: 'cash' })).status).toBe(400);
    expect((await cancel(id, { origin: 'guest', reason: 'x', refundAmount: 500000 })).status).toBe(400);
    expect((await cancel(id, { origin: 'guest', reason: 'x' })).status).toBe(400);
  });

  it('cannot cancel a settled order', async () => {
    const id = await confirmed();
    await settle(id);
    expect((await cancel(id, { origin: 'guest', reason: 'x' })).status).toBe(400);
  });
});

describe('PATCH /api/service-orders/:id/hide', () => {
  it('hides only settled/cancelled orders, with records.hide, and audits record_hide', async () => {
    const id = await createOrder();
    const hide = (token) => call(hideOrder.onRequestPatch, { method: 'PATCH', token, params: { id: String(id) }, body: { hidden: true } });
    expect((await hide(managerToken)).status).toBe(403);
    expect((await hide(adminToken)).status).toBe(400);
    await cancel(id, { origin: 'guest', reason: 'x' });
    expect((await hide(adminToken)).status).toBe(200);
    expect((await env.DB.prepare('SELECT is_hidden FROM service_orders WHERE id = ?').bind(id).first()).is_hidden).toBe(1);
    expect((await env.DB.prepare(`SELECT entity_type FROM audit_log WHERE action_type = 'record_hide'`).first()).entity_type).toBe('service_order');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js -t "cancel|hide"`
Expected: FAIL.

- [ ] **Step 3: Implement `cancel.js`**

```js
import { hasPermission } from '../../../../lib/permissions.js';
import { readJsonBody } from '../../../../lib/readJsonBody.js';
import {
  json, jsonError, NOT_FOUND, STALE, OPEN_STATUSES, PAYMENT_METHODS, LIMITS, requireOrderPermission, loadVisibleOrder, gateSql, auditInsert,
} from '../../../../lib/serviceOrders.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (!OPEN_STATUSES.includes(order.status)) return jsonError('Chỉ huỷ được đơn nháp hoặc đã chốt', 400);
  // Keeping or returning a deposit is a money decision (D9).
  if (order.deposit_amount > 0 && !hasPermission(auth, 'service_orders.refund')) return jsonError('Huỷ đơn đã có cọc cần quyền hoàn tiền', 403);
  const parsed = await readJsonBody(request, { maxBytes: 4096 });
  if (!parsed.ok) return parsed.response;
  const { origin, reason, refundPaymentMethod } = parsed.body;
  if (!['hotel', 'guest'].includes(origin)) return jsonError('Vui lòng chọn bên huỷ', 400);
  if (typeof reason !== 'string' || !reason.trim() || reason.length > LIMITS.reason) return jsonError('Vui lòng nhập lý do huỷ (tối đa 1000 ký tự)', 400);
  const refundAmount = parsed.body.refundAmount ?? (order.deposit_amount > 0 ? undefined : 0);
  if (!Number.isInteger(refundAmount) || refundAmount < 0 || refundAmount > order.deposit_amount) {
    return jsonError(order.deposit_amount > 0 ? 'Số tiền hoàn phải từ 0 đến tổng cọc' : 'Đơn chưa có cọc, không có tiền hoàn', 400);
  }
  if (refundAmount > 0 && !PAYMENT_METHODS.includes(refundPaymentMethod)) return jsonError('Vui lòng chọn hình thức hoàn tiền', 400);
  const method = refundAmount > 0 ? refundPaymentMethod : null;

  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID(), origin, reason: reason.trim(), refundAmount });
  const gate = gateSql('service_order_cancel');
  const gateBinds = [order.id, auditValue];
  const results = await env.DB.batch([
    auditInsert(env.DB, 'service_order_cancel', order.id, auditValue, auth.username, now,
      `EXISTS (SELECT 1 FROM service_orders WHERE id = ? AND status IN ('draft', 'confirmed') AND deposit_amount = ?)`, [order.id, order.deposit_amount]),
    env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, service_order_id)
      SELECT 'expense', 'hoan_coc', ?, ?, ?, 'confirmed', ?, ?, ? WHERE ? > 0 AND ${gate}`)
      .bind(refundAmount, `Hoàn cọc đơn #${order.id} — ${order.customer_name}`, now.slice(0, 10), auth.username, now, order.id, refundAmount, ...gateBinds),
    env.DB.prepare(`UPDATE service_orders SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancellation_origin = ?, cancel_reason = ?,
        refund_amount = ?, refund_payment_method = ?, refund_finance_transaction_id = CASE WHEN ? > 0 THEN last_insert_rowid() ELSE NULL END
      WHERE id = ? AND ${gate}`)
      .bind(auth.username, now, origin, reason.trim(), refundAmount, method, refundAmount, order.id, ...gateBinds),
  ]);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ refundAmount });
}
```

- [ ] **Step 4: Implement `hide.js`**

```js
import { readJsonBody } from '../../../../lib/readJsonBody.js';
import { json, jsonError, NOT_FOUND, requireOrderPermission } from '../../../../lib/serviceOrders.js';

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'records.hide');
  if (auth instanceof Response) return auth;
  const order = await env.DB.prepare('SELECT id, status, is_hidden FROM service_orders WHERE id = ?').bind(params.id).first();
  if (!order) return jsonError(NOT_FOUND, 404);
  if (!['settled', 'cancelled'].includes(order.status)) return jsonError('Chỉ ẩn được đơn đã tất toán hoặc đã huỷ', 400);
  const parsed = await readJsonBody(request, { maxBytes: 256 });
  if (!parsed.ok) return parsed.response;
  if (typeof parsed.body.hidden !== 'boolean') return jsonError('Dữ liệu không hợp lệ', 400);
  const hidden = parsed.body.hidden;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE service_orders SET is_hidden = ? WHERE id = ? AND status IN ('settled', 'cancelled')`).bind(hidden ? 1 : 0, order.id),
    env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
      SELECT 'record_hide', 'service_order', ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
      .bind(order.id, `Đơn #${order.id}`, order.is_hidden ? 'Ẩn' : 'Hiện', hidden ? 'Ẩn' : 'Hiện', auth.username, now),
  ]);
  return json({ ok: true });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "functions/api/service-orders/[id]/cancel.js" "functions/api/service-orders/[id]/hide.js" test/serviceOrders.test.js
git commit -m "feat(service-orders): refund-controlled cancel and hide"
```

---

### Task 9: Quote settings API and audit action types

**Files:**
- Create: `functions/api/quote-settings.js`
- Modify: `functions/api/audit-log/index.js`, `admin/audit-log.js`
- Test: `test/serviceOrders.test.js` (append), `test/auditLog.test.js` (append)

**Interfaces:**
- Consumes: `loadQuoteSettings`, `validateQuoteSettings`, `QUOTE_SETTINGS_MAX_BYTES`.
- Produces: `GET /api/quote-settings` (needs `settings.view` or `service_orders.view`) → settings object; `PUT /api/quote-settings` (needs `settings.quote_template`) → `200 { ok }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/serviceOrders.test.js` (import `import * as quoteSettings from '../functions/api/quote-settings.js';`):

```js
describe('/api/quote-settings', () => {
  const VALID = { businessName: 'Hiền Lê Garden', address: 'Lâm Đồng', hotline: '0968 987 311', email: 'hello@hienlegarden.vn', website: 'hienlegarden.vn',
    defaultValidDays: 10, defaultDepositPercent: 40, taxNote: 'Giá trên chưa bao gồm thuế VAT', cancellationTerms: 'Điều khoản', footerNote: '',
    bankName: 'Ngân hàng A', bankAccount: '123', bankHolder: 'HKD' };
  it('reception can read, cannot write; manager writes a new version without bank details in audit', async () => {
    expect((await call(quoteSettings.onRequestGet, { url: 'https://x/api/quote-settings', token: receptionToken })).status).toBe(200);
    expect((await call(quoteSettings.onRequestPut, { method: 'PUT', url: 'https://x/api/quote-settings', token: receptionToken, body: VALID })).status).toBe(403);
    expect((await call(quoteSettings.onRequestPut, { method: 'PUT', url: 'https://x/api/quote-settings', token: managerToken, body: VALID })).status).toBe(200);
    const read = await (await call(quoteSettings.onRequestGet, { url: 'https://x/api/quote-settings', token: receptionToken })).json();
    expect(read).toMatchObject({ defaultValidDays: 10, defaultDepositPercent: 40, bankAccount: '123', updatedBy: 'ql_so' });
    const audit = await env.DB.prepare(`SELECT new_value FROM audit_log WHERE action_type = 'quote_settings_update'`).first();
    expect(audit.new_value).not.toContain('123');
  });
  it('new orders take validity and deposit percent from the latest settings', async () => {
    await call(quoteSettings.onRequestPut, { method: 'PUT', url: 'https://x/api/quote-settings', token: managerToken, body: VALID });
    const id = await createOrder();
    expect(await env.DB.prepare('SELECT quote_valid_days, requested_deposit FROM service_orders WHERE id = ?').bind(id).first())
      .toEqual({ quote_valid_days: 10, requested_deposit: 4400000 });
  });
});
```

Append to `test/auditLog.test.js` inside its top-level file scope:

```js
describe('service order audit action types', () => {
  it('accepts every new action type as a filter', async () => {
    const { VALID_ACTION_TYPES } = await import('../functions/api/audit-log/index.js');
    for (const t of ['service_order_create', 'service_order_update', 'service_order_confirm', 'service_order_deposit',
      'service_order_deposit_delete', 'service_order_settle', 'service_order_cancel', 'quote_settings_update']) {
      expect(VALID_ACTION_TYPES).toContain(t);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js test/auditLog.test.js -t "quote-settings|service order audit"`
Expected: FAIL.

- [ ] **Step 3: Implement `functions/api/quote-settings.js`**

```js
import { requireAuth } from '../../lib/requireAuth.js';
import { hasPermission } from '../../lib/permissions.js';
import { readJsonBody } from '../../lib/readJsonBody.js';
import { loadQuoteSettings, validateQuoteSettings, QUOTE_SETTINGS_MAX_BYTES } from '../../lib/quoteSettings.js';
import { json, jsonError } from '../../lib/serviceOrders.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, null);
  if (auth instanceof Response) return auth;
  if (!hasPermission(auth, 'settings.view') && !hasPermission(auth, 'service_orders.view')) return jsonError('Không đủ quyền', 403);
  return json(await loadQuoteSettings(env.DB));
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAuth(request, env, 'settings.quote_template');
  if (auth instanceof Response) return auth;
  const parsed = await readJsonBody(request, { maxBytes: QUOTE_SETTINGS_MAX_BYTES });
  if (!parsed.ok) return parsed.response;
  const checked = validateQuoteSettings(parsed.body);
  if (checked.error) return jsonError(checked.error, 400);
  const v = checked.value;
  const previous = await loadQuoteSettings(env.DB);
  // Field names only: never copy bank details or contact data into audit.
  const changed = Object.keys(v).filter((k) => v[k] !== previous[k]);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO quote_settings (business_name, address, hotline, email, website, default_valid_days, default_deposit_percent,
        tax_note, cancellation_terms, footer_note, bank_name, bank_account, bank_holder, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(v.businessName, v.address, v.hotline, v.email, v.website, v.defaultValidDays, v.defaultDepositPercent, v.taxNote,
        v.cancellationTerms, v.footerNote, v.bankName, v.bankAccount, v.bankHolder, auth.username, now),
    env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
      VALUES ('quote_settings_update', 'quote_settings', last_insert_rowid(), 'Mẫu phiếu báo giá', NULL, ?, ?, ?)`)
      .bind(JSON.stringify({ changed }), auth.username, now),
  ]);
  return json({ ok: true });
}
```

- [ ] **Step 4: Register action types and labels**

In `functions/api/audit-log/index.js`, change the existing `VALID_ACTION_TYPES.push(...)` line to:

```js
VALID_ACTION_TYPES.push('booking_checkout', 'sale_close', 'account_password_change', 'booking_create', 'account_create',
  'service_order_create', 'service_order_update', 'service_order_confirm', 'service_order_deposit', 'service_order_deposit_delete',
  'service_order_settle', 'service_order_cancel', 'quote_settings_update');
```

In `admin/audit-log.js`, add to `ACTION_TYPE_LABELS` (after `account_create`):

```js
  service_order_create: 'Tạo đơn dịch vụ',
  service_order_update: 'Sửa đơn dịch vụ',
  service_order_confirm: 'Chốt đơn dịch vụ',
  service_order_deposit: 'Nhận cọc đơn dịch vụ',
  service_order_deposit_delete: 'Xoá cọc đơn dịch vụ',
  service_order_settle: 'Tất toán đơn dịch vụ',
  service_order_cancel: 'Huỷ đơn dịch vụ',
  quote_settings_update: 'Sửa mẫu phiếu báo giá',
```

- [ ] **Step 5: Run to verify pass**

Run: `node node_modules/vitest/vitest.mjs run test/serviceOrders.test.js test/auditLog.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/api/quote-settings.js functions/api/audit-log/index.js admin/audit-log.js test/serviceOrders.test.js test/auditLog.test.js
git commit -m "feat(service-orders): versioned quote settings and audit action types"
```

---

### Task 10: Finance `source` / `depositsOnly` and bookings `serviceOrders`

**Files:**
- Modify: `functions/api/finance/transactions/index.js`, `functions/api/bookings/index.js`
- Test: `test/financeTransactions.test.js`, `test/bookingsEndpoints.test.js` (append)

**Interfaces:**
- Consumes: PR A's page-row loop in `onRequestGet` (the block starting `// Computed only for the returned page`).
- Produces: each finance row gains `source: { kind, refId } | null` where `kind ∈ 'service_order_deposit' | 'service_order_settle' | 'service_order_refund' | 'booking_deposit'`; query `depositsOnly=1` returns only deposit rows (order or booking). Each booking in `GET /api/bookings` gains `serviceOrders: [{ id, status }]` (non-cancelled).

- [ ] **Step 1: Write the failing tests**

Append to `test/financeTransactions.test.js`:

```js
describe('finance list source and depositsOnly (PR B)', () => {
  it('labels order deposits, settlements, refunds and booking deposits; filters deposits', async () => {
    await env.DB.exec('DELETE FROM booking_deposits');
    const order = (await env.DB.prepare(`INSERT INTO service_orders (creation_key, order_type, customer_name, phone, event_date, primary_category, quote_valid_days, created_by, created_at)
      VALUES ('k-src', 'dat_tiec', 'A', '0900000000', '2026-12-01', 'bep_hien_le', 7, 'x', '2026-10-15T00:00:00Z')`).run()).meta.last_row_id;
    const tx = async (type, amount, soId) => (await env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, service_order_id)
      VALUES (?, 'bep_hien_le', ?, 'n', '2026-10-15', 'confirmed', 'x', '2026-10-15T00:00:00Z', ?)`).bind(type, amount, soId).run()).meta.last_row_id;
    const dep = await tx('income', 100, order);
    await env.DB.prepare(`INSERT INTO service_order_deposits (order_id, amount, payment_method, finance_transaction_id, created_by, created_at) VALUES (?, 100, 'cash', ?, 'x', '2026-10-15')`).bind(order, dep).run();
    const settle = await tx('income', 200, order);
    const refund = await tx('expense', 50, order);
    const bookingDep = await tx('income', 300, null);
    const booking = (await env.DB.prepare(`INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('B', '0', 'circle', '2099-01-01', '2099-01-02', 'confirmed', 'phone', '2026-10-01')`).run()).meta.last_row_id;
    await env.DB.prepare(`INSERT INTO booking_deposits (booking_id, amount, payment_method, finance_transaction_id, created_by, created_at) VALUES (?, 300, 'cash', ?, 'x', '2026-10-15')`).bind(booking, bookingDep).run();
    const list = async (q = '') => (await (await listTransactions({ request: authedRequest(`https://x/api/finance/transactions${q}`, adminToken, 'GET'), env })).json()).transactions;
    const byId = Object.fromEntries((await list()).map((t) => [t.id, t.source]));
    expect(byId[dep]).toEqual({ kind: 'service_order_deposit', refId: order });
    expect(byId[settle]).toEqual({ kind: 'service_order_settle', refId: order });
    expect(byId[refund]).toEqual({ kind: 'service_order_refund', refId: order });
    expect(byId[bookingDep]).toEqual({ kind: 'booking_deposit', refId: booking });
    expect((await list('?depositsOnly=1')).map((t) => t.id).sort()).toEqual([dep, bookingDep].sort());
  });
});
```

In the top-level `beforeEach` of `test/bookingsEndpoints.test.js`, directly before `await env.DB.exec('DELETE FROM bookings');` add `await env.DB.exec('DELETE FROM service_orders');` (foreign key `service_orders.booking_id`). Then append:

```js
describe('GET /api/bookings — serviceOrders (PR B)', () => {
  it('lists non-cancelled linked service orders per booking', async () => {
    const booking = (await env.DB.prepare(`INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
      VALUES ('Gắn đơn', '090', 'circle', '2026-12-01', '2026-12-02', 'confirmed', 'phone', '2026-10-01T00:00:00Z')`).run()).meta.last_row_id;
    const add = (key, status) => env.DB.prepare(`INSERT INTO service_orders (creation_key, order_type, customer_name, phone, event_date, booking_id, primary_category, quote_valid_days, status, created_by, created_at)
      VALUES (?, 'dat_tiec', 'A', '0900000000', '2026-12-01', ?, 'bep_hien_le', 7, ?, 'x', '2026-10-15T00:00:00Z')`).bind(key, booking, status).run();
    const open = (await add('k-b1', 'confirmed')).meta.last_row_id;
    await add('k-b2', 'cancelled');
    const rows = await (await listBookings({ request: authedRequest('https://x/api/bookings?status=confirmed', adminToken, 'GET'), env })).json();
    expect(rows.find((b) => b.id === booking).serviceOrders).toEqual([{ id: open, status: 'confirmed' }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node node_modules/vitest/vitest.mjs run test/financeTransactions.test.js test/bookingsEndpoints.test.js -t "PR B"`
Expected: FAIL.

- [ ] **Step 3: Implement finance changes**

In `functions/api/finance/transactions/index.js`:

1. After the line `if (q) { clauses.push('note LIKE ? COLLATE NOCASE'); params.push(`%${q}%`); }` add:

```js
  if (url.searchParams.get('depositsOnly') === '1') {
    clauses.push(`(EXISTS (SELECT 1 FROM service_order_deposits d WHERE d.finance_transaction_id = finance_transactions.id)
      OR EXISTS (SELECT 1 FROM booking_deposits bd WHERE bd.finance_transaction_id = finance_transactions.id))`);
  }
```

2. Replace the PR A page block (`SELECT id, ((${blockedFinanceLinks}) OR (${cancelledDepositLink})) AS linked …` and the `forEach`) with:

```js
  if (pageRows.length > 0) {
    const ids = pageRows.map((r) => r.id);
    const { results: linkRows } = await env.DB.prepare(
      `SELECT id, ((${blockedFinanceLinks}) OR (${cancelledDepositLink})) AS linked,
         CASE
           WHEN EXISTS (SELECT 1 FROM service_order_deposits d WHERE d.finance_transaction_id = finance_transactions.id) THEN 'service_order_deposit'
           WHEN service_order_id IS NOT NULL AND type = 'expense' THEN 'service_order_refund'
           WHEN service_order_id IS NOT NULL THEN 'service_order_settle'
           WHEN EXISTS (SELECT 1 FROM booking_deposits bd WHERE bd.finance_transaction_id = finance_transactions.id) THEN 'booking_deposit'
         END AS source_kind,
         COALESCE(service_order_id, (SELECT booking_id FROM booking_deposits bd WHERE bd.finance_transaction_id = finance_transactions.id LIMIT 1)) AS source_ref
       FROM finance_transactions WHERE id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    const byId = new Map(linkRows.map((r) => [r.id, r]));
    pageRows.forEach((r) => {
      const info = byId.get(r.id);
      r.linked = !!(info && info.linked);
      r.source = info && info.source_kind ? { kind: info.source_kind, refId: info.source_ref } : null;
    });
  }
```

3. In `coerceRow(r)` add `source: r.source ?? null,` after `linked: !!r.linked,`.

- [ ] **Step 4: Implement bookings change**

In `functions/api/bookings/index.js`, directly after the deposits block (after `results.forEach((r) => { r.deposits = depositsByBooking[r.id] || []; });` and its closing `}`), add:

```js
  results.forEach((r) => { r.serviceOrders = []; });
  if (results.length > 0) {
    const { results: orderRows } = await env.DB.prepare(
      `SELECT id, booking_id AS bookingId, status FROM service_orders
       WHERE booking_id IN (SELECT id FROM bookings ${where}) AND status <> 'cancelled' ORDER BY id`
    ).bind(...params).all();
    const ordersByBooking = {};
    orderRows.forEach((o) => { (ordersByBooking[o.bookingId] ||= []).push({ id: o.id, status: o.status }); });
    results.forEach((r) => { r.serviceOrders = ordersByBooking[r.id] || []; });
  }
```

- [ ] **Step 5: Run to verify pass**

Run: `node node_modules/vitest/vitest.mjs run test/financeTransactions.test.js test/bookingsEndpoints.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/api/finance/transactions/index.js functions/api/bookings/index.js test/financeTransactions.test.js test/bookingsEndpoints.test.js
git commit -m "feat(finance): show the source of linked rows and a deposits-only filter"
```

---

### Task 11: Orders admin page, menu, clean URLs

**Files:**
- Create: `admin/service-orders.html`, `admin/service-orders.js`
- Modify: `admin/nav-drawer.js`, `_redirects`, `scripts/dist-policy.mjs`
- Test: `scripts/check-admin-refresh.mjs` (new block)

**Interfaces:**
- Consumes: APIs from Tasks 4–8, `GET /api/bookings?status=confirmed|checked_in` (optional, when the user has `bookings.view`), `admin/tabs.js` (`data-tabs`, `HLGTabs.refresh`).
- Produces: page `service-orders.html` (slug `service-orders`), nav item in group "Vận hành", DOM ids used by the check script: `openNewOrderBtn`, `openOrdersList`, `historyOrdersList`, `orderForm`, `itemsBody`, `addItemBtn`, `itemsTotals`, `depositWarning`, `orderFormError`, `orderDetail`, `settleOverlay`, `settlePreview`, `cancelOverlay`, `refundAmount`.

- [ ] **Step 1: Create `admin/service-orders.html`**

```html
<!-- v4/admin/service-orders.html -->
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Đơn dịch vụ — Hiền Lê Garden CRM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/admin/admin.css" />
</head>
<body>
  <div class="page page-wide">
    <div class="page-head"><h1>Đơn dịch vụ</h1><button type="button" id="openNewOrderBtn" hidden>+ Đơn mới</button></div>
    <p id="pageError" class="error" role="alert"></p>
    <div class="tabs" data-tabs role="tablist" aria-label="Đơn dịch vụ">
      <button type="button" class="tab" role="tab" id="tab-sap-dien-ra" data-tab="sap-dien-ra" aria-controls="panel-sap-dien-ra">Sắp diễn ra</button>
      <button type="button" class="tab" role="tab" id="tab-lich-su" data-tab="lich-su" aria-controls="panel-lich-su">Lịch sử</button>
    </div>
    <section id="panel-sap-dien-ra" role="tabpanel" aria-labelledby="tab-sap-dien-ra">
      <label>Loại đơn <select id="filterType"><option value="">Tất cả</option></select></label>
      <div id="openOrdersList" class="booking-list"></div>
    </section>
    <section id="panel-lich-su" role="tabpanel" aria-labelledby="tab-lich-su" hidden>
      <label>Tìm tên / đơn vị / SĐT <input type="search" id="historySearch" maxlength="100" /></label>
      <label class="checkbox-label" id="showHiddenWrap" hidden><input type="checkbox" id="showHiddenOrders" /> Hiện đơn đã ẩn</label>
      <div id="historyOrdersList" class="booking-list"></div>
    </section>
  </div>

  <div id="orderFormOverlay" class="confirm-overlay form-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="orderFormTitle">
    <div class="confirm-box wide">
      <div class="page-head"><h2 id="orderFormTitle">Đơn mới</h2><button type="button" id="closeOrderFormBtn" class="btn-ghost" aria-label="Đóng">✕</button></div>
      <form id="orderForm">
        <div class="form-row">
          <label>Loại đơn <select name="orderType" required></select></label>
          <label>Ngày diễn ra <input type="date" name="eventDate" required /></label>
          <label>Giờ <input type="time" name="eventTime" /></label>
          <label>Số khách <input type="number" name="guestCount" min="1" step="1" /></label>
        </div>
        <div class="form-row">
          <label>Tên khách <input name="customerName" required maxlength="200" /></label>
          <label>Số điện thoại <input name="phone" required maxlength="30" /></label>
          <label>Đơn vị <input name="organization" maxlength="200" /></label>
        </div>
        <label>Khu vực / yêu cầu <input name="venueNote" maxlength="2000" /></label>
        <div class="form-row">
          <label>Gắn booking (tuỳ chọn) <select name="bookingId"><option value="">Không gắn</option></select></label>
          <label>Mảng chính (nhận cọc) <select name="primaryCategory" required></select></label>
        </div>
        <h3>Các dòng</h3>
        <div class="table-scroll">
          <table id="itemsTable"><thead><tr><th>Mô tả</th><th>SL</th><th>Đơn giá</th><th>Mảng</th><th>Thành tiền</th><th></th></tr></thead><tbody id="itemsBody"></tbody></table>
        </div>
        <button type="button" id="addItemBtn" class="btn-secondary">+ Thêm dòng</button>
        <div id="itemsTotals"></div>
        <p id="depositWarning" class="error" hidden></p>
        <div class="form-row">
          <label>Cọc đề nghị (đ) <input type="number" name="requestedDeposit" min="0" step="1000" /></label>
          <label>Hiệu lực báo giá (ngày) <input type="number" name="quoteValidDays" min="1" max="365" step="1" required /></label>
        </div>
        <label>Ghi chú <textarea name="note" maxlength="2000"></textarea></label>
        <button type="submit">Lưu đơn</button>
        <p id="orderFormError" class="error" role="alert"></p>
      </form>
    </div>
  </div>

  <div id="orderDetailOverlay" class="confirm-overlay form-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="orderDetailTitle">
    <div class="confirm-box wide">
      <div class="page-head"><h2 id="orderDetailTitle">Chi tiết đơn</h2><button type="button" id="closeOrderDetailBtn" class="btn-ghost" aria-label="Đóng">✕</button></div>
      <div id="orderDetail"></div>
      <p id="orderDetailError" class="error" role="alert"></p>
    </div>
  </div>

  <div id="settleOverlay" class="confirm-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="settleTitle">
    <div class="confirm-box">
      <h2 id="settleTitle">Tất toán đơn</h2>
      <div id="settlePreview"></div>
      <div id="settleMethodFields">
        <label class="checkbox-label"><input type="radio" name="settleMethod" value="cash" /> 💵 Tiền mặt</label>
        <label class="checkbox-label"><input type="radio" name="settleMethod" value="transfer" /> 🏦 Chuyển khoản</label>
      </div>
      <button type="button" id="settleSubmitBtn">Xác nhận tất toán</button>
      <button type="button" id="settleCloseBtn" class="btn-secondary">Đóng</button>
      <p id="settleError" class="error" role="alert"></p>
    </div>
  </div>

  <div id="cancelOverlay" class="confirm-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="cancelTitle">
    <div class="confirm-box">
      <h2 id="cancelTitle">Huỷ đơn</h2>
      <label class="checkbox-label"><input type="radio" name="cancelOrigin" value="guest" checked /> Khách huỷ</label>
      <label class="checkbox-label"><input type="radio" name="cancelOrigin" value="hotel" /> Khách sạn huỷ</label>
      <label>Lý do (bắt buộc) <textarea id="cancelReason" maxlength="1000" required></textarea></label>
      <div id="refundFields" hidden>
        <p id="refundHint"></p>
        <label>Số tiền hoàn (đ) <input type="number" id="refundAmount" min="0" step="1000" /></label>
        <label class="checkbox-label"><input type="radio" name="refundMethod" value="cash" /> 💵 Tiền mặt</label>
        <label class="checkbox-label"><input type="radio" name="refundMethod" value="transfer" /> 🏦 Chuyển khoản</label>
      </div>
      <button type="button" id="cancelSubmitBtn">Xác nhận huỷ</button>
      <button type="button" id="cancelCloseBtn" class="btn-secondary">Đóng</button>
      <p id="cancelError" class="error" role="alert"></p>
    </div>
  </div>

  <script src="/admin/tabs.js"></script>
  <script src="/admin/service-orders.js"></script>
  <script src="/admin/nav-drawer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `admin/service-orders.js`**

```js
// v4/admin/service-orders.js — staff UI for service orders (spec 2026-10-15).
const TYPE_LABELS = { an_uong_theo_yeu_cau: 'Ăn uống theo yêu cầu', su_kien: 'Tổ chức sự kiện', dat_tiec: 'Đặt tiệc', khac: 'Khác' };
const STATUS_LABELS = { draft: 'Nháp', confirmed: 'Đã chốt', settled: 'Đã tất toán', cancelled: 'Đã huỷ' };
let currentPermissions = [];
let categories = [];
let editingOrder = null;
let currentOrder = null;
const can = (key) => currentPermissions.includes(key);
const formatVnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const categoryLabel = (slug) => (categories.find((c) => c.slug === slug) || { label: slug }).label;
const el = (tag, props = {}, ...children) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...children); return n; };

function openOverlay(id) { const o = document.getElementById(id); o.classList.remove('hidden'); (o.querySelector('input, select, textarea, button') || o).focus(); }
function closeOverlay(id) { document.getElementById(id).classList.add('hidden'); }
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  ['settleOverlay', 'cancelOverlay', 'orderDetailOverlay', 'orderFormOverlay'].some((id) => {
    const o = document.getElementById(id);
    if (o.classList.contains('hidden')) return false;
    closeOverlay(id); return true;
  });
});

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Có lỗi xảy ra');
  return body;
}

(async () => {
  const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!me) { window.location.href = '/admin'; return; }
  currentPermissions = me.permissions || [];
  document.getElementById('openNewOrderBtn').hidden = !can('service_orders.manage');
  document.getElementById('showHiddenWrap').hidden = !can('records.hide');
  categories = await api('/api/service-orders/categories').catch(() => []);
  const typeSelect = document.getElementById('filterType');
  const formType = document.querySelector('#orderForm [name="orderType"]');
  Object.entries(TYPE_LABELS).forEach(([value, label]) => {
    typeSelect.append(el('option', { value, textContent: label }));
    formType.append(el('option', { value, textContent: label }));
  });
  window.HLGTabs.refresh(undefined, { normalizeHash: true });
  await Promise.all([loadOpen(), loadHistory()]);
})();

function orderCard(o) {
  const card = el('div', { className: 'booking-card' });
  card.append(
    el('strong', { textContent: `${o.quoteNumber} · ${TYPE_LABELS[o.orderType]}` }),
    el('p', { textContent: `${o.eventDate}${o.eventTime ? ` ${o.eventTime}` : ''} · ${o.customerName}${o.organization ? ` (${o.organization})` : ''}${o.guestCount ? ` · ${o.guestCount} khách` : ''}` }),
    el('p', { textContent: `Tổng ${formatVnd(o.total)} · Đã cọc ${formatVnd(o.depositAmount)} · Còn lại ${formatVnd(o.total - o.depositAmount)}${o.bookingId ? ` · Booking #${o.bookingId}` : ''}` }),
    el('span', { className: 'status-badge', textContent: STATUS_LABELS[o.status] }),
  );
  const open = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Xem chi tiết' });
  open.addEventListener('click', () => showDetail(o.id));
  card.append(open);
  return card;
}

function renderList(containerId, rows, emptyText) {
  const box = document.getElementById(containerId);
  box.replaceChildren(...(rows.length ? rows.map(orderCard) : [el('p', { textContent: emptyText })]));
}

async function loadOpen() {
  const type = document.getElementById('filterType').value;
  try {
    const rows = await api(`/api/service-orders?status=open${type ? `&type=${encodeURIComponent(type)}` : ''}`);
    renderList('openOrdersList', rows, 'Chưa có đơn sắp diễn ra.');
  } catch (e) { document.getElementById('pageError').textContent = e.message; }
}
async function loadHistory() {
  const q = document.getElementById('historySearch').value.trim();
  const hidden = can('records.hide') && document.getElementById('showHiddenOrders').checked;
  try {
    const rows = await api(`/api/service-orders?status=history${q ? `&q=${encodeURIComponent(q)}` : ''}${hidden ? '&includeHidden=1' : ''}`);
    renderList('historyOrdersList', rows, 'Chưa có đơn đã tất toán hoặc đã huỷ.');
  } catch (e) { document.getElementById('pageError').textContent = e.message; }
}
document.getElementById('filterType').addEventListener('change', loadOpen);
document.getElementById('historySearch').addEventListener('input', () => { clearTimeout(loadHistory.t); loadHistory.t = setTimeout(loadHistory, 300); });
document.getElementById('showHiddenOrders').addEventListener('change', loadHistory);

// ---- Form ----
function categoryOptions(select, selected, allowInactive) {
  select.replaceChildren(...categories.filter((c) => c.isActive || c.slug === allowInactive)
    .map((c) => el('option', { value: c.slug, textContent: c.label, selected: c.slug === selected })));
}
function itemRow(item = { description: '', quantity: 1, unitPrice: 0, financeCategory: document.querySelector('#orderForm [name="primaryCategory"]').value }) {
  const tr = el('tr');
  tr.dataset.id = item.id ?? '';
  const desc = el('input', { value: item.description, maxLength: 500, required: true, ariaLabel: 'Mô tả' });
  const qty = el('input', { type: 'number', min: 1, step: 1, value: item.quantity, required: true, ariaLabel: 'Số lượng' });
  const price = el('input', { type: 'number', min: 0, step: 1000, value: item.unitPrice, required: true, ariaLabel: 'Đơn giá' });
  const cat = el('select', { ariaLabel: 'Mảng' });
  categoryOptions(cat, item.financeCategory, item.id ? item.financeCategory : null);
  const amount = el('td');
  const remove = el('button', { type: 'button', className: 'btn-ghost', textContent: '✕', ariaLabel: 'Xoá dòng' });
  remove.addEventListener('click', () => { tr.remove(); refreshTotals(); });
  [desc, qty, price, cat].forEach((input) => input.addEventListener('input', refreshTotals));
  tr.append(el('td', {}, desc), el('td', {}, qty), el('td', {}, price), el('td', {}, cat), amount, el('td', {}, remove));
  return tr;
}
function readItems() {
  return [...document.querySelectorAll('#itemsBody tr')].map((tr) => {
    const [desc, qty, price] = tr.querySelectorAll('input');
    return { id: tr.dataset.id ? Number(tr.dataset.id) : null, description: desc.value, quantity: Number(qty.value), unitPrice: Number(price.value), financeCategory: tr.querySelector('select').value };
  });
}
function refreshTotals() {
  const items = readItems();
  const totals = {};
  document.querySelectorAll('#itemsBody tr').forEach((tr, i) => {
    const it = items[i];
    tr.lastElementChild.previousElementSibling.textContent = formatVnd(it.quantity * it.unitPrice);
    totals[it.financeCategory] = (totals[it.financeCategory] || 0) + it.quantity * it.unitPrice;
  });
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  document.getElementById('itemsTotals').replaceChildren(
    ...Object.entries(totals).map(([slug, v]) => el('p', { textContent: `${categoryLabel(slug)}: ${formatVnd(v)}` })),
    el('p', {}, el('strong', { textContent: `Tổng đơn: ${formatVnd(total)}` })),
  );
  const primary = document.querySelector('#orderForm [name="primaryCategory"]').value;
  const deposit = editingOrder ? editingOrder.depositAmount : 0;
  const warn = document.getElementById('depositWarning');
  warn.hidden = deposit <= (totals[primary] || 0);
  warn.textContent = `Đã cọc ${formatVnd(deposit)} vượt giá trị mảng chính (${formatVnd(totals[primary] || 0)}).`;
}
document.getElementById('addItemBtn').addEventListener('click', () => { document.getElementById('itemsBody').append(itemRow()); refreshTotals(); });
document.querySelector('#orderForm [name="primaryCategory"]').addEventListener('change', refreshTotals);

async function loadBookingOptions(selected) {
  const select = document.querySelector('#orderForm [name="bookingId"]');
  select.replaceChildren(el('option', { value: '', textContent: 'Không gắn' }));
  if (!can('bookings.view')) return;
  const lists = await Promise.all(['confirmed', 'checked_in'].map((s) => api(`/api/bookings?status=${s}`).catch(() => [])));
  lists.flat().forEach((b) => select.append(el('option', { value: b.id, textContent: `#${b.id} · ${b.guestName} · ${b.checkIn}→${b.checkOut}`, selected: b.id === selected })));
  if (selected && ![...select.options].some((o) => Number(o.value) === selected)) select.append(el('option', { value: selected, textContent: `#${selected}`, selected: true }));
}

async function openForm(order = null) {
  editingOrder = order;
  const form = document.getElementById('orderForm');
  form.reset();
  document.getElementById('orderFormError').textContent = '';
  document.getElementById('orderFormTitle').textContent = order ? `Sửa đơn ${order.quoteNumber}` : 'Đơn mới';
  categoryOptions(form.primaryCategory, order ? order.primaryCategory : (categories.find((c) => c.isActive) || {}).slug, order ? order.primaryCategory : null);
  await loadBookingOptions(order ? order.bookingId : null);
  const fields = order || { orderType: 'dat_tiec', quoteValidDays: '', requestedDeposit: '' };
  ['orderType', 'eventDate', 'eventTime', 'guestCount', 'customerName', 'phone', 'organization', 'venueNote', 'requestedDeposit', 'quoteValidDays', 'note']
    .forEach((name) => { form[name].value = fields[name] ?? ''; });
  if (!order) {
    const settings = await api('/api/quote-settings').catch(() => ({ defaultValidDays: 7 }));
    form.quoteValidDays.value = settings.defaultValidDays;
  }
  form.phone.required = !order || order.phone !== null;
  const body = document.getElementById('itemsBody');
  body.replaceChildren(...(order ? order.items.map(itemRow) : [itemRow()]));
  refreshTotals();
  openOverlay('orderFormOverlay');
}
document.getElementById('openNewOrderBtn').addEventListener('click', () => openForm());
document.getElementById('closeOrderFormBtn').addEventListener('click', () => closeOverlay('orderFormOverlay'));

let saving = false;
document.getElementById('orderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  const form = event.target;
  const num = (v) => (v === '' ? null : Number(v));
  const payload = {
    orderType: form.orderType.value, eventDate: form.eventDate.value, eventTime: form.eventTime.value || null, guestCount: num(form.guestCount.value),
    customerName: form.customerName.value, phone: form.phone.value || null, organization: form.organization.value, venueNote: form.venueNote.value,
    bookingId: num(form.bookingId.value), primaryCategory: form.primaryCategory.value, note: form.note.value,
    quoteValidDays: Number(form.quoteValidDays.value), items: readItems(),
  };
  if (form.requestedDeposit.value !== '') payload.requestedDeposit = Number(form.requestedDeposit.value);
  else if (editingOrder) payload.requestedDeposit = editingOrder.requestedDeposit;
  saving = true;
  form.querySelector('button[type="submit"]').disabled = true;
  try {
    const url = editingOrder ? `/api/service-orders/${editingOrder.id}` : '/api/service-orders';
    const result = await api(url, { method: editingOrder ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    closeOverlay('orderFormOverlay');
    await Promise.all([loadOpen(), loadHistory()]);
    await showDetail(editingOrder ? editingOrder.id : result.id);
  } catch (e) {
    document.getElementById('orderFormError').textContent = e.message;
  } finally {
    saving = false;
    form.querySelector('button[type="submit"]').disabled = false;
  }
});

// ---- Detail ----
async function showDetail(id) {
  document.getElementById('orderDetailError').textContent = '';
  try { currentOrder = await api(`/api/service-orders/${id}`); } catch (e) { document.getElementById('pageError').textContent = e.message; return; }
  const o = currentOrder;
  const open = o.status === 'draft' || o.status === 'confirmed';
  const box = document.getElementById('orderDetail');
  const rows = o.items.map((i) => el('tr', {}, el('td', { textContent: i.description }), el('td', { textContent: i.quantity }),
    el('td', { textContent: formatVnd(i.unitPrice) }), el('td', { textContent: categoryLabel(i.financeCategory) }), el('td', { textContent: formatVnd(i.quantity * i.unitPrice) })));
  const deposits = o.deposits.filter((d) => !d.voidedAt).map((d) => {
    const line = el('p', { textContent: `${formatVnd(d.amount)} · ${d.paymentMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'} · ${d.createdAt.slice(0, 10)}${d.note ? ` · ${d.note}` : ''}` });
    if (open && can('service_orders.refund')) {
      const del = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Xoá cọc' });
      del.addEventListener('click', () => deleteDeposit(d.id, del));
      line.append(' ', del);
    }
    return line;
  });
  box.replaceChildren(
    el('p', { textContent: `${o.quoteNumber} · ${TYPE_LABELS[o.orderType]} · ${STATUS_LABELS[o.status]}` }),
    el('p', { textContent: `${o.eventDate}${o.eventTime ? ` ${o.eventTime}` : ''} · ${o.customerName}${o.phone ? ` · ${o.phone}` : ''}${o.organization ? ` · ${o.organization}` : ''}` }),
    el('p', { textContent: `Mảng chính: ${categoryLabel(o.primaryCategory)}${o.bookingId ? ` · Booking #${o.bookingId}` : ''}` }),
    el('div', { className: 'table-scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Mô tả', 'SL', 'Đơn giá', 'Mảng', 'Thành tiền'].map((h) => el('th', { textContent: h })))), el('tbody', {}, ...rows))),
    el('p', {}, el('strong', { textContent: `Tổng ${formatVnd(o.total)} · Đã cọc ${formatVnd(o.depositAmount)} · Còn lại ${formatVnd(o.total - o.depositAmount)}` })),
    el('h3', { textContent: 'Tiền cọc' }), ...(deposits.length ? deposits : [el('p', { textContent: 'Chưa có cọc.' })]),
  );
  if (o.status === 'cancelled') box.append(el('p', { textContent: `Huỷ bởi ${o.cancellationOrigin === 'hotel' ? 'khách sạn' : 'khách'} · Lý do: ${o.cancelReason} · Hoàn ${formatVnd(o.refundAmount)}` }));
  const actions = el('div', { className: 'form-row' });
  if (open && can('service_orders.manage')) {
    const depositForm = el('form', { className: 'add-deposit-form' });
    const amount = el('input', { type: 'number', min: 1000, step: 1000, placeholder: 'Số tiền cọc', required: true, ariaLabel: 'Số tiền cọc' });
    const method = el('select', { ariaLabel: 'Hình thức' }, el('option', { value: 'cash', textContent: 'Tiền mặt' }), el('option', { value: 'transfer', textContent: 'Chuyển khoản' }));
    const note = el('input', { maxLength: 500, placeholder: 'Ghi chú', ariaLabel: 'Ghi chú cọc' });
    const save = el('button', { type: 'submit', textContent: 'Nhận cọc' });
    depositForm.append(amount, method, note, save);
    depositForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try { await api(`/api/service-orders/${o.id}/deposits`, { method: 'POST', body: JSON.stringify({ amount: Number(amount.value), paymentMethod: method.value, note: note.value || null }) }); await afterAction(); }
      catch (err) { document.getElementById('orderDetailError').textContent = err.message; save.disabled = false; }
    });
    box.append(depositForm);
    const edit = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Sửa đơn' });
    edit.addEventListener('click', () => { closeOverlay('orderDetailOverlay'); openForm(o); });
    actions.append(edit);
    if (o.status === 'draft') actions.append(actionButton('Chốt đơn', () => api(`/api/service-orders/${o.id}/confirm`, { method: 'POST' })));
    if (o.status === 'confirmed') { const s = el('button', { type: 'button', textContent: 'Tất toán' }); s.addEventListener('click', openSettle); actions.append(s); }
    if (o.depositAmount === 0 || can('service_orders.refund')) { const c = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Huỷ đơn' }); c.addEventListener('click', openCancel); actions.append(c); }
  }
  if (o.status !== 'cancelled') {
    const print = el('a', { className: 'btn-secondary', href: `/admin/service-order-quote.html?orderId=${o.id}`, target: '_blank', rel: 'noopener', textContent: 'In báo giá' });
    actions.append(print);
  }
  if (!open && can('records.hide')) actions.append(actionButton(o.isHidden ? 'Hiện lại' : 'Ẩn khỏi lịch sử', () => api(`/api/service-orders/${o.id}/hide`, { method: 'PATCH', body: JSON.stringify({ hidden: !o.isHidden }) })));
  box.append(actions);
  openOverlay('orderDetailOverlay');
}
function actionButton(label, run) {
  const b = el('button', { type: 'button', className: 'btn-secondary', textContent: label });
  b.addEventListener('click', async () => { b.disabled = true; try { await run(); await afterAction(); } catch (e) { document.getElementById('orderDetailError').textContent = e.message; b.disabled = false; } });
  return b;
}
async function afterAction() { await Promise.all([loadOpen(), loadHistory()]); await showDetail(currentOrder.id); }
async function deleteDeposit(depositId, button) {
  button.disabled = true;
  try { await api(`/api/service-orders/${currentOrder.id}/deposits/${depositId}`, { method: 'DELETE' }); await afterAction(); }
  catch (e) { document.getElementById('orderDetailError').textContent = e.message; button.disabled = false; }
}
document.getElementById('closeOrderDetailBtn').addEventListener('click', () => closeOverlay('orderDetailOverlay'));

// ---- Settle ----
function settlementPreview(o) {
  const totals = {};
  o.items.forEach((i) => { totals[i.financeCategory] = (totals[i.financeCategory] || 0) + i.quantity * i.unitPrice; });
  return Object.entries(totals).map(([c, v]) => ({ category: c, amount: c === o.primaryCategory ? v - o.depositAmount : v })).filter((p) => p.amount > 0);
}
function openSettle() {
  const plan = settlementPreview(currentOrder);
  document.getElementById('settleError').textContent = '';
  document.getElementById('settlePreview').replaceChildren(
    ...(plan.length ? plan.map((p) => el('p', { textContent: `Thu · ${categoryLabel(p.category)}: ${formatVnd(p.amount)}` })) : [el('p', { textContent: 'Cọc đã đủ, không phát sinh khoản thu.' })]),
  );
  document.getElementById('settleMethodFields').hidden = plan.length === 0;
  document.querySelectorAll('[name="settleMethod"]').forEach((r) => { r.checked = false; });
  openOverlay('settleOverlay');
}
document.getElementById('settleSubmitBtn').addEventListener('click', async (e) => {
  const method = document.querySelector('[name="settleMethod"]:checked');
  e.target.disabled = true;
  try { await api(`/api/service-orders/${currentOrder.id}/settle`, { method: 'POST', body: JSON.stringify({ paymentMethod: method ? method.value : null }) }); closeOverlay('settleOverlay'); await afterAction(); }
  catch (err) { document.getElementById('settleError').textContent = err.message; }
  finally { e.target.disabled = false; }
});
document.getElementById('settleCloseBtn').addEventListener('click', () => closeOverlay('settleOverlay'));

// ---- Cancel ----
function openCancel() {
  const o = currentOrder;
  document.getElementById('cancelError').textContent = '';
  document.getElementById('cancelReason').value = '';
  const refund = document.getElementById('refundFields');
  refund.hidden = o.depositAmount === 0;
  document.getElementById('refundHint').textContent = `Đã cọc ${formatVnd(o.depositAmount)}. Nhập số tiền hoàn (0 nếu giữ toàn bộ cọc).`;
  const amount = document.getElementById('refundAmount');
  amount.value = 0;
  amount.max = o.depositAmount;
  document.querySelectorAll('[name="refundMethod"]').forEach((r) => { r.checked = false; });
  openOverlay('cancelOverlay');
}
document.getElementById('cancelSubmitBtn').addEventListener('click', async (e) => {
  const o = currentOrder;
  const body = { origin: document.querySelector('[name="cancelOrigin"]:checked').value, reason: document.getElementById('cancelReason').value };
  if (o.depositAmount > 0) {
    body.refundAmount = Number(document.getElementById('refundAmount').value || 0);
    const method = document.querySelector('[name="refundMethod"]:checked');
    if (method) body.refundPaymentMethod = method.value;
  }
  e.target.disabled = true;
  try { await api(`/api/service-orders/${o.id}/cancel`, { method: 'POST', body: JSON.stringify(body) }); closeOverlay('cancelOverlay'); await afterAction(); }
  catch (err) { document.getElementById('cancelError').textContent = err.message; }
  finally { e.target.disabled = false; }
});
document.getElementById('cancelCloseBtn').addEventListener('click', () => closeOverlay('cancelOverlay'));
```

- [ ] **Step 3: Menu, clean URLs, required assets**

In `admin/nav-drawer.js`:

1. In the original `'Vận hành'` items array add after the `gio-xanh.html` entry:

```js
      { page: 'service-orders.html', label: 'Đơn dịch vụ', icon: '🎉', perm: 'service_orders.view' },
```

and in the `'Cấu hình & Quản trị'` items array add after `rooms.html`:

```js
      { page: 'quote-settings.html', label: 'Mẫu phiếu báo giá', icon: '🧾', perm: ['settings.view', 'settings.quote_template'] },
```

2. In the regrouping list change `['Vận hành', ['reception','dine-in-orders','gio-xanh']]` to `['Vận hành', ['reception','dine-in-orders','gio-xanh','service-orders']]` and append `'quote-settings'` to the `'Cài đặt'` page list.

3. Add `'service-orders.html': 'service-orders', 'quote-settings.html': 'quote-settings'` to `PAGE_SLUG`, and `'service-order-quote.html': ['service_orders.view', 'settings.view']` to `PAGE_EXTRA_PERMS`.

In `_redirects` add (keep column alignment loose; one rule per line):

```
/manager/service-orders         /admin/service-orders   200
/manager/quote-settings         /admin/quote-settings   200
/reception/service-orders       /admin/service-orders   200
/reception/quote-settings       /admin/quote-settings   200
/observer/service-orders        /admin/service-orders   200
/observer/quote-settings        /admin/quote-settings   200
```

In `scripts/dist-policy.mjs` add to `REQUIRED` after `'admin/tabs.js'`:

```js
  'admin/service-orders.html',
  'admin/service-orders.js',
```

- [ ] **Step 4: Add the browser check**

In `scripts/check-admin-refresh.mjs`, before the PR A finance block, add:

```js
  // PR B: service orders page — list, new order form totals and deposit warning, detail actions per role.
  for (const role of ['manager', 'reception', 'observer']) {
    const context = await browser.newContext();
    const permissions = ROLE_DEFAULTS[role];
    await context.route('https://**/*', (r) => r.abort());
    const order = { id: 7, quoteNumber: 'BG-2026-0007', orderType: 'dat_tiec', customerName: 'Chị Lan', phone: role === 'observer' ? null : '0900000000', organization: 'Công ty A',
      eventDate: '2026-12-20', eventTime: '18:30', guestCount: 50, venueNote: 'Sân vườn', bookingId: null, primaryCategory: 'bep_hien_le', depositAmount: 3000000,
      status: 'confirmed', total: 11000000, isHidden: false, note: null, quoteValidDays: 7, requestedDeposit: 3300000, createdAt: '2026-10-15T00:00:00Z',
      items: [{ id: 1, description: 'Set menu', quantity: 5, unitPrice: 2000000, financeCategory: 'bep_hien_le' }, { id: 2, description: 'Nước', quantity: 1, unitPrice: 1000000, financeCategory: 'hien_le_drinks' }],
      deposits: [{ id: 1, amount: 3000000, paymentMethod: 'transfer', note: null, createdAt: '2026-10-15T00:00:00Z', voidedAt: null }], categoryTotals: {} };
    await context.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { role, username: 'Kiểm tra đơn', permissions } });
      if (path === '/api/service-orders/categories') return route.fulfill({ json: [{ slug: 'bep_hien_le', label: 'Bếp Hiền Lê', isActive: true }, { slug: 'hien_le_drinks', label: 'Hiền Lê Drinks', isActive: true }] });
      if (path === '/api/service-orders') return route.fulfill({ json: new URL(route.request().url()).searchParams.get('status') === 'open' ? [order] : [] });
      if (path === '/api/service-orders/7') return route.fulfill({ json: order });
      if (path === '/api/quote-settings') return route.fulfill({ json: { defaultValidDays: 7, defaultDepositPercent: 30 } });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/admin/service-orders.html`);
      await page.waitForSelector('#openOrdersList .booking-card');
      assert.equal(await page.locator('#openNewOrderBtn').isVisible(), role !== 'observer');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `service-orders ${role}/${width}: overflow`);
      await page.locator('#openOrdersList .booking-card button').first().click();
      await page.waitForSelector('#orderDetailOverlay:not(.hidden)');
      assert.equal(await page.getByRole('button', { name: 'Xoá cọc' }).count(), role === 'manager' ? 1 : 0);
      assert.equal(await page.getByRole('button', { name: 'Huỷ đơn' }).count(), role === 'manager' ? 1 : 0);
      assert.equal(await page.getByRole('button', { name: 'Tất toán' }).count(), role === 'observer' ? 0 : 1);
      await page.screenshot({ path: `test-results/admin-refresh/service-orders-${role}-${width}.png`, fullPage: true });
      await page.keyboard.press('Escape');
    }
    if (role !== 'observer') {
      await page.locator('#openNewOrderBtn').click();
      await page.locator('#itemsBody tr input').first().fill('Set menu');
      await page.locator('#itemsBody tr input').nth(1).fill('2');
      await page.locator('#itemsBody tr input').nth(2).fill('500000');
      assert.match(await page.locator('#itemsTotals').textContent(), /Tổng đơn: 1\.000\.000đ/);
    }
    assert.deepEqual(errors, [], `service-orders ${role}: browser errors`);
    await context.close();
  }
```

- [ ] **Step 5: Run build and browser check**

Run: `npm run build && npm run check:dist && node scripts/check-admin-refresh.mjs`
Expected: dist PASS (17 required assets), final `PASS:` line.

- [ ] **Step 6: Commit**

```bash
git add admin/service-orders.html admin/service-orders.js admin/nav-drawer.js _redirects scripts/dist-policy.mjs scripts/check-admin-refresh.mjs
git commit -m "feat(service-orders): admin page, menu entry and clean URLs"
```

---

### Task 12: Printable quote and quote settings pages

**Files:**
- Create: `admin/service-order-quote.html`, `admin/service-order-quote.js`, `admin/quote-settings.html`, `admin/quote-settings.js`
- Test: `scripts/check-admin-refresh.mjs` (block), plus the existing every-page shell loop picks up the new HTML files automatically.

**Interfaces:**
- Consumes: `GET /api/service-orders/:id`, `GET /api/quote-settings`, `PUT /api/quote-settings`.
- Produces: quote page `service-order-quote.html?orderId=<id>` and `?preview=1`; settings form ids `quoteSettingsForm`, `quoteSettingsError`, `quotePreviewBtn`.

- [ ] **Step 1: Create `admin/service-order-quote.html`**

```html
<!-- v4/admin/service-order-quote.html -->
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Phiếu báo giá — Hiền Lê Garden CRM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/admin/admin.css" />
  <style>
    @page { size: A4; margin: 14mm; }
    .quote { background: #fff; color: #111; padding: 32px; max-width: 780px; margin: 0 auto; font-family: 'Be Vietnam Pro', sans-serif; }
    .quote-head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #2f6b45; padding-bottom: 12px; }
    .quote-head h2 { margin: 0; color: #2f6b45; }
    .quote h1 { text-align: center; margin: 20px 0 4px; letter-spacing: 1px; }
    .quote .meta { text-align: center; margin: 0 0 16px; }
    .quote dl { display: grid; grid-template-columns: 150px 1fr; gap: 4px 12px; margin: 0 0 12px; }
    .quote dt { font-weight: 600; } .quote dd { margin: 0; }
    .quote table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; }
    .quote th, .quote td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; white-space: normal; }
    .quote td.num, .quote th.num { text-align: right; }
    .quote .total td { font-weight: 700; }
    .quote .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 32px; text-align: center; min-height: 120px; }
    @media print { .no-print { display: none !important; } .quote { padding: 0; } }
  </style>
</head>
<body>
  <div class="page page-wide no-print">
    <h1>In phiếu báo giá</h1>
    <p id="pageError" class="error" role="alert"></p>
    <button type="button" id="printBtn">🖨 In</button>
  </div>
  <div id="quote" class="quote"></div>
  <script src="/admin/service-order-quote.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `admin/service-order-quote.js`**

```js
// v4/admin/service-order-quote.js — printable quote (spec 2026-10-15 §4.4).
const TYPE_LABELS = { an_uong_theo_yeu_cau: 'Ăn uống theo yêu cầu', su_kien: 'Tổ chức sự kiện', dat_tiec: 'Đặt tiệc', khac: 'Khác' };
const el = (tag, props = {}, ...children) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...children); return n; };
const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const viDate = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

// Vietnamese amount in words, e.g. 1250000 → "Một triệu hai trăm năm mươi nghìn đồng".
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function readTriple(n, full) {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  const out = [];
  if (full || h) out.push(`${DIGITS[h]} trăm`);
  if (t > 1) out.push(`${DIGITS[t]} mươi`);
  else if (t === 1) out.push('mười');
  else if ((full || h) && u) out.push('lẻ');
  if (u) out.push(t > 1 && u === 1 ? 'mốt' : t >= 1 && u === 5 ? 'lăm' : DIGITS[u]);
  return out.join(' ');
}
function amountInWords(amount) {
  if (!amount) return 'Không đồng';
  const units = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ'];
  const groups = [];
  for (let n = amount; n > 0; n = Math.floor(n / 1000)) groups.push(n % 1000);
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (!groups[i]) continue;
    parts.push(readTriple(groups[i], i < groups.length - 1) + units[i]);
  }
  const text = `${parts.join(' ')} đồng`.replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sampleOrder() {
  const today = new Date().toISOString();
  return { id: 1, quoteNumber: `BG-${today.slice(0, 4)}-0001`, orderType: 'dat_tiec', customerName: 'Khách mẫu', phone: '0900 000 000', organization: 'Công ty mẫu',
    eventDate: today.slice(0, 10), eventTime: '18:00', guestCount: 40, venueNote: 'Sân vườn', quoteValidDays: 7, requestedDeposit: 3000000, depositAmount: 0,
    createdAt: today, status: 'draft', total: 10000000,
    items: [{ description: 'Set menu 8 món', quantity: 4, unitPrice: 2000000 }, { description: 'Đồ uống', quantity: 1, unitPrice: 2000000 }] };
}

function render(order, s) {
  const box = document.getElementById('quote');
  const issued = new Date(order.createdAt);
  const validUntil = new Date(issued.getTime() + order.quoteValidDays * 86400000).toISOString();
  const contact = [s.address, s.hotline && `Hotline/Zalo: ${s.hotline}`, s.email, s.website].filter(Boolean).join(' · ');
  const rows = order.items.map((i, index) => el('tr', {},
    el('td', { textContent: index + 1 }), el('td', { textContent: i.description }), el('td', { className: 'num', textContent: i.quantity }),
    el('td', { className: 'num', textContent: vnd(i.unitPrice) }), el('td', { className: 'num', textContent: vnd(i.quantity * i.unitPrice) })));
  const total = order.items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const info = (pairs) => el('dl', {}, ...pairs.filter(([, v]) => v).flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
  box.replaceChildren(
    el('div', { className: 'quote-head' }, el('div', {}, el('h2', { textContent: s.businessName }), el('p', { textContent: contact }))),
    el('h1', { textContent: 'PHIẾU BÁO GIÁ' }),
    el('p', { className: 'meta', textContent: `Số: ${order.quoteNumber} · Ngày lập: ${viDate(order.createdAt)} · Hiệu lực đến: ${viDate(validUntil)}` }),
    el('h3', { textContent: 'Khách hàng' }),
    info([['Khách hàng', order.customerName], ['Đơn vị', order.organization], ['Điện thoại', order.phone]]),
    el('h3', { textContent: 'Thông tin dịch vụ' }),
    info([['Loại dịch vụ', TYPE_LABELS[order.orderType]], ['Thời gian', `${viDate(order.eventDate)}${order.eventTime ? ` ${order.eventTime}` : ''}`],
      ['Số khách', order.guestCount ? String(order.guestCount) : ''], ['Khu vực / yêu cầu', order.venueNote]]),
    el('table', {}, el('thead', {}, el('tr', {}, ...['STT', 'Nội dung', 'SL', 'Đơn giá', 'Thành tiền'].map((h, i) => el('th', { className: i >= 2 ? 'num' : '', textContent: h })))),
      el('tbody', {}, ...rows, el('tr', { className: 'total' }, el('td', { colSpan: 4, textContent: 'Tổng cộng' }), el('td', { className: 'num', textContent: vnd(total) })))),
    el('p', { textContent: `Bằng chữ: ${amountInWords(total)}.` }),
    info([['Cọc đề nghị', vnd(order.requestedDeposit)], ['Đã cọc', order.depositAmount ? vnd(order.depositAmount) : ''], ['Còn lại', vnd(total - order.depositAmount)]]),
    ...[s.taxNote, s.cancellationTerms].filter(Boolean).map((t) => el('p', { textContent: t })),
    ...(s.bankAccount ? [el('p', { textContent: `Chuyển khoản: ${[s.bankName, s.bankAccount, s.bankHolder].filter(Boolean).join(' · ')}` })] : []),
    ...(s.footerNote ? [el('p', { textContent: s.footerNote })] : []),
    el('div', { className: 'signs' }, el('div', {}, el('strong', { textContent: `Đại diện ${s.businessName}` })), el('div', {}, el('strong', { textContent: 'Khách hàng xác nhận' }))),
  );
}

(async () => {
  const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!me) { window.location.href = '/admin'; return; }
  const params = new URLSearchParams(window.location.search);
  const error = document.getElementById('pageError');
  try {
    const settings = await fetch('/api/quote-settings').then((r) => (r.ok ? r.json() : Promise.reject(new Error('Không tải được mẫu phiếu'))));
    let order;
    if (params.get('preview') === '1') order = sampleOrder();
    else {
      const id = params.get('orderId');
      if (!id) throw new Error('Thiếu mã đơn');
      const response = await fetch(`/api/service-orders/${encodeURIComponent(id)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Không tải được đơn');
      if (body.status === 'cancelled') throw new Error('Đơn đã huỷ, không in báo giá');
      order = body;
    }
    render(order, settings);
  } catch (e) { error.textContent = e.message; }
})();
document.getElementById('printBtn').addEventListener('click', () => window.print());
```

- [ ] **Step 3: Create `admin/quote-settings.html`**

```html
<!-- v4/admin/quote-settings.html -->
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Mẫu phiếu báo giá — Hiền Lê Garden CRM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/admin/admin.css" />
</head>
<body>
  <div class="page page-wide">
    <div class="page-head"><h1>Mẫu phiếu báo giá</h1><a id="quotePreviewBtn" class="btn-secondary" href="/admin/service-order-quote.html?preview=1" target="_blank" rel="noopener">Xem trước phiếu</a></div>
    <p id="pageError" class="error" role="alert"></p>
    <p id="quoteUpdated" class="muted"></p>
    <form id="quoteSettingsForm">
      <h2>Thông tin cơ sở</h2>
      <label>Tên hiển thị <input name="businessName" required maxlength="200" /></label>
      <label>Địa chỉ <input name="address" required maxlength="300" /></label>
      <div class="form-row">
        <label>Hotline / Zalo <input name="hotline" required maxlength="50" /></label>
        <label>Email <input name="email" maxlength="200" /></label>
        <label>Website <input name="website" maxlength="200" /></label>
      </div>
      <h2>Mặc định cho đơn mới</h2>
      <div class="form-row">
        <label>Hiệu lực báo giá (ngày) <input type="number" name="defaultValidDays" min="1" max="365" step="1" required /></label>
        <label>Cọc đề nghị (% tổng đơn) <input type="number" name="defaultDepositPercent" min="0" max="100" step="1" required /></label>
      </div>
      <h2>Nội dung in trên phiếu</h2>
      <label>Dòng thuế <input name="taxNote" maxlength="500" /></label>
      <label>Điều khoản huỷ <textarea name="cancellationTerms" maxlength="1000"></textarea></label>
      <label>Ghi chú cuối phiếu <textarea name="footerNote" maxlength="1000"></textarea></label>
      <h2>Thông tin chuyển khoản (tuỳ chọn)</h2>
      <div class="form-row">
        <label>Ngân hàng <input name="bankName" maxlength="200" autocomplete="off" /></label>
        <label>Số tài khoản <input name="bankAccount" maxlength="50" autocomplete="off" /></label>
        <label>Chủ tài khoản <input name="bankHolder" maxlength="200" autocomplete="off" /></label>
      </div>
      <button type="submit" id="quoteSaveBtn">Lưu mẫu phiếu</button>
      <p id="quoteSettingsError" class="error" role="alert"></p>
    </form>
  </div>
  <script src="/admin/quote-settings.js"></script>
  <script src="/admin/nav-drawer.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `admin/quote-settings.js`**

```js
// v4/admin/quote-settings.js — edit the quote template (settings.quote_template).
const TEXT_FIELDS = ['businessName', 'address', 'hotline', 'email', 'website', 'taxNote', 'cancellationTerms', 'footerNote', 'bankName', 'bankAccount', 'bankHolder'];
const NUMBER_FIELDS = ['defaultValidDays', 'defaultDepositPercent'];
let currentPermissions = [];

async function loadSettings() {
  const response = await fetch('/api/quote-settings');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Không tải được mẫu phiếu');
  const form = document.getElementById('quoteSettingsForm');
  [...TEXT_FIELDS, ...NUMBER_FIELDS].forEach((name) => { form[name].value = body[name] ?? ''; });
  document.getElementById('quoteUpdated').textContent = body.updatedAt ? `Cập nhật lần cuối: ${new Date(body.updatedAt).toLocaleString('vi-VN')} · ${body.updatedBy}` : '';
}

(async () => {
  const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!me) { window.location.href = '/admin'; return; }
  currentPermissions = me.permissions || [];
  const canEdit = currentPermissions.includes('settings.quote_template');
  const form = document.getElementById('quoteSettingsForm');
  [...form.elements].forEach((e) => { e.disabled = !canEdit; });
  document.getElementById('quoteSaveBtn').hidden = !canEdit;
  try { await loadSettings(); } catch (e) { document.getElementById('pageError').textContent = e.message; }
})();

document.getElementById('quoteSettingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const error = document.getElementById('quoteSettingsError');
  error.textContent = '';
  const payload = {};
  TEXT_FIELDS.forEach((name) => { payload[name] = form[name].value; });
  NUMBER_FIELDS.forEach((name) => { payload[name] = Number(form[name].value); });
  const button = document.getElementById('quoteSaveBtn');
  button.disabled = true;
  try {
    const response = await fetch('/api/quote-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Không lưu được mẫu phiếu');
    await loadSettings();
    error.textContent = 'Đã lưu.';
  } catch (e) { error.textContent = e.message; } finally { button.disabled = false; }
});
```

- [ ] **Step 5: Add the browser check**

In `scripts/check-admin-refresh.mjs`, after the PR B service orders block, add:

```js
  // PR B: quote prints the order with amount in words; settings form is read-only without settings.quote_template.
  {
    const context = await browser.newContext();
    await context.route('https://**/*', (r) => r.abort());
    const settings = { businessName: 'Hiền Lê Garden', address: 'Tổ Dân Phố 6 Bờ Đập, Nam Gia Nghĩa, Lâm Đồng', hotline: '0968 987 311', email: 'hello@hienlegarden.vn', website: 'hienlegarden.vn',
      defaultValidDays: 7, defaultDepositPercent: 30, taxNote: 'Giá trên chưa bao gồm thuế VAT', cancellationTerms: 'Điều khoản huỷ', footerNote: null, bankName: null, bankAccount: null, bankHolder: null, updatedAt: null, updatedBy: null };
    const order = { id: 7, quoteNumber: 'BG-2026-0007', orderType: 'dat_tiec', customerName: 'Chị Lan', phone: '0900000000', organization: null, eventDate: '2026-12-20', eventTime: '18:30',
      guestCount: 50, venueNote: null, quoteValidDays: 7, requestedDeposit: 3300000, depositAmount: 0, createdAt: '2026-10-15T03:00:00.000Z', status: 'draft',
      items: [{ description: 'Set menu', quantity: 5, unitPrice: 2000000 }, { description: 'Nước', quantity: 1, unitPrice: 250000 }] };
    let role = 'reception';
    await context.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { role, username: 'Kiểm tra phiếu', permissions: ROLE_DEFAULTS[role] } });
      if (path === '/api/quote-settings') return route.fulfill({ json: settings });
      if (path === '/api/service-orders/7') return route.fulfill({ json: order });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/admin/service-order-quote.html?orderId=7`);
    await page.waitForSelector('#quote h1');
    const text = await page.locator('#quote').textContent();
    assert.match(text, /PHIẾU BÁO GIÁ/);
    assert.match(text, /BG-2026-0007/);
    assert.match(text, /Hiệu lực đến: 22\/10\/2026/);
    assert.match(text, /Mười triệu hai trăm năm mươi nghìn đồng/);
    assert.doesNotMatch(text, /Chuyển khoản:/);
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: 'test-results/admin-refresh/print-service-order-quote.png', fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await page.goto(`${base}/admin/quote-settings.html`);
    await page.waitForFunction(() => document.querySelector('[name="businessName"]').value.length > 0);
    assert.equal(await page.locator('[name="businessName"]').isDisabled(), true);
    role = 'manager';
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[name="businessName"]').value.length > 0);
    assert.equal(await page.locator('[name="businessName"]').isDisabled(), false);
    assert.deepEqual(errors, [], 'quote pages: browser errors');
    await context.close();
  }
```

Also, in the existing every-page shell loop of the same script, extend the controller allowlist so the quote page renders with synthetic data: change

```js
  await context.route('**/admin/*.js', r => /\/(nav-drawer|tabs|.*-print)\.js$/.test(r.request().url()) ? r.continue() : r.abort());
```

to

```js
  await context.route('**/admin/*.js', r => /\/(nav-drawer|tabs|.*-print|service-order-quote)\.js$/.test(r.request().url()) ? r.continue() : r.abort());
```

and in that loop's `/api/**` handler insert these two lines between the `const invoice = …` line and the existing `r.fulfill({json: …})` line (so `invoice` is in scope; the loop opens every page with `?bookingId=1&orderId=1&sessionId=1`, so the quote page asks for `/api/service-orders/1`):

```js
    if (path === '/api/quote-settings') return r.fulfill({ json: { businessName: 'Hiền Lê Garden', address: 'Lâm Đồng', hotline: '0968 987 311', defaultValidDays: 7, defaultDepositPercent: 30 } });
    if (path.startsWith('/api/service-orders/')) return r.fulfill({ json: { ...invoice, quoteNumber: 'BG-2026-0001', orderType: 'dat_tiec', customerName: 'Khách kiểm thử', eventDate: '2026-12-01', quoteValidDays: 7, requestedDeposit: 0, depositAmount: 0, createdAt: '2026-10-15T00:00:00Z', status: 'draft', items: [{ description: 'Dịch vụ', quantity: 1, unitPrice: 100000 }] } });
```

- [ ] **Step 6: Run build and browser check**

Run: `npm run build && npm run check:dist && node scripts/check-admin-refresh.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add admin/service-order-quote.html admin/service-order-quote.js admin/quote-settings.html admin/quote-settings.js scripts/check-admin-refresh.mjs
git commit -m "feat(service-orders): printable quote and quote template settings"
```

---

### Task 13: Reception and finance integrations

**Files:**
- Modify: `admin/reception.html`, `admin/reception.js`, `admin/finance.html`, `admin/finance.js`
- Test: `scripts/check-admin-refresh.mjs` (extend the reception and PR A finance blocks)

**Interfaces:**
- Consumes: `serviceOrders` on bookings (Task 10), `source` on finance rows (Task 10), `depositsOnly=1`.

- [ ] **Step 1: Reception badge and checkout warning**

In `admin/reception.html`, inside `#checkoutOverlay`, directly after `<p id="checkoutSummary"></p>` add:

```html
      <p id="checkoutServiceOrderWarning" class="error" hidden></p>
```

In `admin/reception.js`, in `renderBookingCard(b)` immediately after `card.appendChild(statusLine);` add:

```js
  if ((b.serviceOrders || []).length) {
    const linked = document.createElement('p');
    linked.className = 'muted';
    linked.textContent = `Có đơn dịch vụ: ${b.serviceOrders.map((o) => `#${o.id}`).join(', ')}`;
    card.appendChild(linked);
  }
```

In `openCheckoutDialog(booking)` immediately after `document.getElementById('checkoutError').textContent = '';` add:

```js
  const openOrders = (booking.serviceOrders || []).filter((o) => o.status === 'draft' || o.status === 'confirmed');
  const orderWarning = document.getElementById('checkoutServiceOrderWarning');
  orderWarning.hidden = openOrders.length === 0;
  orderWarning.textContent = `Booking còn đơn dịch vụ chưa tất toán: ${openOrders.map((o) => `#${o.id}`).join(', ')}. Tất toán tại trang Đơn dịch vụ (không ảnh hưởng việc trả phòng).`;
```

- [ ] **Step 2: Finance source label and deposits filter**

In `admin/finance.html`, right after the `#showHiddenTransactionsWrap` label add:

```html
    <label class="checkbox"><input type="checkbox" id="depositsOnlyFilter" /> Chỉ khoản cọc</label>
```

In `admin/finance.js`:

1. Add above `function renderTransactions(list) {`:

```js
const SOURCE_LABELS = {
  service_order_deposit: (id) => `Cọc đơn #${id}`,
  service_order_settle: (id) => `Tất toán đơn #${id}`,
  service_order_refund: (id) => `Hoàn cọc đơn #${id}`,
  booking_deposit: (id) => `Cọc booking #${id}`,
};
function noteWithSource(t) {
  const label = t.source && SOURCE_LABELS[t.source.kind] ? SOURCE_LABELS[t.source.kind](t.source.refId) : '';
  return [label, t.note || ''].filter(Boolean).join(' · ');
}
```

2. Inside `renderTransactions`, replace every occurrence of `t.note || ''` with `noteWithSource(t)` (the table cell and the mobile card).

3. In `loadTransactions`, after the `includeHidden` block add:

```js
  if (document.getElementById('depositsOnlyFilter').checked) params.set('depositsOnly', '1');
```

4. At the end of the file add:

```js
document.getElementById('depositsOnlyFilter').addEventListener('change', () => { currentPage = 1; loadTransactions(); });
```

- [ ] **Step 3: Extend the browser checks**

In `scripts/check-admin-refresh.mjs`:

1. In the reception role loop's API mock, change the `/api/bookings` pending fixture object to include `serviceOrders: [{ id: 7, status: 'confirmed' }]`, and after `await page.waitForFunction(() => document.querySelector('#pendingList').textContent.length > 0);` (inside the width loop) add:

```js
      assert.match(await page.locator('#pendingList').textContent(), /Có đơn dịch vụ: #7/);
```

2. In the PR A finance block, change `tx(1, true)` to `{ ...tx(1, true), source: { kind: 'service_order_deposit', refId: 7 } }` and before `await context.close();` add:

```js
    assert.match(await page.locator('#financeTable tbody').textContent(), /Cọc đơn #7/);
    const depositsRequest = page.waitForRequest((r) => r.url().includes('/api/finance/transactions') && r.url().includes('depositsOnly=1'));
    await page.locator('#depositsOnlyFilter').check();
    await depositsRequest;
```

- [ ] **Step 4: Run build and browser check**

Run: `npm run build && npm run check:dist && node scripts/check-admin-refresh.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/reception.html admin/reception.js admin/finance.html admin/finance.js scripts/check-admin-refresh.mjs
git commit -m "feat(service-orders): booking badge, checkout warning and finance source labels"
```

---

### Task 14: Release gate (owner approval at each external step)

**Files:** none.

- [ ] **Step 1: Full Linux gate**

```bash
node node_modules/vitest/vitest.mjs run --exclude test/assetInventoryLines.test.js --exclude test/assetPhotos.test.js --exclude test/financeAttachments.test.js
for f in assetInventoryLines assetPhotos financeAttachments; do node node_modules/vitest/vitest.mjs run --config test/vitest.r2-noniso.config.js "test/$f.test.js"; done
node node_modules/vitest/vitest.mjs run test/migrations.test.js
npm run build && npm run check:dist && node scripts/check-admin-refresh.mjs
```
Expected: everything passes.

- [ ] **Step 2: Owner approval → push and PR**; wait for the five CI jobs.

- [ ] **Step 3: Owner approval → staging**: apply `0046` to `hien_le_garden_crm_staging` (`npx wrangler d1 migrations apply hien_le_garden_crm_staging --remote --env preview`), deploy `--branch=staging`, then run once with synthetic data: create order → deposit → confirm → print quote → settle; second order → deposit → cancel with partial refund (manager); reception cannot cancel a deposited order; edit quote settings and preview; check Thu chi labels and the deposits filter; booking badge and checkout warning.

- [ ] **Step 4: Owner approval → production**: Time Travel bookmark, apply `0046` to production before merge, merge, deploy workflow, then read-only verification: migration count 46, `role_permissions` matches `ROLE_DEFAULTS`, health (`/` 200, `/admin/login` 200, `/api/public-config` 200, `/api/auth/me` 401), R-1 probe `PASS=62 FAIL=0 INCONCLUSIVE=0`.
