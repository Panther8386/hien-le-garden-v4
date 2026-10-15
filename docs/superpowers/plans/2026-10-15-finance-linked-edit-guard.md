# Finance Linked-Row Edit Guard (PR A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `PATCH /api/finance/transactions/:id` from changing type, category, amount, status or date of a finance row that is linked to a business flow (checkout, deposit, refund, order, Giờ Xanh, booking service); only the note stays editable.

**Architecture:** Reuse the existing SQL fragments `blockedFinanceLinks` and `cancelledDepositLink` from `lib/financeVoidGuard.js` (already used by `void.js`) in two places of the PATCH handler: a preflight that returns 400 when a financial field changes on a linked row, and a guard inside the `UPDATE` so a link created between preflight and write cannot slip through (409). The list API exposes a `linked` boolean per returned row so the finance page can lock those fields and explain why.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), Vitest with `@cloudflare/vitest-pool-workers`, vanilla JS admin pages, Playwright check script.

**Spec:** `docs/superpowers/specs/2026-10-15-service-orders-design.md` §3 (PR A) and decision D11.

## Global Constraints

- Linked = `blockedFinanceLinks` OR `cancelledDepositLink` from `lib/financeVoidGuard.js`; do not duplicate those SQL fragments.
- Linked rows: only `note` may change. A request whose `type`, `category`, `amount`, `transactionDate` and `status` equal the stored values is a note-only edit and must succeed.
- Error for a financial change on a linked row: HTTP 400, message `Khoản này gắn với nghiệp vụ (đặt phòng, cọc, order, Giờ Xanh…); chỉ sửa được ghi chú. Hãy điều chỉnh tại nghiệp vụ gốc.`
- Lost race (link appears after preflight, or row voided meanwhile): HTTP 409, message `Giao dịch hoặc liên kết vừa thay đổi, vui lòng tải lại`, and no audit row.
- Audit row `finance_transaction_update` keeps its current format and is written only when the `UPDATE` changed a row.
- Manual (unlinked) rows behave exactly as today.
- No migration. Attachments (`attachment.js`), hide and void endpoints are unchanged.
- Tests run on Linux (CI or WSL); the Windows workerd runtime is not a valid test gate.

## Review Focus

- A note-only edit sent by the real form (it always resends every field with unchanged values) on a linked row must succeed — pinned in Task 1 (`allows a note-only edit…`).
- A request that changes only `status` (e.g. confirmed → paid) on a linked row must be rejected — pinned in Task 1 (`rejects status change…`).
- A cancelled booking's unrefunded deposit receipt (only `cancelledDepositLink`, not `blockedFinanceLinks`) must also be locked — pinned in Task 1 (`cancelled unrefunded deposit…`).
- A row voided between preflight and write must not be edited — pinned in Task 1 (`rejects an edit when the row is voided after preflight`).
- The finance page must not show an editable amount/category for a linked row and must re-enable fields for the next manual edit — pinned in Task 2 (Playwright block).

---

## File Structure

| File | Responsibility |
|---|---|
| `functions/api/finance/transactions/[id].js` (modify) | PATCH: preflight lock + guarded UPDATE + conditional audit |
| `functions/api/finance/transactions/index.js` (modify) | GET: add `linked` to each returned row |
| `admin/finance.html` (modify) | Hint element for locked rows |
| `admin/finance.js` (modify) | Lock financial fields when editing a linked row; unlock on reset |
| `test/financeTransactions.test.js` (modify) | API tests for the lock, the race and the `linked` flag |
| `scripts/check-admin-refresh.mjs` (modify) | Playwright check that the form locks/unlocks correctly |

---

### Task 1: Lock financial fields of linked rows in PATCH

**Files:**
- Modify: `functions/api/finance/transactions/[id].js`
- Test: `test/financeTransactions.test.js` (new `describe` block appended at the end of the file)

**Interfaces:**
- Consumes: `blockedFinanceLinks`, `cancelledDepositLink` (string SQL fragments that reference the bare table name `finance_transactions`) from `lib/financeVoidGuard.js`; `envWithHookBefore(regex, hook)` from `test/helpers/raceEnv.js`.
- Produces: exported constant `LINKED_EDIT_ERROR` (string) from `functions/api/finance/transactions/[id].js`, used by Task 2's UI hint copy check.

- [ ] **Step 1: Write the failing tests**

Append to `test/financeTransactions.test.js`:

```js
describe('PATCH /api/finance/transactions/:id — linked rows only allow note edits (PR A)', () => {
  let txId;
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM dine_in_orders');
    await env.DB.exec('DELETE FROM booking_service_items');
    await env.DB.exec('DELETE FROM booking_deposits');
    await env.DB.exec('DELETE FROM bookings');
    const result = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
       VALUES ('income', 'dich_vu', 400000, 'Gốc', '2026-08-05', 'confirmed', 'quan_ly_fin', '2026-08-05T00:00:00Z')`
    ).run();
    txId = result.meta.last_row_id;
  });

  async function booking(status) {
    const row = await env.DB.prepare(`INSERT INTO bookings
      (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
      VALUES ('Fixture', '000', 'circle', '2099-01-01', '2099-01-02', ?, 'website', '2026-08-01')`).bind(status).run();
    return row.meta.last_row_id;
  }

  // Each entry links txId to one business flow.
  const LINKS = {
    'checkout receipt': async () => {
      const id = await booking('checked_out');
      await env.DB.prepare('UPDATE finance_transactions SET checkout_booking_id = ? WHERE id = ?').bind(id, txId).run();
    },
    'dine-in order receipt': async () => {
      await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at, finance_transaction_id)
        VALUES ('fx', 'closed', 'fx', '2026-08-01', ?)`).bind(txId).run();
    },
    'Giờ Xanh receipt': async () => {
      const room = await env.DB.prepare('SELECT id FROM rooms LIMIT 1').first();
      await env.DB.prepare(`INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at, finance_transaction_id)
        VALUES (?, 'fx', 'closed', 'fx', '2026-08-01', ?)`).bind(room.id, txId).run();
    },
    'booking service receipt': async () => {
      const id = await booking('checked_in');
      await env.DB.prepare(`INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, created_at, finance_transaction_id)
        VALUES (?, 'fx', 400000, 1, 400000, '2026-08-01', ?)`).bind(id, txId).run();
    },
    'booking refund': async () => {
      const id = await booking('cancelled');
      await env.DB.prepare('UPDATE bookings SET refund_finance_transaction_id = ? WHERE id = ?').bind(txId, id).run();
    },
    'live booking deposit': async () => {
      const id = await booking('confirmed');
      await env.DB.prepare(`INSERT INTO booking_deposits (booking_id, amount, payment_method, finance_transaction_id, created_by, created_at)
        VALUES (?, 400000, 'cash', ?, 'fx', '2026-08-01')`).bind(id, txId).run();
    },
    'cancelled unrefunded deposit': async () => {
      const id = await booking('cancelled');
      await env.DB.prepare(`INSERT INTO booking_deposits (booking_id, amount, payment_method, finance_transaction_id, created_by, created_at)
        VALUES (?, 400000, 'cash', ?, 'fx', '2026-08-01')`).bind(id, txId).run();
    },
  };

  function patch(body, testEnv = env) {
    return patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${txId}`, adminToken, 'PATCH', body),
      env: testEnv,
      params: { id: String(txId) },
    });
  }

  // What the real form sends: every field, financial ones unchanged.
  const FULL_UNCHANGED = { type: 'income', category: 'dich_vu', amount: 400000, transactionDate: '2026-08-05', status: 'confirmed' };

  async function row() {
    return env.DB.prepare('SELECT type, category, amount, note, transaction_date, status FROM finance_transactions WHERE id = ?').bind(txId).first();
  }
  async function updateAudits() {
    return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'finance_transaction_update' AND entity_id = ?`).bind(txId).first()).n;
  }

  for (const [name, link] of Object.entries(LINKS)) {
    it(`${name}: rejects an amount change with 400, leaving row and audit untouched`, async () => {
      await link();
      const response = await patch({ ...FULL_UNCHANGED, amount: 500000, note: 'Gốc' });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Khoản này gắn với nghiệp vụ (đặt phòng, cọc, order, Giờ Xanh…); chỉ sửa được ghi chú. Hãy điều chỉnh tại nghiệp vụ gốc.');
      expect(await row()).toMatchObject({ amount: 400000, note: 'Gốc' });
      expect(await updateAudits()).toBe(0);
    });

    it(`${name}: allows a note-only edit sent with every field unchanged`, async () => {
      await link();
      const response = await patch({ ...FULL_UNCHANGED, note: 'Ghi chú mới' });
      expect(response.status).toBe(200);
      expect(await row()).toMatchObject({ amount: 400000, category: 'dich_vu', note: 'Ghi chú mới' });
      expect(await updateAudits()).toBe(1);
    });
  }

  it('rejects category, type, date and status changes on a linked row', async () => {
    await LINKS['dine-in order receipt']();
    for (const change of [{ category: 'ban_hang' }, { type: 'expense', category: 'vat_tu' }, { transactionDate: '2026-08-06' }, { status: 'paid' }]) {
      const response = await patch({ ...FULL_UNCHANGED, note: 'Gốc', ...change });
      expect(response.status).toBe(400);
    }
    expect(await row()).toMatchObject({ type: 'income', category: 'dich_vu', transaction_date: '2026-08-05', status: 'confirmed' });
    expect(await updateAudits()).toBe(0);
  });

  it('still lets a manual (unlinked) row change its amount', async () => {
    const response = await patch({ ...FULL_UNCHANGED, amount: 450000, note: 'Gốc' });
    expect(response.status).toBe(200);
    expect((await row()).amount).toBe(450000);
  });

  it('rejects with 409 when a link is created after preflight, without writing an audit', async () => {
    const raced = envWithHookBefore(/UPDATE finance_transactions SET type/, async () => {
      await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at, finance_transaction_id)
        VALUES ('race', 'closed', 'fx', '2026-08-01', ?)`).bind(txId).run();
    });
    const response = await patch({ ...FULL_UNCHANGED, amount: 450000, note: 'Gốc' }, raced);
    expect(response.status).toBe(409);
    expect((await row()).amount).toBe(400000);
    expect(await updateAudits()).toBe(0);
  });

  it('rejects an edit when the row is voided after preflight', async () => {
    const raced = envWithHookBefore(/UPDATE finance_transactions SET type/, async () => {
      await env.DB.prepare(`UPDATE finance_transactions SET voided_at = '2026-08-06T00:00:00Z', voided_by = 'x' WHERE id = ?`).bind(txId).run();
    });
    const response = await patch({ ...FULL_UNCHANGED, note: 'Sau khi huỷ' }, raced);
    expect(response.status).toBe(409);
    expect((await row()).note).toBe('Gốc');
    expect(await updateAudits()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (Linux/WSL, repo root): `node node_modules/vitest/vitest.mjs run test/financeTransactions.test.js -t "linked rows only allow note edits"`
Expected: FAIL — the amount/category/status cases return 200 instead of 400, and the race cases return 200 instead of 409.

- [ ] **Step 3: Implement the guard**

In `functions/api/finance/transactions/[id].js`:

1. Add the import after the existing imports:

```js
import { blockedFinanceLinks, cancelledDepositLink } from '../../../../lib/financeVoidGuard.js';

export const LINKED_EDIT_ERROR = 'Khoản này gắn với nghiệp vụ (đặt phòng, cọc, order, Giờ Xanh…); chỉ sửa được ghi chú. Hãy điều chỉnh tại nghiệp vụ gốc.';
const linkedSql = `((${blockedFinanceLinks}) OR (${cancelledDepositLink}))`;
```

2. Directly after the existing validation line `if (!VALID_STATUSES.includes(status)) return jsonError('Trạng thái không hợp lệ', 400);` insert:

```js
  // Rows produced by a business flow (checkout, deposit, refund, order, Giờ Xanh, booking
  // service) must stay equal to that flow; only the note is free text.
  const financialChange = type !== existing.type || category !== existing.category
    || amount !== existing.amount || transactionDate !== existing.transaction_date || status !== existing.status;
  if (financialChange) {
    const link = await env.DB.prepare(`SELECT ${linkedSql} AS linked FROM finance_transactions WHERE id = ?`).bind(params.id).first();
    if (link && link.linked) return jsonError(LINKED_EDIT_ERROR, 400);
  }
```

3. Replace the existing `await env.DB.batch([...]);` block (the `UPDATE finance_transactions SET type = ?…` plus the audit `INSERT`) with:

```js
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE finance_transactions SET type = ?, category = ?, amount = ?, note = ?, transaction_date = ?, status = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND voided_at IS NULL AND (? = 0 OR NOT ${linkedSql})`
    ).bind(type, category, amount, note || null, transactionDate, status, auth.username, now, params.id, financialChange ? 1 : 0),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       SELECT 'finance_transaction_update', 'finance_transaction', ?, ?, ?, ?, ?, ? WHERE changes() > 0`
    ).bind(params.id, newSummary, oldSummary, newSummary, auth.username, now),
  ]);
  if (!results[0].meta.changes) return jsonError('Giao dịch hoặc liên kết vừa thay đổi, vui lòng tải lại', 409);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run test/financeTransactions.test.js`
Expected: PASS for the whole file (new block and every pre-existing PATCH/void/hide test).

- [ ] **Step 5: Commit**

```bash
git add "functions/api/finance/transactions/[id].js" test/financeTransactions.test.js
git commit -m "fix(finance): lock financial fields of rows linked to business flows"
```

---

### Task 2: Expose `linked` in the list and lock the finance form

**Files:**
- Modify: `functions/api/finance/transactions/index.js` (`onRequestGet`)
- Modify: `admin/finance.html` (form header)
- Modify: `admin/finance.js` (`openEditTransaction`, `resetFinanceForm`)
- Test: `test/financeTransactions.test.js` (append), `scripts/check-admin-refresh.mjs` (new block)

**Interfaces:**
- Consumes: `blockedFinanceLinks`, `cancelledDepositLink`; `LINKED_EDIT_ERROR` copy from Task 1 (the UI hint uses its own shorter text, see below).
- Produces: each object in `GET /api/finance/transactions` → `transactions[]` gains `linked: boolean`.

- [ ] **Step 1: Write the failing API test**

Append to `test/financeTransactions.test.js`:

```js
describe('GET /api/finance/transactions exposes linked (PR A)', () => {
  it('marks linked rows true and manual rows false', async () => {
    await env.DB.exec('DELETE FROM dine_in_orders');
    const linked = await env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
      VALUES ('income', 'ban_hang', 100000, 'order', '2026-08-05', 'confirmed', 'fx', '2026-08-05T00:00:00Z')`).run();
    const manual = await env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
      VALUES ('income', 'ban_hang', 200000, 'tay', '2026-08-05', 'confirmed', 'fx', '2026-08-05T00:00:01Z')`).run();
    await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at, finance_transaction_id)
      VALUES ('fx', 'closed', 'fx', '2026-08-01', ?)`).bind(linked.meta.last_row_id).run();
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', adminToken, 'GET'), env });
    const { transactions } = await response.json();
    expect(transactions.find((t) => t.id === linked.meta.last_row_id).linked).toBe(true);
    expect(transactions.find((t) => t.id === manual.meta.last_row_id).linked).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run test/financeTransactions.test.js -t "exposes linked"`
Expected: FAIL — `linked` is `undefined`.

- [ ] **Step 3: Implement `linked` in the list**

In `functions/api/finance/transactions/index.js`:

1. Add the import:

```js
import { blockedFinanceLinks, cancelledDepositLink } from '../../../../lib/financeVoidGuard.js';
```

2. In `coerceRow(r)` add the property `linked: !!r.linked,` after `isHidden: !!r.is_hidden,`.

3. In `onRequestGet`, replace `const pageRows = allRows.slice(offset, offset + pageSize);` with:

```js
  const pageRows = allRows.slice(offset, offset + pageSize);
  // Computed only for the returned page: the link checks are per-row subqueries.
  if (pageRows.length > 0) {
    const ids = pageRows.map((r) => r.id);
    const { results: linkRows } = await env.DB.prepare(
      `SELECT id, ((${blockedFinanceLinks}) OR (${cancelledDepositLink})) AS linked
       FROM finance_transactions WHERE id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    const linkedIds = new Set(linkRows.filter((r) => r.linked).map((r) => r.id));
    pageRows.forEach((r) => { r.linked = linkedIds.has(r.id); });
  }
```

- [ ] **Step 4: Run the API test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run test/financeTransactions.test.js`
Expected: PASS.

- [ ] **Step 5: Add the hint element and the form lock**

In `admin/finance.html`, directly after `<h3 id="financeFormTitle">Thêm giao dịch</h3>` add:

```html
        <p id="financeLinkedHint" class="muted" hidden>Khoản này gắn với nghiệp vụ (đặt phòng, cọc, order, Giờ Xanh…). Chỉ sửa được ghi chú và chứng từ; điều chỉnh số tiền tại nghiệp vụ gốc.</p>
```

In `admin/finance.js` add above `function openEditTransaction(t) {`:

```js
const LOCKABLE_FIELDS = ['type', 'category', 'amount', 'transactionDate', 'status'];
function setFinancialFieldsLocked(locked) {
  const form = document.getElementById('financeForm');
  LOCKABLE_FIELDS.forEach((name) => { form.querySelector(`[name="${name}"]`).disabled = locked; });
  document.getElementById('financeLinkedHint').hidden = !locked;
}
```

In `openEditTransaction(t)` add as the last line before `openFinanceFormOverlay();`:

```js
  setFinancialFieldsLocked(!!t.linked);
```

In `resetFinanceForm()` add as its first line after `const form = document.getElementById('financeForm');`:

```js
  setFinancialFieldsLocked(false);
```

(Disabled controls keep their `.value`, so the submit handler still sends the unchanged values and the server accepts the note-only edit.)

- [ ] **Step 6: Add the Playwright check**

In `scripts/check-admin-refresh.mjs`, insert this block right before the comment `// Every HTML page: inspect shared layout without invoking unrelated page APIs.`:

```js
  // PR A: editing a linked finance row locks the financial fields; a manual row stays editable.
  {
    const context = await browser.newContext();
    await context.route('https://**/*', (r) => r.abort());
    const tx = (id, linked) => ({ id, type: 'income', category: 'dich_vu', amount: 400000, note: `Dòng ${id}`, transactionDate: '2026-10-01', status: 'confirmed', createdBy: 'fx', createdAt: '2026-10-01T00:00:00Z', voidedAt: null, isHidden: false, linked });
    await context.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { role: 'admin', username: 'Kiểm tra Thu chi', permissions: PERMISSION_KEYS } });
      if (path === '/api/finance/categories') return route.fulfill({ json: [{ id: 1, slug: 'dich_vu', label: 'Lưu trú Hiền Lê', type: 'income', isActive: true }] });
      if (path === '/api/finance/transactions') return route.fulfill({ json: { transactions: [tx(1, true), tx(2, false)], total: 2, page: 1, pageSize: 25, sumIncome: 800000, sumExpense: 0, categoryTotals: { dich_vu: { income: 800000, expense: 0 } }, chartRows: [] } });
      if (path === '/api/finance/summary') return route.fulfill({ json: { month: '2026-10', openingBalance: 0, openingBalanceSource: 'none', totalIncome: 800000, totalExpense: 0, netChange: 800000, closingBalance: 800000 } });
      if (path === '/api/finance/opening-balance') return route.fulfill({ json: { period: '2026-10', openingBalance: null, setBy: null, setAt: null } });
      if (path === '/api/finance/receipts-usage') return route.fulfill({ json: { totalBytes: 0, thresholdBytes: 1, overThreshold: false } });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/admin/finance.html`);
    await page.waitForSelector('#financeTable tbody tr');
    const editButtons = page.locator('#financeTable tbody button[title="Sửa"]');
    await editButtons.nth(0).click();
    assert.equal(await page.locator('#financeForm [name="amount"]').isDisabled(), true);
    assert.equal(await page.locator('#financeForm [name="category"]').isDisabled(), true);
    assert.equal(await page.locator('#financeForm [name="note"]').isDisabled(), false);
    assert.equal(await page.locator('#financeLinkedHint').isVisible(), true);
    await page.locator('#financeFormCloseBtn').click();
    await editButtons.nth(1).click();
    assert.equal(await page.locator('#financeForm [name="amount"]').isDisabled(), false);
    assert.equal(await page.locator('#financeLinkedHint').isVisible(), false);
    assert.deepEqual(errors, [], 'finance page: browser errors');
    await context.close();
  }
```

(`#financeFormCloseBtn` already calls `resetFinanceForm()` → `setFinancialFieldsLocked(false)`; the second edit then sets the lock from `t.linked` again.)

- [ ] **Step 7: Run the build and the browser check**

Run (Windows or Linux): `npm run build && npm run check:dist && node scripts/check-admin-refresh.mjs`
Expected: `check-dist dist: PASS …` and the final `PASS:` line from the check script, no assertion errors.

- [ ] **Step 8: Commit**

```bash
git add functions/api/finance/transactions/index.js admin/finance.html admin/finance.js test/financeTransactions.test.js scripts/check-admin-refresh.mjs
git commit -m "feat(finance): flag linked rows and lock their financial fields in the form"
```

---

### Task 3: Release gate (no code; owner approval at each external step)

**Files:** none.

- [ ] **Step 1: Full Linux gate**

Run the same gate as CI (Linux/WSL, repo root):
```bash
node node_modules/vitest/vitest.mjs run --exclude test/assetInventoryLines.test.js --exclude test/assetPhotos.test.js --exclude test/financeAttachments.test.js
for f in assetInventoryLines assetPhotos financeAttachments; do node node_modules/vitest/vitest.mjs run --config test/vitest.r2-noniso.config.js "test/$f.test.js"; done
```
Expected: all files pass; the isolated count is the previous baseline plus the new tests.

- [ ] **Step 2: Owner approval → push branch and open PR**

```bash
git push -u origin <branch>
```
Open a PR to `main`; wait for the five CI jobs to pass.

- [ ] **Step 3: Owner approval → staging check**

Deploy the branch as Preview (`--branch=staging`) and verify on staging with synthetic data: edit a deposit receipt's amount → error message; edit its note → saved; a manual row's amount → saved.

- [ ] **Step 4: Owner approval → merge and production verification (read-only)**

After merge and the deploy workflow: health (`/` 200, `/admin/login` 200, `/api/public-config` 200, `/api/auth/me` 401), R-1 probe `node scripts/probe-private-urls.mjs https://hienlegarden.vn https://<new-hash>.hien-le-garden-v4.pages.dev` → `PASS=62 FAIL=0 INCONCLUSIVE=0`.
