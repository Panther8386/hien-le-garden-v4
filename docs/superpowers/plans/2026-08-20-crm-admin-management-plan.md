# CRM Admin Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable customer list with computed promo-code status, a message-template library that drives both automatic and manual email/Telegram sends, and an in-UI user-management page (create/delete/role, self-service password change) to the Hiền Lê Garden v4 CRM.

**Architecture:** Two new D1 tables (`message_templates`, `message_log`). A shared `lib/templates.js` renders `{variable}` placeholders into channel-appropriate output (HTML-escaped for email, Markdown-escaped for Telegram), used by both the automatic sends (currently hardcoded in `lib/email.js`/`lib/telegram.js`) and a new manual "send from the customer list" endpoint. New Pages Functions under `functions/api/customers/`, `functions/api/templates/`, `functions/api/users/`, `functions/api/auth/change-password.js`. Three new admin pages (`admin/customers.html`, `admin/templates.html`, `admin/users.html`) plus a shared change-password widget wired into every admin page.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), Vitest + `@cloudflare/vitest-pool-workers`, vanilla JS admin pages (no framework, matching the existing `admin/*.html`+`.js` pattern), Playwright for e2e.

**Spec:** `docs/specs/2026-08-20-crm-admin-management-design.md`

## Global Constraints

- Every new/modified Function uses the existing `requireAuth(request, env, [roles])` pattern from `lib/requireAuth.js` — never a new auth mechanism.
- New admin-only endpoints (customers, templates, users, change-password) do **not** add CORS handling — they follow the precedent of `functions/api/policy.js`, `functions/api/gift-inventory.js`, and `functions/api/promo/*` (same-origin admin calls only), not `functions/api/feedback.js` (which needs CORS because it can be embedded cross-origin).
- Every `jsonError(message, status)` helper and Vietnamese error-message tone matches the existing files exactly (see `functions/api/policy.js`, `functions/api/gift-inventory.js`).
- Password hashing is always via `hashPassword`/`verifyPassword` in `lib/auth.js` (PBKDF2, unchanged) — never introduce a second hashing scheme.
- All new Vitest test files live in `v4/test/*.test.js` and follow the existing `authedRequest(url, token, method, body)` helper pattern already used in `test/managerEndpoints.test.js` and `test/promoEndpoints.test.js` — define it locally per file (that's the existing convention; no shared test-helpers file exists yet, and this plan does not introduce one).
- Admin pages reuse `admin/admin.css` (dark green `#0D1F14` / gold `#C9A84C`, Cormorant Garamond + Inter) and the existing `.page`, `.error`, `.hidden`, `.table-scroll`/`table` classes — never introduce a competing style system.
- After every task, run `npm test` from `v4/` (Vitest) — it auto-retries known Windows-only infra flakes (see `BACKEND.md`); a real failure surfaces as `N failed` in the summary and must be fixed before moving on.
- Migration file: `migrations/0003_templates_and_logging.sql`, applied locally via the existing `vitest.config.js`/`test/apply-migrations.js` machinery automatically (no config change needed) — applying it to the **real remote D1** (`wrangler d1 migrations apply hien_le_garden_crm --remote`) happens once, after this plan's tasks are all merged, not as part of any individual task.

---

### Task 1: Migration — `message_templates` and `message_log` tables, seed default templates

**Files:**
- Create: `migrations/0003_templates_and_logging.sql`
- Test: `test/migrations.test.js`

**Interfaces:**
- Produces: `message_templates(id, name, channel, subject, body, is_active, created_by, updated_at)` and `message_log(id, feedback_id, template_id, channel, sent_by, status, error, sent_at)`, plus two seeded rows (`channel='email'` and `channel='telegram'`, both `is_active=1`) that every later task's automatic-send logic reads.

- [ ] **Step 1: Write the migration file**

```sql
CREATE TABLE message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'telegram')),
  subject TEXT,
  body TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_templates_channel_active ON message_templates(channel, is_active);

CREATE TABLE message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id TEXT NOT NULL,
  template_id INTEGER,
  channel TEXT NOT NULL,
  sent_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error TEXT,
  sent_at TEXT NOT NULL
);

CREATE INDEX idx_message_log_feedback ON message_log(feedback_id);

INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at)
VALUES (
  'Email mặc định',
  'email',
  'Mã ưu đãi từ Hiền Lê Garden Farmstay',
  '<div style="font-family: ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background:#0D1F14; color:#F5F0E6; padding:32px; max-width:480px; margin:0 auto;"><h1 style="color:#C9A84C; font-size:22px;">Hiền Lê Garden Farmstay</h1><p>Xin chào {guestName},</p><p>Cảm ơn bạn đã chia sẻ trải nghiệm tại Hiền Lê Garden. Đây là mã ưu đãi dành riêng cho bạn:</p><p style="font-size:28px; letter-spacing:2px; color:#C9A84C; font-weight:bold;">{promoCode}</p><p>Giảm <strong>{discountPercent}%</strong> cho lần sử dụng dịch vụ tiếp theo, có hiệu lực đến <strong>{expiresAt}</strong>.</p>{giftLine}<p>Hẹn gặp lại bạn tại Hiền Lê Garden!</p></div>',
  1,
  'system',
  '2026-08-20T00:00:00Z'
);

INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at)
VALUES (
  'Telegram mặc định',
  'telegram',
  NULL,
  '🌿 *Hiền Lê Garden Farmstay*

Xin chào {guestName}, cảm ơn bạn đã chia sẻ trải nghiệm!

Mã ưu đãi của bạn: *{promoCode}*
Giảm *{discountPercent}%* cho lần sau, có hiệu lực đến *{expiresAt}*.{giftLine}',
  1,
  'system',
  '2026-08-20T00:00:00Z'
);
```

- [ ] **Step 2: Write the failing test**

```js
// test/migrations.test.js
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('migration 0003', () => {
  it('creates message_templates with two active seed rows', async () => {
    const { results } = await env.DB.prepare(
      `SELECT channel, is_active FROM message_templates ORDER BY channel`
    ).all();
    expect(results).toEqual([
      { channel: 'email', is_active: 1 },
      { channel: 'telegram', is_active: 1 },
    ]);
  });

  it('creates an empty message_log table', async () => {
    const { results } = await env.DB.prepare(`SELECT * FROM message_log`).all();
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/migrations.test.js` — Expected: FAIL (`no such table: message_templates`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/migrations.test.js` — vitest auto-applies every file in `migrations/` via `test/apply-migrations.js`, so no other change is needed. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations/0003_templates_and_logging.sql test/migrations.test.js
git commit -m "feat: add message_templates and message_log tables"
```

---

### Task 2: `computePromoStatus` helper — dedupe the expiry logic already duplicated in `promo/[code].js` and `promo/[code]/redeem.js`

**Files:**
- Modify: `lib/promoCode.js`
- Modify: `functions/api/promo/[code].js`
- Test: `test/promoCode.test.js` (add cases)
- Test: `test/promoEndpoints.test.js` (existing tests must still pass unchanged — pure refactor)

**Interfaces:**
- Produces: `computePromoStatus(promoStatus: 'unused'|'used', expiresAt: string) -> 'unused'|'used'|'expired'` — Task 8 (customer list) and Task 9 (customer detail) import this.

- [ ] **Step 1: Write the failing test**

Append to `test/promoCode.test.js`:

```js
import { computePromoStatus } from '../lib/promoCode.js';

describe('computePromoStatus', () => {
  it('returns "expired" for an unused code past its expiry date', () => {
    expect(computePromoStatus('unused', '2020-01-01T00:00:00Z')).toBe('expired');
  });

  it('returns "unused" for an unused code still within its expiry date', () => {
    expect(computePromoStatus('unused', '2099-01-01T00:00:00Z')).toBe('unused');
  });

  it('returns "used" for a used code regardless of expiry date', () => {
    expect(computePromoStatus('used', '2020-01-01T00:00:00Z')).toBe('used');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/promoCode.test.js` — Expected: FAIL (`computePromoStatus is not a function`).

- [ ] **Step 3: Implement**

Append to `lib/promoCode.js`:

```js
export function computePromoStatus(promoStatus, expiresAt) {
  if (promoStatus === 'unused' && new Date(expiresAt) < new Date()) {
    return 'expired';
  }
  return promoStatus;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/promoCode.test.js` — Expected: PASS.

- [ ] **Step 5: Refactor `promo/[code].js` to use the new helper**

In `functions/api/promo/[code].js`, replace:

```js
  const status = row.promo_status === 'unused' && new Date(row.promo_expires_at) < new Date() ? 'expired' : row.promo_status;
```

with:

```js
  const status = computePromoStatus(row.promo_status, row.promo_expires_at);
```

and add the import at the top:

```js
import { computePromoStatus } from '../../../lib/promoCode.js';
```

- [ ] **Step 6: Run the existing promo endpoint tests to confirm the refactor is behavior-preserving**

Run: `npx vitest run test/promoEndpoints.test.js` — Expected: PASS, unchanged (this is a pure refactor — no new test needed here since the behavior is identical, only its internal implementation moved).

- [ ] **Step 7: Commit**

```bash
git add lib/promoCode.js functions/api/promo/\[code\].js test/promoCode.test.js
git commit -m "refactor: extract computePromoStatus, dedupe expiry logic"
```

---

### Task 3: `lib/templates.js` — variable rendering, channel-aware escaping

**Files:**
- Create: `lib/templates.js`
- Test: `test/templates.test.js`

**Interfaces:**
- Consumes: `escapeHtml` from `lib/email.js` (already exported, unchanged by this task), `escapeMarkdown` from `lib/telegram.js` (already exported, unchanged by this task).
- Produces: `renderTemplate(template: {channel, subject, body}, vars: {guestName, promoCode, discountPercent, expiresAt: Date, giftOffered}) -> {subject: string|undefined, body: string}`. Task 4's rewritten `feedback.js`/`telegram/webhook.js` and Task 10's manual-send endpoint call this.

- [ ] **Step 1: Write the failing test**

```js
// test/templates.test.js
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../lib/templates.js';

const baseVars = {
  guestName: 'Nguyễn Văn A',
  promoCode: 'HLG-4F7K9P',
  discountPercent: 15,
  expiresAt: new Date('2027-02-19T00:00:00Z'),
  giftOffered: false,
};

describe('renderTemplate', () => {
  it('substitutes variables into an email template and renders a subject', () => {
    const result = renderTemplate(
      { channel: 'email', subject: 'Chào {guestName}', body: 'Mã của bạn: {promoCode}, giảm {discountPercent}%, hết hạn {expiresAt}' },
      baseVars
    );
    expect(result.subject).toBe('Chào Nguyễn Văn A');
    expect(result.body).toBe('Mã của bạn: HLG-4F7K9P, giảm 15%, hết hạn 19/02/2027');
  });

  it('escapes HTML in guestName and promoCode for the email channel', () => {
    const result = renderTemplate(
      { channel: 'email', subject: 'x', body: '{guestName} {promoCode}' },
      { ...baseVars, guestName: '<script>alert(1)</script>', promoCode: '"><img src=x onerror=alert(2)>' }
    );
    expect(result.body).not.toContain('<script>alert(1)</script>');
    expect(result.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.body).not.toContain('<img src=x onerror=alert(2)>');
  });

  it('escapes Markdown special characters for the telegram channel and never renders a subject', () => {
    const result = renderTemplate(
      { channel: 'telegram', subject: null, body: 'Xin chào {guestName}, mã: {promoCode}' },
      { ...baseVars, guestName: 'A_B*C', promoCode: 'HLG-[X]' }
    );
    expect(result.subject).toBeUndefined();
    expect(result.body).toBe('Xin chào A\\_B\\*C, mã: HLG-\\[X]');
  });

  it('renders an empty giftLine when giftOffered is false', () => {
    const result = renderTemplate({ channel: 'email', subject: '', body: 'x{giftLine}y' }, { ...baseVars, giftOffered: false });
    expect(result.body).toBe('xy');
  });

  it('renders the gift sentence when giftOffered is true, HTML for email', () => {
    const result = renderTemplate({ channel: 'email', subject: '', body: '{giftLine}' }, { ...baseVars, giftOffered: true });
    expect(result.body).toContain('<p>Mang mã này đến quầy lễ tân');
  });

  it('renders the gift sentence when giftOffered is true, plain text with emoji for telegram', () => {
    const result = renderTemplate({ channel: 'telegram', subject: null, body: '{giftLine}' }, { ...baseVars, giftOffered: true });
    expect(result.body).toContain('🎁 Mang mã này đến quầy lễ tân');
  });

  it('leaves an unknown placeholder as literal text instead of stripping it', () => {
    const result = renderTemplate({ channel: 'email', subject: '', body: 'x{notAVariable}y' }, baseVars);
    expect(result.body).toBe('x{notAVariable}y');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/templates.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// lib/templates.js
import { escapeHtml } from './email.js';
import { escapeMarkdown } from './telegram.js';

const GIFT_LINE_HTML = '<p>Mang mã này đến quầy lễ tân — nếu quà lưu niệm vẫn còn, bạn sẽ được nhận thêm nhé!</p>';
const GIFT_LINE_TELEGRAM = '\n🎁 Mang mã này đến quầy lễ tân — nếu quà lưu niệm vẫn còn, bạn sẽ được nhận thêm nhé!';

function formatDate(date) {
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function renderTemplate(template, vars) {
  const isEmail = template.channel === 'email';
  const escape = isEmail ? escapeHtml : escapeMarkdown;

  const values = {
    guestName: escape(vars.guestName),
    promoCode: escape(vars.promoCode),
    discountPercent: String(vars.discountPercent),
    expiresAt: formatDate(vars.expiresAt),
    giftLine: vars.giftOffered ? (isEmail ? GIFT_LINE_HTML : GIFT_LINE_TELEGRAM) : '',
  };

  const substitute = (str) => str.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));

  return {
    subject: isEmail ? substitute(template.subject || '') : undefined,
    body: substitute(template.body),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/templates.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/templates.js test/templates.test.js
git commit -m "feat: add renderTemplate for channel-aware variable substitution"
```

---

### Task 4: Wire automatic sends through the template library (breaking signature change — done as one task, see Global Constraints)

**Files:**
- Modify: `lib/email.js` (signature change: `sendPromoEmail` takes pre-rendered `subject`/`html`, returns `boolean`; remove now-unused `buildHtml`; keep `escapeHtml` exported unchanged)
- Modify: `lib/telegram.js` (signature change: `sendTelegramMessage` takes pre-rendered `text`, returns `boolean`; keep `escapeMarkdown` exported unchanged)
- Modify: `functions/api/feedback.js` (load active email template, render, send, log to `message_log`)
- Modify: `functions/api/telegram/webhook.js` (load active telegram template, render, send, log to `message_log`)
- Modify: `test/email.test.js` (rewrite for new signature)
- Modify: `test/telegram.test.js` (rewrite for new signature)
- Modify: `test/feedbackEndpoint.test.js` (add `message_log` assertion)
- Modify: `test/telegramWebhook.test.js` (add `message_log` assertion)

**Interfaces:**
- Consumes: `renderTemplate` from Task 3, `message_templates`/`message_log` tables from Task 1.
- Produces: `sendPromoEmail(env, {to, toName, subject, html}) -> Promise<boolean>`, `sendTelegramMessage(env, {chatId, text}) -> Promise<boolean>` — these are now the permanent signatures; Task 10's manual-send endpoint also calls them.

This task changes a signature every existing caller and test depends on, so it is done as one unit — see Global Constraints' rationale (in the spec's "Implementation notes") for why this isn't split further.

- [ ] **Step 1: Rewrite `test/email.test.js` for the new signature (RED first)**

```js
// test/email.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPromoEmail } from '../lib/email.js';

describe('sendPromoEmail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the Brevo API with the given recipient, subject, and HTML body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendPromoEmail(
      { BREVO_API_KEY: 'test-key' },
      { to: 'khach@example.com', toName: 'Nguyễn Văn A', subject: 'Mã ưu đãi', html: '<p>xin chào</p>' }
    );

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.headers['api-key']).toBe('test-key');
    const body = JSON.parse(options.body);
    expect(body.to).toEqual([{ email: 'khach@example.com', name: 'Nguyễn Văn A' }]);
    expect(body.subject).toBe('Mã ưu đãi');
    expect(body.htmlContent).toBe('<p>xin chào</p>');
  });

  it('returns false and does not throw when the Brevo API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));
    const result = await sendPromoEmail({ BREVO_API_KEY: 'test-key' }, { to: 'x@example.com', toName: 'X', subject: 's', html: 'h' });
    expect(result).toBe(false);
  });

  it('returns false and does not throw when fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await sendPromoEmail({ BREVO_API_KEY: 'test-key' }, { to: 'x@example.com', toName: 'X', subject: 's', html: 'h' });
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Rewrite `test/telegram.test.js` for the new signature (RED first)**

```js
// test/telegram.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendTelegramMessage } from '../lib/telegram.js';

describe('sendTelegramMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the given text to the Telegram sendMessage API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTelegramMessage({ TELEGRAM_BOT_TOKEN: 'test-token' }, { chatId: '123', text: 'Xin chào' });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    const body = JSON.parse(options.body);
    expect(body).toEqual({ chat_id: '123', text: 'Xin chào', parse_mode: 'Markdown' });
  });

  it('returns false and does not throw when the Telegram API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));
    const result = await sendTelegramMessage({ TELEGRAM_BOT_TOKEN: 'x' }, { chatId: '1', text: 't' });
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run test/email.test.js test/telegram.test.js` — Expected: FAIL (old implementations still expect the old argument shape / build their own content).

- [ ] **Step 4: Rewrite `lib/email.js`**

```js
// lib/email.js
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendPromoEmail(env, { to, toName, subject, html }) {
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: 'khuyenmai@hienlegarden.vn', name: 'Hiền Lê Garden' },
        to: [{ email: to, name: toName }],
        subject,
        htmlContent: html,
      }),
    });
    if (!response.ok) {
      console.error('Brevo send failed', response.status, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Brevo send threw', err);
    return false;
  }
}
```

- [ ] **Step 5: Rewrite `lib/telegram.js`**

```js
// lib/telegram.js
export function escapeMarkdown(str) {
  return String(str).replace(/([_*`\[])/g, '\\$1');
}

export async function sendTelegramMessage(env, { chatId, text }) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (!response.ok) {
      console.error('Telegram send failed', response.status, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Telegram send threw', err);
    return false;
  }
}
```

- [ ] **Step 6: Run test to verify email/telegram tests pass**

Run: `npx vitest run test/email.test.js test/telegram.test.js` — Expected: PASS.

- [ ] **Step 7: Update `functions/api/feedback.js`'s email-send block**

Add imports at the top (alongside the existing ones):

```js
import { renderTemplate } from '../../lib/templates.js';
```

Replace the existing `if (email) { await sendPromoEmail(...); }` block with:

```js
  if (email) {
    const template = await env.DB.prepare(
      `SELECT id, channel, subject, body FROM message_templates WHERE channel = 'email' AND is_active = 1 LIMIT 1`
    ).first();

    if (template) {
      const rendered = renderTemplate(template, {
        guestName,
        promoCode,
        discountPercent: policy.discountPercent,
        expiresAt,
        giftOffered,
      });
      const sent = await sendPromoEmail(env, { to: email, toName: guestName, subject: rendered.subject, html: rendered.body });
      await env.DB.prepare(
        `INSERT INTO message_log (feedback_id, template_id, channel, sent_by, status, sent_at) VALUES (?, ?, 'email', 'system', ?, ?)`
      )
        .bind(feedbackId, template.id, sent ? 'success' : 'failed', new Date().toISOString())
        .run();
    }
  }
```

- [ ] **Step 8: Update `functions/api/telegram/webhook.js`**

Add the import:

```js
import { renderTemplate } from '../../../lib/templates.js';
```

Replace the existing `await sendTelegramMessage(env, {...});` call (after the `UPDATE feedback_responses SET telegram_chat_id ...` line) with:

```js
    const template = await env.DB.prepare(
      `SELECT id, channel, subject, body FROM message_templates WHERE channel = 'telegram' AND is_active = 1 LIMIT 1`
    ).first();

    if (template) {
      const rendered = renderTemplate(template, {
        guestName: row.guest_name,
        promoCode: row.promo_code,
        discountPercent: row.discount_percent,
        expiresAt: new Date(row.promo_expires_at),
        giftOffered: !!row.gift_offered,
      });
      const sent = await sendTelegramMessage(env, { chatId, text: rendered.body });
      await env.DB.prepare(
        `INSERT INTO message_log (feedback_id, template_id, channel, sent_by, status, sent_at) VALUES (?, ?, 'telegram', 'system', ?, ?)`
      )
        .bind(feedbackId, template.id, sent ? 'success' : 'failed', new Date().toISOString())
        .run();
    }
```

- [ ] **Step 9: Add `message_log` assertions to `test/feedbackEndpoint.test.js`**

In the `'creates a feedback row with a 6-month promo code and sends the email'` test, after the existing `expect(fetch).toHaveBeenCalledTimes(1);` line, add:

```js
    const logRow = await env.DB.prepare(`SELECT channel, status FROM message_log WHERE feedback_id = ?`).bind(body.feedbackId).first();
    expect(logRow).toEqual({ channel: 'email', status: 'success' });
```

- [ ] **Step 10: Add a `message_log` assertion to `test/telegramWebhook.test.js`**

In the `'links the chat id to the feedback row and sends the promo message on /start'` test, after the existing `expect(fetchMock).toHaveBeenCalledTimes(1);` line, add:

```js
    const logRow = await env.DB.prepare(`SELECT channel, status FROM message_log WHERE feedback_id = 'fb-1'`).first();
    expect(logRow).toEqual({ channel: 'telegram', status: 'success' });
```

- [ ] **Step 11: Run the full suite to verify everything passes**

Run: `npm test` (from `v4/`) — Expected: all green, 73+ tests plus the new ones from Tasks 1-4.

- [ ] **Step 12: Commit**

```bash
git add lib/email.js lib/telegram.js functions/api/feedback.js functions/api/telegram/webhook.js test/email.test.js test/telegram.test.js test/feedbackEndpoint.test.js test/telegramWebhook.test.js
git commit -m "feat: drive automatic email/Telegram sends from the active template, log every send"
```

---

### Task 5: Templates API — `GET /api/templates`, `POST /api/templates`

**Files:**
- Create: `functions/api/templates/index.js`
- Test: `test/templatesEndpoints.test.js`

**Interfaces:**
- Consumes: `requireAuth` from `lib/requireAuth.js`.
- Produces: the list/create routes Task 14 (`admin/templates.html`) calls.

- [ ] **Step 1: Write the failing test**

```js
// test/templatesEndpoints.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listTemplates, onRequestPost as createTemplate } from '../functions/api/templates/index.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM message_templates');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);
});

function authedRequest(url, token, method, body) {
  return new Request(url, {
    method,
    headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/templates', () => {
  it('lets reception read the template list', async () => {
    await createTemplate({ request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'A', channel: 'email', subject: 's', body: 'b' }), env });
    const response = await listTemplates({ request: authedRequest('https://x/api/templates', receptionToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ name: 'A', channel: 'email', isActive: false });
  });

  it('rejects unauthenticated requests', async () => {
    const response = await listTemplates({ request: new Request('https://x/api/templates'), env });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/templates', () => {
  it('lets a manager create an email template', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'Lời cảm ơn', channel: 'email', subject: 'Cảm ơn bạn', body: 'Xin chào {guestName}' }),
      env,
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeTypeOf('number');
  });

  it('rejects a reception account (403)', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', receptionToken, 'POST', { name: 'x', channel: 'email', subject: 's', body: 'b' }),
      env,
    });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid channel', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'x', channel: 'sms', subject: 's', body: 'b' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects an email template with no subject', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'x', channel: 'email', subject: '', body: 'b' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects an empty body', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'x', channel: 'telegram', body: '' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/templates', { method: 'POST', headers: { Cookie: `session=${managerToken}` }, body: 'not json' });
    const response = await createTemplate({ request, env });
    expect(response.status).toBe(400);
  });

  it('a new template always starts inactive', async () => {
    const response = await createTemplate({
      request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'x', channel: 'telegram', body: 'b' }),
      env,
    });
    const { id } = await response.json();
    const row = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(id).first();
    expect(row.is_active).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/templatesEndpoints.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/templates/index.js
import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    `SELECT id, name, channel, subject, body, is_active AS isActive, updated_at AS updatedAt
     FROM message_templates ORDER BY channel, name`
  ).all();

  const coerced = results.map((r) => ({ ...r, isActive: !!r.isActive }));
  return new Response(JSON.stringify(coerced), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { name, channel, subject, body: templateBody } = body;

  if (typeof name !== 'string' || name.trim().length === 0) {
    return jsonError('Tên template không được để trống', 400);
  }
  if (channel !== 'email' && channel !== 'telegram') {
    return jsonError('Kênh phải là email hoặc telegram', 400);
  }
  if (channel === 'email' && (typeof subject !== 'string' || subject.trim().length === 0)) {
    return jsonError('Template email cần tiêu đề', 400);
  }
  if (typeof templateBody !== 'string' || templateBody.trim().length === 0) {
    return jsonError('Nội dung template không được để trống', 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(name, channel, channel === 'email' ? subject : null, templateBody, auth.username, new Date().toISOString())
    .run();

  return new Response(JSON.stringify({ id: result.meta.last_row_id }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/templatesEndpoints.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/templates/index.js test/templatesEndpoints.test.js
git commit -m "feat: add GET/POST /api/templates"
```

---

### Task 6: Templates API — `PUT /api/templates/:id`, `DELETE /api/templates/:id`

**Files:**
- Create: `functions/api/templates/[id].js`
- Test: append to `test/templatesEndpoints.test.js`

**Interfaces:**
- Consumes: same validation rules as Task 5's `POST`.
- Produces: edit/delete routes Task 14's UI calls.

- [ ] **Step 1: Write the failing test**

Append to `test/templatesEndpoints.test.js`:

```js
import { onRequestPut as editTemplate, onRequestDelete as deleteTemplate } from '../functions/api/templates/[id].js';

describe('PUT /api/templates/:id', () => {
  it('lets a manager edit a template', async () => {
    const created = await createTemplate({ request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'A', channel: 'email', subject: 's', body: 'b' }), env });
    const { id } = await created.json();

    const response = await editTemplate({
      request: authedRequest(`https://x/api/templates/${id}`, managerToken, 'PUT', { name: 'A2', channel: 'email', subject: 's2', body: 'b2' }),
      env,
      params: { id: String(id) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT name, subject, body FROM message_templates WHERE id = ?`).bind(id).first();
    expect(row).toEqual({ name: 'A2', subject: 's2', body: 'b2' });
  });

  it('rejects a reception account (403)', async () => {
    const response = await editTemplate({ request: authedRequest('https://x/api/templates/1', receptionToken, 'PUT', { name: 'x', channel: 'email', subject: 's', body: 'b' }), env, params: { id: '1' } });
    expect(response.status).toBe(403);
  });

  it('returns 404 for a nonexistent template', async () => {
    const response = await editTemplate({ request: authedRequest('https://x/api/templates/999', managerToken, 'PUT', { name: 'x', channel: 'email', subject: 's', body: 'b' }), env, params: { id: '999' } });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/templates/:id', () => {
  it('lets a manager delete an inactive template', async () => {
    const created = await createTemplate({ request: authedRequest('https://x/api/templates', managerToken, 'POST', { name: 'A', channel: 'telegram', body: 'b' }), env });
    const { id } = await created.json();

    const response = await deleteTemplate({ request: authedRequest(`https://x/api/templates/${id}`, managerToken, 'DELETE'), env, params: { id: String(id) } });
    expect(response.status).toBe(204);

    const row = await env.DB.prepare(`SELECT id FROM message_templates WHERE id = ?`).bind(id).first();
    expect(row).toBeNull();
  });

  it('rejects deleting an active template (400)', async () => {
    // beforeEach clears message_templates (including the migration's seed rows), so this
    // test creates its own active template rather than relying on seed data being present.
    const active = await env.DB.prepare(
      `INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('Active one', 'email', 's', 'b', 1, 'system', '2026-08-01T00:00:00Z')`
    ).run();
    const activeId = active.meta.last_row_id;

    const response = await deleteTemplate({ request: authedRequest(`https://x/api/templates/${activeId}`, managerToken, 'DELETE'), env, params: { id: String(activeId) } });
    expect(response.status).toBe(400);
  });

  it('rejects a reception account (403)', async () => {
    const response = await deleteTemplate({ request: authedRequest('https://x/api/templates/1', receptionToken, 'DELETE'), env, params: { id: '1' } });
    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/templatesEndpoints.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/templates/[id].js
import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPut({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT id FROM message_templates WHERE id = ?`).bind(params.id).first();
  if (!existing) {
    return jsonError('Không tìm thấy template', 404);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { name, channel, subject, body: templateBody } = body;

  if (typeof name !== 'string' || name.trim().length === 0) {
    return jsonError('Tên template không được để trống', 400);
  }
  if (channel !== 'email' && channel !== 'telegram') {
    return jsonError('Kênh phải là email hoặc telegram', 400);
  }
  if (channel === 'email' && (typeof subject !== 'string' || subject.trim().length === 0)) {
    return jsonError('Template email cần tiêu đề', 400);
  }
  if (typeof templateBody !== 'string' || templateBody.trim().length === 0) {
    return jsonError('Nội dung template không được để trống', 400);
  }

  await env.DB.prepare(
    `UPDATE message_templates SET name = ?, channel = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?`
  )
    .bind(name, channel, channel === 'email' ? subject : null, templateBody, new Date().toISOString(), params.id)
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(params.id).first();
  if (!existing) {
    return jsonError('Không tìm thấy template', 404);
  }
  if (existing.is_active) {
    return jsonError('Không thể xoá template đang active — hãy chuyển active sang template khác trước', 400);
  }

  await env.DB.prepare(`DELETE FROM message_templates WHERE id = ?`).bind(params.id).run();
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/templatesEndpoints.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/templates/\[id\].js test/templatesEndpoints.test.js
git commit -m "feat: add PUT/DELETE /api/templates/:id"
```

---

### Task 7: Templates API — `POST /api/templates/:id/activate`, `POST /api/templates/:id/deactivate`

**Files:**
- Create: `functions/api/templates/[id]/activate.js`
- Create: `functions/api/templates/[id]/deactivate.js`
- Test: `test/templateActivation.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/templateActivation.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as activate } from '../functions/api/templates/[id]/activate.js';
import { onRequestPost as deactivate } from '../functions/api/templates/[id]/deactivate.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, templateAId, templateBId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM message_templates');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);

  const a = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('A', 'email', 's', 'b', 1, 'system', '2026-08-01T00:00:00Z')`).run();
  const b = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('B', 'email', 's', 'b', 0, 'system', '2026-08-01T00:00:00Z')`).run();
  templateAId = a.meta.last_row_id;
  templateBId = b.meta.last_row_id;
});

function authedRequest(url, token, method) {
  return new Request(url, { method, headers: { Cookie: `session=${token}` } });
}

describe('POST /api/templates/:id/activate', () => {
  it('activates the target template and deactivates the other one on the same channel', async () => {
    const response = await activate({ request: authedRequest(`https://x/api/templates/${templateBId}/activate`, managerToken, 'POST'), env, params: { id: String(templateBId) } });
    expect(response.status).toBe(200);

    const a = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(templateAId).first();
    const b = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(templateBId).first();
    expect(a.is_active).toBe(0);
    expect(b.is_active).toBe(1);
  });

  it('rejects a reception account (403)', async () => {
    const response = await activate({ request: authedRequest(`https://x/api/templates/${templateBId}/activate`, receptionToken, 'POST'), env, params: { id: String(templateBId) } });
    expect(response.status).toBe(403);
  });
});

describe('POST /api/templates/:id/deactivate', () => {
  it('deactivates the target template without activating any other', async () => {
    const response = await deactivate({ request: authedRequest(`https://x/api/templates/${templateAId}/deactivate`, managerToken, 'POST'), env, params: { id: String(templateAId) } });
    expect(response.status).toBe(200);

    const a = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(templateAId).first();
    const b = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(templateBId).first();
    expect(a.is_active).toBe(0);
    expect(b.is_active).toBe(0);
  });

  it('rejects a reception account (403)', async () => {
    const response = await deactivate({ request: authedRequest(`https://x/api/templates/${templateAId}/deactivate`, receptionToken, 'POST'), env, params: { id: String(templateAId) } });
    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/templateActivation.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/templates/[id]/activate.js
import { requireAuth } from '../../../../lib/requireAuth.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  const template = await env.DB.prepare(`SELECT channel FROM message_templates WHERE id = ?`).bind(params.id).first();
  if (!template) {
    return new Response(JSON.stringify({ error: 'Không tìm thấy template' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.batch([
    env.DB.prepare(`UPDATE message_templates SET is_active = 0 WHERE channel = ?`).bind(template.channel),
    env.DB.prepare(`UPDATE message_templates SET is_active = 1 WHERE id = ?`).bind(params.id),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

```js
// functions/api/templates/[id]/deactivate.js
import { requireAuth } from '../../../../lib/requireAuth.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  const template = await env.DB.prepare(`SELECT id FROM message_templates WHERE id = ?`).bind(params.id).first();
  if (!template) {
    return new Response(JSON.stringify({ error: 'Không tìm thấy template' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare(`UPDATE message_templates SET is_active = 0 WHERE id = ?`).bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/templateActivation.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/templates/\[id\]/activate.js functions/api/templates/\[id\]/deactivate.js test/templateActivation.test.js
git commit -m "feat: add template activate/deactivate endpoints"
```

---

### Task 8: Customers API — `GET /api/customers` (search, status filter, pagination)

**Files:**
- Create: `functions/api/customers/index.js`
- Test: `test/customersEndpoints.test.js`

**Interfaces:**
- Consumes: `computePromoStatus` from Task 2.
- Produces: the list route Task 16's `admin/customers.html` calls.

- [ ] **Step 1: Write the failing test**

```js
// test/customersEndpoints.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listCustomers } from '../functions/api/customers/index.js';
import { createSession } from '../lib/auth.js';

let managerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM feedback_responses');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);

  await env.DB.prepare(
    `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, wants_telegram, telegram_chat_id, rating, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed)
     VALUES ('fb-1', '2026-08-20T10:00:00Z', 'Nguyễn Văn A', '0900000001', 'a@example.com', 0, NULL, 5, 1, 'HLG-AAAA', 10, '2099-01-01T00:00:00Z', 'unused', 0, 0)`
  ).run();
  await env.DB.prepare(
    `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, wants_telegram, telegram_chat_id, rating, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed)
     VALUES ('fb-2', '2026-08-19T10:00:00Z', 'Trần Thị B', '0900000002', NULL, 1, '999', 4, 1, 'HLG-BBBB', 10, '2020-01-01T00:00:00Z', 'unused', 0, 0)`
  ).run();
  await env.DB.prepare(
    `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, wants_telegram, telegram_chat_id, rating, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed)
     VALUES ('fb-3', '2026-08-18T10:00:00Z', 'Lê Văn C', '0900000003', 'c@example.com', 0, NULL, 3, 1, 'HLG-CCCC', 10, '2099-01-01T00:00:00Z', 'used', 0, 0)`
  ).run();
});

function authedRequest(url, method = 'GET') {
  return new Request(url, { method, headers: { Cookie: `session=${managerToken}` } });
}

describe('GET /api/customers', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listCustomers({ request: new Request('https://x/api/customers'), env });
    expect(response.status).toBe(401);
  });

  it('lists all customers newest first with computed status', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(3);
    expect(body.results.map((r) => r.feedbackId)).toEqual(['fb-1', 'fb-2', 'fb-3']);
    expect(body.results[0]).toMatchObject({ promoStatus: 'unused', hasTelegramChatId: false });
    expect(body.results[1]).toMatchObject({ promoStatus: 'expired', hasTelegramChatId: true });
    expect(body.results[2]).toMatchObject({ promoStatus: 'used' });
  });

  it('filters by status', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers?status=expired'), env });
    const body = await response.json();
    expect(body.results.map((r) => r.feedbackId)).toEqual(['fb-2']);
  });

  it('searches by guest name', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers?search=Tr%E1%BA%A7n'), env });
    const body = await response.json();
    expect(body.results.map((r) => r.feedbackId)).toEqual(['fb-2']);
  });

  it('searches by phone', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers?search=0900000003'), env });
    const body = await response.json();
    expect(body.results.map((r) => r.feedbackId)).toEqual(['fb-3']);
  });

  it('searches by promo code', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers?search=HLG-AAAA'), env });
    const body = await response.json();
    expect(body.results.map((r) => r.feedbackId)).toEqual(['fb-1']);
  });

  it('paginates', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers?page=1&pageSize=2'), env });
    const body = await response.json();
    expect(body.results).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/customersEndpoints.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/customers/index.js
import { requireAuth } from '../../../lib/requireAuth.js';
import { computePromoStatus } from '../../../lib/promoCode.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').trim();
  const statusFilter = url.searchParams.get('status');
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize'), 10) || 25));

  const conditions = [];
  const params = [];
  if (search) {
    conditions.push(`(guest_name LIKE ? OR phone LIKE ? OR promo_code LIKE ?)`);
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT id AS feedbackId, guest_name AS guestName, phone, email, rating, promo_code AS promoCode,
            discount_percent AS discountPercent, promo_status AS promoStatus, promo_expires_at AS promoExpiresAt,
            submitted_at AS submittedAt, wants_telegram AS wantsTelegram, telegram_chat_id AS telegramChatId,
            gift_offered AS giftOffered, gift_claimed AS giftClaimed
     FROM feedback_responses ${where} ORDER BY submitted_at DESC`
  )
    .bind(...params)
    .all();

  let mapped = results.map((r) => ({
    feedbackId: r.feedbackId,
    guestName: r.guestName,
    phone: r.phone,
    email: r.email,
    rating: r.rating,
    promoCode: r.promoCode,
    discountPercent: r.discountPercent,
    promoStatus: computePromoStatus(r.promoStatus, r.promoExpiresAt),
    submittedAt: r.submittedAt,
    wantsTelegram: !!r.wantsTelegram,
    hasTelegramChatId: !!r.telegramChatId,
    giftOffered: !!r.giftOffered,
    giftClaimed: !!r.giftClaimed,
  }));

  if (statusFilter === 'unused' || statusFilter === 'used' || statusFilter === 'expired') {
    mapped = mapped.filter((r) => r.promoStatus === statusFilter);
  }

  const total = mapped.length;
  const start = (page - 1) * pageSize;
  const pageResults = mapped.slice(start, start + pageSize);

  return new Response(JSON.stringify({ results: pageResults, total, page, pageSize }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

Note: the `status` filter and pagination are applied in JS after the SQL query, not in SQL, because `promoStatus` is computed (SQL can't cheaply express "expired" without a second date comparison per status value already covered by `computePromoStatus`); this keeps the single source of truth in one function. For the guest counts this project expects (spec: "under 50 checkouts/day"), loading every row and filtering in memory is fine — revisit only if the table grows to a size where that stops being true.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/customersEndpoints.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/customers/index.js test/customersEndpoints.test.js
git commit -m "feat: add GET /api/customers with search, status filter, pagination"
```

---

### Task 9: Customers API — `GET /api/customers/:feedbackId` (detail + message history)

**Files:**
- Create: `functions/api/customers/[id].js`
- Test: `test/customerDetail.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/customerDetail.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getCustomer } from '../functions/api/customers/[id].js';
import { createSession } from '../lib/auth.js';

let managerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM feedback_responses');
  await env.DB.exec('DELETE FROM message_log');
  await env.DB.exec('DELETE FROM message_templates');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);

  await env.DB.prepare(
    `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, rating, comment, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed, stay_date, wishes_next_time, favorite_activities)
     VALUES ('fb-1', '2026-08-20T10:00:00Z', 'Nguyễn Văn A', '0900000001', 'a@example.com', 5, 'Rất tốt', 1, 'HLG-AAAA', 10, '2099-01-01T00:00:00Z', 'unused', 0, 0, '2026-08-15', 'Muốn thử BBQ', '["bbq","ca-phe-vuon"]')`
  ).run();

  const template = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('Email mặc định', 'email', 's', 'b', 1, 'system', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(
    `INSERT INTO message_log (feedback_id, template_id, channel, sent_by, status, sent_at) VALUES ('fb-1', ?, 'email', 'system', 'success', '2026-08-20T10:00:05Z')`
  ).bind(template.meta.last_row_id).run();
});

function authedRequest(url) {
  return new Request(url, { headers: { Cookie: `session=${managerToken}` } });
}

describe('GET /api/customers/:feedbackId', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await getCustomer({ request: new Request('https://x/api/customers/fb-1'), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(401);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await getCustomer({ request: authedRequest('https://x/api/customers/unknown'), env, params: { id: 'unknown' } });
    expect(response.status).toBe(404);
  });

  it('returns full detail with parsed favoriteActivities and message history', async () => {
    const response = await getCustomer({ request: authedRequest('https://x/api/customers/fb-1'), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.comment).toBe('Rất tốt');
    expect(body.stayDate).toBe('2026-08-15');
    expect(body.wishesNextTime).toBe('Muốn thử BBQ');
    expect(body.favoriteActivities).toEqual(['bbq', 'ca-phe-vuon']);
    expect(body.messageHistory).toHaveLength(1);
    expect(body.messageHistory[0]).toMatchObject({ channel: 'email', status: 'success', templateName: 'Email mặc định' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/customerDetail.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/customers/[id].js
import { requireAuth } from '../../../lib/requireAuth.js';
import { computePromoStatus } from '../../../lib/promoCode.js';

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  const row = await env.DB.prepare(
    `SELECT id AS feedbackId, guest_name AS guestName, phone, email, rating, comment, promo_code AS promoCode,
            discount_percent AS discountPercent, promo_status AS promoStatus, promo_expires_at AS promoExpiresAt,
            submitted_at AS submittedAt, wants_telegram AS wantsTelegram, telegram_chat_id AS telegramChatId,
            gift_offered AS giftOffered, gift_claimed AS giftClaimed, stay_date AS stayDate,
            wishes_next_time AS wishesNextTime, favorite_activities AS favoriteActivities
     FROM feedback_responses WHERE id = ?`
  )
    .bind(params.id)
    .first();

  if (!row) {
    return new Response(JSON.stringify({ error: 'Không tìm thấy khách hàng' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const { results: history } = await env.DB.prepare(
    `SELECT l.channel, l.status, l.sent_at AS sentAt, l.sent_by AS sentBy, t.name AS templateName
     FROM message_log l LEFT JOIN message_templates t ON t.id = l.template_id
     WHERE l.feedback_id = ? ORDER BY l.sent_at DESC`
  )
    .bind(params.id)
    .all();

  return new Response(
    JSON.stringify({
      feedbackId: row.feedbackId,
      guestName: row.guestName,
      phone: row.phone,
      email: row.email,
      rating: row.rating,
      comment: row.comment,
      promoCode: row.promoCode,
      discountPercent: row.discountPercent,
      promoStatus: computePromoStatus(row.promoStatus, row.promoExpiresAt),
      submittedAt: row.submittedAt,
      wantsTelegram: !!row.wantsTelegram,
      hasTelegramChatId: !!row.telegramChatId,
      giftOffered: !!row.giftOffered,
      giftClaimed: !!row.giftClaimed,
      stayDate: row.stayDate,
      wishesNextTime: row.wishesNextTime,
      favoriteActivities: row.favoriteActivities ? JSON.parse(row.favoriteActivities) : [],
      messageHistory: history.map((h) => ({
        channel: h.channel,
        status: h.status,
        sentAt: h.sentAt,
        sentBy: h.sentBy,
        templateName: h.templateName || null,
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/customerDetail.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/customers/\[id\].js test/customerDetail.test.js
git commit -m "feat: add GET /api/customers/:id with message history"
```

---

### Task 10: Customers API — `POST /api/customers/:feedbackId/send` (manual send)

**Files:**
- Create: `functions/api/customers/[id]/send.js`
- Test: `test/customerSend.test.js`

**Interfaces:**
- Consumes: `renderTemplate` (Task 3), `sendPromoEmail`/`sendTelegramMessage` (Task 4).

- [ ] **Step 1: Write the failing test**

```js
// test/customerSend.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as sendMessage } from '../functions/api/customers/[id]/send.js';
import { createSession } from '../lib/auth.js';

let receptionToken, emailTemplateId, telegramTemplateId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM feedback_responses');
  await env.DB.exec('DELETE FROM message_log');
  await env.DB.exec('DELETE FROM message_templates');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 2);

  await env.DB.prepare(
    `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, telegram_chat_id, rating, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed)
     VALUES ('fb-1', '2026-08-20T10:00:00Z', 'Nguyễn Văn A', '0900000001', 'a@example.com', NULL, 5, 1, 'HLG-AAAA', 10, '2099-01-01T00:00:00Z', 'unused', 0, 0)`
  ).run();

  const emailT = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('E', 'email', 'Chào {guestName}', 'Mã: {promoCode}', 0, 'system', '2026-08-01T00:00:00Z')`).run();
  const tgT = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('T', 'telegram', NULL, 'Mã: {promoCode}', 0, 'system', '2026-08-01T00:00:00Z')`).run();
  emailTemplateId = emailT.meta.last_row_id;
  telegramTemplateId = tgT.meta.last_row_id;

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});

function authedRequest(url, body) {
  return new Request(url, { method: 'POST', headers: { Cookie: `session=${receptionToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/customers/:feedbackId/send', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await sendMessage({ request: new Request('https://x', { method: 'POST' }), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(401);
  });

  it('renders and sends an email template, logging success', async () => {
    const response = await sendMessage({ request: authedRequest('https://x', { templateId: emailTemplateId }), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    const log = await env.DB.prepare(`SELECT channel, status, template_id AS templateId FROM message_log WHERE feedback_id = 'fb-1'`).first();
    expect(log).toEqual({ channel: 'email', status: 'success', templateId: emailTemplateId });
  });

  it('rejects sending a telegram template to a guest with no telegram_chat_id (400)', async () => {
    const response = await sendMessage({ request: authedRequest('https://x', { templateId: telegramTemplateId }), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown customer', async () => {
    const response = await sendMessage({ request: authedRequest('https://x', { templateId: emailTemplateId }), env, params: { id: 'unknown' } });
    expect(response.status).toBe(404);
  });

  it('returns 404 for an unknown template', async () => {
    const response = await sendMessage({ request: authedRequest('https://x', { templateId: 999999 }), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(404);
  });

  it('logs a failed send when the provider call fails, and still returns ok:false without a 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));
    const response = await sendMessage({ request: authedRequest('https://x', { templateId: emailTemplateId }), env, params: { id: 'fb-1' } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);

    const log = await env.DB.prepare(`SELECT status FROM message_log WHERE feedback_id = 'fb-1'`).first();
    expect(log.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/customerSend.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/customers/[id]/send.js
import { requireAuth } from '../../../../lib/requireAuth.js';
import { renderTemplate } from '../../../../lib/templates.js';
import { sendPromoEmail } from '../../../../lib/email.js';
import { sendTelegramMessage } from '../../../../lib/telegram.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { templateId } = body;

  const guest = await env.DB.prepare(
    `SELECT guest_name, email, telegram_chat_id, promo_code, discount_percent, promo_expires_at, gift_offered
     FROM feedback_responses WHERE id = ?`
  )
    .bind(params.id)
    .first();
  if (!guest) {
    return jsonError('Không tìm thấy khách hàng', 404);
  }

  const template = await env.DB.prepare(`SELECT id, channel, subject, body FROM message_templates WHERE id = ?`).bind(templateId).first();
  if (!template) {
    return jsonError('Không tìm thấy template', 404);
  }

  if (template.channel === 'telegram' && !guest.telegram_chat_id) {
    return jsonError('Khách chưa kết nối Telegram, không thể gửi qua kênh này', 400);
  }
  if (template.channel === 'email' && !guest.email) {
    return jsonError('Khách không có email', 400);
  }

  const rendered = renderTemplate(template, {
    guestName: guest.guest_name,
    promoCode: guest.promo_code,
    discountPercent: guest.discount_percent,
    expiresAt: new Date(guest.promo_expires_at),
    giftOffered: !!guest.gift_offered,
  });

  const sent =
    template.channel === 'email'
      ? await sendPromoEmail(env, { to: guest.email, toName: guest.guest_name, subject: rendered.subject, html: rendered.body })
      : await sendTelegramMessage(env, { chatId: guest.telegram_chat_id, text: rendered.body });

  await env.DB.prepare(
    `INSERT INTO message_log (feedback_id, template_id, channel, sent_by, status, sent_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(params.id, template.id, template.channel, auth.username, sent ? 'success' : 'failed', new Date().toISOString())
    .run();

  return new Response(JSON.stringify({ ok: sent }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/customerSend.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/customers/\[id\]/send.js test/customerSend.test.js
git commit -m "feat: add manual message send from the customer detail view"
```

---

### Task 11: Users API — `GET /api/users`, `POST /api/users`

**Files:**
- Create: `functions/api/users/index.js`
- Test: `test/usersEndpoints.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/usersEndpoints.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listUsers, onRequestPost as createUser } from '../functions/api/users/index.js';
import { createSession, verifyPassword } from '../lib/auth.js';

let managerToken, receptionToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);
});

function authedRequest(url, token, method, body) {
  return new Request(url, { method, headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/users', () => {
  it('lets a manager list users without exposing password hashes', async () => {
    const response = await listUsers({ request: authedRequest('https://x/api/users', managerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(2);
    expect(body[0]).not.toHaveProperty('passwordHash');
    expect(body[0]).not.toHaveProperty('password_hash');
  });

  it('rejects a reception account (403)', async () => {
    const response = await listUsers({ request: authedRequest('https://x/api/users', receptionToken, 'GET'), env });
    expect(response.status).toBe(403);
  });
});

describe('POST /api/users', () => {
  it('lets a manager create a new account with a hashed password', async () => {
    const response = await createUser({ request: authedRequest('https://x/api/users', managerToken, 'POST', { username: 'le_tan_b', password: 'MatKhauManh123', role: 'reception' }), env });
    expect(response.status).toBe(201);

    const row = await env.DB.prepare(`SELECT password_hash AS passwordHash, role FROM staff_accounts WHERE username = 'le_tan_b'`).first();
    expect(row.role).toBe('reception');
    expect(row.passwordHash).not.toBe('MatKhauManh123');
    expect(await verifyPassword('MatKhauManh123', row.passwordHash)).toBe(true);
  });

  it('rejects a duplicate username (409)', async () => {
    const response = await createUser({ request: authedRequest('https://x/api/users', managerToken, 'POST', { username: 'quan_ly_a', password: 'x12345678', role: 'reception' }), env });
    expect(response.status).toBe(409);
  });

  it('rejects an invalid role', async () => {
    const response = await createUser({ request: authedRequest('https://x/api/users', managerToken, 'POST', { username: 'x', password: 'x12345678', role: 'admin' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a short password', async () => {
    const response = await createUser({ request: authedRequest('https://x/api/users', managerToken, 'POST', { username: 'x', password: '123', role: 'reception' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a reception account (403)', async () => {
    const response = await createUser({ request: authedRequest('https://x/api/users', receptionToken, 'POST', { username: 'x', password: 'x12345678', role: 'reception' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/users', { method: 'POST', headers: { Cookie: `session=${managerToken}` }, body: 'not json' });
    const response = await createUser({ request, env });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/usersEndpoints.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/users/index.js
import { requireAuth } from '../../../lib/requireAuth.js';
import { hashPassword } from '../../../lib/auth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    `SELECT id, username, role, created_at AS createdAt FROM staff_accounts ORDER BY username`
  ).all();

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { username, password, role } = body;

  if (typeof username !== 'string' || username.trim().length === 0) {
    return jsonError('Tên đăng nhập không được để trống', 400);
  }
  if (role !== 'manager' && role !== 'reception') {
    return jsonError('Vai trò phải là manager hoặc reception', 400);
  }
  if (typeof password !== 'string' || password.length < 8) {
    return jsonError('Mật khẩu phải có ít nhất 8 ký tự', 400);
  }

  const existing = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE username = ?`).bind(username).first();
  if (existing) {
    return jsonError('Tên đăng nhập đã tồn tại', 409);
  }

  const passwordHash = await hashPassword(password);
  const result = await env.DB.prepare(
    `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)`
  )
    .bind(username, passwordHash, role, new Date().toISOString())
    .run();

  return new Response(JSON.stringify({ id: result.meta.last_row_id }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/usersEndpoints.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/users/index.js test/usersEndpoints.test.js
git commit -m "feat: add GET/POST /api/users"
```

---

### Task 12: Users API — `DELETE /api/users/:id`, `PATCH /api/users/:id/role`

**Files:**
- Create: `functions/api/users/[id].js`
- Create: `functions/api/users/[id]/role.js`
- Test: `test/userManagement.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/userManagement.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestDelete as deleteUser } from '../functions/api/users/[id].js';
import { onRequestPatch as changeRole } from '../functions/api/users/[id]/role.js';
import { createSession } from '../lib/auth.js';

let managerAId, managerBId, receptionId, managerAToken, receptionToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');

  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const b = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_b', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const c = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerAId = a.meta.last_row_id;
  managerBId = b.meta.last_row_id;
  receptionId = c.meta.last_row_id;
  managerAToken = await createSession(env.DB, managerAId);
  receptionToken = await createSession(env.DB, receptionId);
});

function authedRequest(url, token, method, body) {
  return new Request(url, { method, headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}

describe('DELETE /api/users/:id', () => {
  it('lets a manager delete a reception account', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${receptionId}`, managerAToken, 'DELETE'), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(204);
  });

  it('rejects deleting your own account (400)', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerAId}`, managerAToken, 'DELETE'), env, params: { id: String(managerAId) } });
    expect(response.status).toBe(400);
  });

  it('deleting a manager always leaves at least one manager, since only a manager can delete another', async () => {
    // A deletes B: A can never delete itself, so the acting manager always remains — the
    // count can never reach zero this way. This is why DELETE needs no separate "last
    // manager" count guard; see the implementation note below Step 3 for the full argument.
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, managerAToken, 'DELETE'), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(204);

    const managerCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'manager'`).first();
    expect(managerCount.n).toBe(1);
  });

  it('rejects a reception account (403)', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, receptionToken, 'DELETE'), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/users/:id/role', () => {
  it('lets a manager change another account role', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${receptionId}/role`, managerAToken, 'PATCH', { role: 'manager' }), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT role FROM staff_accounts WHERE id = ?`).bind(receptionId).first();
    expect(row.role).toBe('manager');
  });

  it('rejects an invalid role value', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${receptionId}/role`, managerAToken, 'PATCH', { role: 'admin' }), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(400);
  });

  it('rejects demoting the last manager (400)', async () => {
    await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, managerAToken, 'DELETE'), env, params: { id: String(managerBId) } });
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${managerAId}/role`, managerAToken, 'PATCH', { role: 'reception' }), env, params: { id: String(managerAId) } });
    expect(response.status).toBe(400);
  });

  it('rejects a reception account (403)', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${managerBId}/role`, receptionToken, 'PATCH', { role: 'reception' }), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/userManagement.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/users/[id].js
import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  if (String(auth.staffId) === params.id) {
    return jsonError('Không thể tự xoá tài khoản của chính mình', 400);
  }

  const target = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE id = ?`).bind(params.id).first();
  if (!target) {
    return jsonError('Không tìm thấy tài khoản', 404);
  }

  await env.DB.prepare(`DELETE FROM staff_accounts WHERE id = ?`).bind(params.id).run();
  return new Response(null, { status: 204 });
}
```

*Implementation note:* unlike `PATCH /api/users/:id/role` (below), this endpoint has no separate "last manager" count guard. The self-delete check above already makes one unnecessary: to delete a manager account, the caller must themselves be an authenticated manager (the `requireAuth(..., ['manager'])` check), and the self-delete check guarantees the caller is never the target — so the calling manager always still exists after the deletion completes, and the manager count can never reach zero through this endpoint. Adding a count check on top would be dead code: it could only fire in a state (deleting the sole remaining manager) that this endpoint can never reach, since reaching it requires a second manager account to be doing the deleting. (`PATCH /role` doesn't have this same self-protection — a manager *can* demote themselves — which is why that endpoint's count guard is real and reachable.)

```js
// functions/api/users/[id]/role.js
import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { role } = body;
  if (role !== 'manager' && role !== 'reception') {
    return jsonError('Vai trò phải là manager hoặc reception', 400);
  }

  const target = await env.DB.prepare(`SELECT role FROM staff_accounts WHERE id = ?`).bind(params.id).first();
  if (!target) {
    return jsonError('Không tìm thấy tài khoản', 404);
  }

  if (target.role === 'manager' && role === 'reception') {
    const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'manager'`).first();
    if (n <= 1) {
      return jsonError('Không thể hạ quyền manager cuối cùng', 400);
    }
  }

  await env.DB.prepare(`UPDATE staff_accounts SET role = ? WHERE id = ?`).bind(role, params.id).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

*Note for the implementer:* `requireAuth`'s returned session object (see `lib/auth.js`'s `getSession`) has a `staffId` field — confirm `auth.staffId` is the correct property name by reading `lib/auth.js` before wiring the self-delete check; if it differs, use the actual field name instead of guessing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/userManagement.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/users/\[id\].js functions/api/users/\[id\]/role.js test/userManagement.test.js
git commit -m "feat: add user delete and role-change endpoints with last-manager guards"
```

---

### Task 13: Auth API — `POST /api/auth/change-password`

**Files:**
- Create: `functions/api/auth/change-password.js`
- Test: `test/changePassword.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/changePassword.test.js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as changePassword } from '../functions/api/auth/change-password.js';
import { createSession, hashPassword, verifyPassword } from '../lib/auth.js';

let sharedHash, token;

beforeAll(async () => {
  sharedHash = await hashPassword('MatKhauCu123');
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'le_tan_a', ?, 'reception', '2026-08-01T00:00:00Z')`).bind(sharedHash).run();
  token = await createSession(env.DB, 1);
});

function authedRequest(body) {
  return new Request('https://x/api/auth/change-password', { method: 'POST', headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/auth/change-password', () => {
  it('rejects unauthenticated requests', async () => {
    const request = new Request('https://x/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'a', newPassword: 'MatKhauMoi123' }) });
    const response = await changePassword({ request, env });
    expect(response.status).toBe(401);
  });

  it('changes the password when currentPassword is correct', async () => {
    const response = await changePassword({ request: authedRequest({ currentPassword: 'MatKhauCu123', newPassword: 'MatKhauMoi123' }), env });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT password_hash AS passwordHash FROM staff_accounts WHERE id = 1`).first();
    expect(await verifyPassword('MatKhauMoi123', row.passwordHash)).toBe(true);
  });

  it('rejects when currentPassword is wrong (400)', async () => {
    const response = await changePassword({ request: authedRequest({ currentPassword: 'sai-mat-khau', newPassword: 'MatKhauMoi123' }), env });
    expect(response.status).toBe(400);

    const row = await env.DB.prepare(`SELECT password_hash AS passwordHash FROM staff_accounts WHERE id = 1`).first();
    expect(await verifyPassword('MatKhauCu123', row.passwordHash)).toBe(true);
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const response = await changePassword({ request: authedRequest({ currentPassword: 'MatKhauCu123', newPassword: '123' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/auth/change-password', { method: 'POST', headers: { Cookie: `session=${token}` }, body: 'not json' });
    const response = await changePassword({ request, env });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/changePassword.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/auth/change-password.js
import { requireAuth } from '../../../lib/requireAuth.js';
import { hashPassword, verifyPassword } from '../../../lib/auth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, null);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { currentPassword, newPassword } = body;

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return jsonError('Mật khẩu mới phải có ít nhất 8 ký tự', 400);
  }

  const account = await env.DB.prepare(`SELECT password_hash AS passwordHash FROM staff_accounts WHERE id = ?`).bind(auth.staffId).first();
  if (!account || typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, account.passwordHash))) {
    return jsonError('Mật khẩu hiện tại không đúng', 400);
  }

  const newHash = await hashPassword(newPassword);
  await env.DB.prepare(`UPDATE staff_accounts SET password_hash = ? WHERE id = ?`).bind(newHash, auth.staffId).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/changePassword.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/auth/change-password.js test/changePassword.test.js
git commit -m "feat: add self-service password change endpoint"
```

---

### Task 14: Admin UI — `admin/templates.html` + `admin/templates.js`

**Files:**
- Create: `admin/templates.html`
- Create: `admin/templates.js`

**Interfaces:**
- Consumes: `GET/POST /api/templates`, `PUT/DELETE /api/templates/:id`, `POST /api/templates/:id/activate|deactivate` (Tasks 5-7).

- [ ] **Step 1: Write `admin/templates.html`**

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Kho template — Hiền Lê Garden CRM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="admin.css" />
</head>
<body>
  <div class="page">
    <h1>Kho template</h1>
    <nav>
      <a href="manager.html">Cấu hình &rarr;</a>
      <a href="customers.html">Danh sách khách hàng &rarr;</a>
      <a href="users.html">Quản lý user &rarr;</a>
    </nav>

    <h2>Tạo template mới</h2>
    <form id="templateForm">
      <label>Tên template <input type="text" name="name" required /></label>
      <label>Kênh
        <select name="channel" id="channelSelect">
          <option value="email">Email</option>
          <option value="telegram">Telegram</option>
        </select>
      </label>
      <label id="subjectLabel">Tiêu đề (email) <input type="text" name="subject" /></label>
      <label>Nội dung (dùng {guestName}, {promoCode}, {discountPercent}, {expiresAt}, {giftLine})
        <textarea name="body" rows="6" required></textarea>
      </label>
      <button type="submit">Lưu template</button>
      <button type="button" id="cancelEditBtn" hidden>Huỷ sửa</button>
      <p id="formError" class="error"></p>
    </form>

    <h2>Các template hiện có</h2>
    <p id="listError" class="error"></p>
    <div id="templateList"></div>
  </div>

  <script src="templates.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `admin/templates.js`**

```js
// admin/templates.js
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = 'login.html';
  }
})();

const channelSelect = document.getElementById('channelSelect');
const subjectLabel = document.getElementById('subjectLabel');

function updateSubjectVisibility() {
  subjectLabel.hidden = channelSelect.value !== 'email';
}
channelSelect.addEventListener('change', updateSubjectVisibility);
updateSubjectVisibility();

let templatesCache = [];
let editingId = null;

const templateForm = document.getElementById('templateForm');
const submitButton = templateForm.querySelector('button[type="submit"]');

function enterEditMode(template) {
  editingId = template.id;
  templateForm.name.value = template.name;
  templateForm.channel.value = template.channel;
  templateForm.subject.value = template.subject || '';
  templateForm.body.value = template.body;
  updateSubjectVisibility();
  submitButton.textContent = 'Cập nhật template';
  document.getElementById('cancelEditBtn').hidden = false;
}

function exitEditMode() {
  editingId = null;
  templateForm.reset();
  updateSubjectVisibility();
  submitButton.textContent = 'Lưu template';
  document.getElementById('cancelEditBtn').hidden = true;
}

document.getElementById('cancelEditBtn').addEventListener('click', exitEditMode);

async function loadTemplates() {
  const response = await fetch('/api/templates');
  const listError = document.getElementById('listError');
  listError.textContent = '';

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải danh sách template';
    return;
  }

  templatesCache = await response.json();
  const container = document.getElementById('templateList');
  container.innerHTML = '';

  templatesCache.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'table-scroll';
    card.style.marginBottom = '16px';
    card.innerHTML = `
      <p><strong>${t.name}</strong> — ${t.channel} — ${t.isActive ? '🟢 Active' : '⚪ Không active'}</p>
      <p style="font-size:0.85rem; opacity:0.8; white-space:pre-wrap;"></p>
      <button data-action="edit" data-id="${t.id}">Sửa</button>
      <button data-action="toggle" data-id="${t.id}" data-active="${t.isActive}">${t.isActive ? 'Tắt active' : 'Đặt làm active'}</button>
      <button data-action="delete" data-id="${t.id}" ${t.isActive ? 'disabled title="Không thể xoá template đang active"' : ''}>Xoá</button>
    `;
    card.querySelector('p:nth-of-type(2)').textContent = t.body;
    container.appendChild(card);
  });
}

templateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const errorEl = document.getElementById('formError');
  errorEl.textContent = '';

  const payload = {
    name: data.get('name'),
    channel: data.get('channel'),
    subject: data.get('subject'),
    body: data.get('body'),
  };

  const response = editingId
    ? await fetch(`/api/templates/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    : await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi lưu template';
    return;
  }

  exitEditMode();
  await loadTemplates();
});

document.getElementById('templateList').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id, active } = button.dataset;

  if (action === 'edit') {
    const template = templatesCache.find((t) => String(t.id) === id);
    if (template) enterEditMode(template);
  }

  if (action === 'toggle') {
    const endpoint = active === 'true' ? `/api/templates/${id}/deactivate` : `/api/templates/${id}/activate`;
    await fetch(endpoint, { method: 'POST' });
    await loadTemplates();
  }

  if (action === 'delete') {
    await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    await loadTemplates();
  }
});

loadTemplates();
```

Note for the implementer: the `GET /api/auth/me` login-guard block at the top of `admin/templates.js` mirrors the existing pattern already used in `admin/manager.js` and `admin/reception.js` — `functions/api/auth/me.js` already exists from an earlier session, no new endpoint is needed here.

- [ ] **Step 3: Manual verification**

Run `npm run dev` from `v4/`, log in as manager, visit `/admin/templates.html`, create a template, activate it, confirm the previously-active template on that channel shows "Không active", attempt to delete the now-active one (button should be disabled), click "Sửa" on a template and confirm the form pre-fills and updates it in place on submit, then "Huỷ sửa" and confirm the form clears back to create mode.

- [ ] **Step 4: Commit**

```bash
git add admin/templates.html admin/templates.js
git commit -m "feat: add template library admin page"
```

---

### Task 15: Admin UI — `admin/users.html` + `admin/users.js`

**Files:**
- Create: `admin/users.html`
- Create: `admin/users.js`

**Interfaces:**
- Consumes: `GET/POST /api/users`, `DELETE /api/users/:id`, `PATCH /api/users/:id/role` (Tasks 11-12).

- [ ] **Step 1: Write `admin/users.html`**

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Quản lý user — Hiền Lê Garden CRM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="admin.css" />
</head>
<body>
  <div class="page">
    <h1>Quản lý user</h1>
    <nav>
      <a href="manager.html">Cấu hình &rarr;</a>
      <a href="customers.html">Danh sách khách hàng &rarr;</a>
      <a href="templates.html">Kho template &rarr;</a>
    </nav>

    <h2>Tạo tài khoản mới</h2>
    <form id="userForm">
      <label>Tên đăng nhập <input type="text" name="username" required /></label>
      <label>Mật khẩu ban đầu <input type="password" name="password" minlength="8" required /></label>
      <label>Vai trò
        <select name="role">
          <option value="reception">Lễ tân</option>
          <option value="manager">Quản lý</option>
        </select>
      </label>
      <button type="submit">Tạo tài khoản</button>
      <p id="formError" class="error"></p>
    </form>

    <h2>Danh sách tài khoản</h2>
    <p id="listError" class="error"></p>
    <div class="table-scroll">
      <table id="userTable">
        <thead><tr><th>Tên đăng nhập</th><th>Vai trò</th><th>Ngày tạo</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>

  <script src="users.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `admin/users.js`**

```js
// admin/users.js
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = 'login.html';
    return;
  }
  const { username: currentUsername } = await res.json();
  window.__currentUsername = currentUsername;
})();

async function loadUsers() {
  const response = await fetch('/api/users');
  const listError = document.getElementById('listError');
  listError.textContent = '';

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải danh sách user';
    return;
  }

  const users = await response.json();
  const managerCount = users.filter((u) => u.role === 'manager').length;
  const tbody = document.querySelector('#userTable tbody');
  tbody.innerHTML = '';

  users.forEach((u) => {
    const isSelf = u.username === window.__currentUsername;
    const isLastManager = u.role === 'manager' && managerCount <= 1;
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = u.username;

    const tdRole = document.createElement('td');
    const roleSelect = document.createElement('select');
    ['reception', 'manager'].forEach((role) => {
      const opt = document.createElement('option');
      opt.value = role;
      opt.textContent = role === 'manager' ? 'Quản lý' : 'Lễ tân';
      opt.selected = role === u.role;
      roleSelect.appendChild(opt);
    });
    roleSelect.disabled = isLastManager;
    roleSelect.addEventListener('change', async () => {
      await fetch(`/api/users/${u.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleSelect.value }),
      });
      await loadUsers();
    });
    tdRole.appendChild(roleSelect);

    const tdCreated = document.createElement('td');
    tdCreated.textContent = new Date(u.createdAt).toLocaleDateString('vi-VN');

    const tdActions = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Xoá';
    deleteBtn.disabled = isSelf || isLastManager;
    if (isSelf) deleteBtn.title = 'Không thể tự xoá tài khoản của chính mình';
    if (isLastManager) deleteBtn.title = 'Không thể xoá manager cuối cùng';
    deleteBtn.addEventListener('click', async () => {
      await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
      await loadUsers();
    });
    tdActions.appendChild(deleteBtn);

    tr.append(tdName, tdRole, tdCreated, tdActions);
    tbody.appendChild(tr);
  });
}

document.getElementById('userForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const errorEl = document.getElementById('formError');
  errorEl.textContent = '';

  const response = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: data.get('username'), password: data.get('password'), role: data.get('role') }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tạo tài khoản';
    return;
  }

  event.target.reset();
  await loadUsers();
});

loadUsers();
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`, log in as manager, visit `/admin/users.html`, create a reception account, change its role to manager, confirm the delete button disables on your own row and re-enables/disables correctly as the manager count changes.

- [ ] **Step 4: Commit**

```bash
git add admin/users.html admin/users.js
git commit -m "feat: add user management admin page"
```

---

### Task 16: Admin UI — `admin/customers.html` + `admin/customers.js`

**Files:**
- Create: `admin/customers.html`
- Create: `admin/customers.js`
- Modify: `admin/admin.css` (add a `.page-wide` class for this table-heavy page)

**Interfaces:**
- Consumes: `GET /api/customers`, `GET /api/customers/:id`, `POST /api/customers/:id/send`, `GET /api/templates` (Tasks 5, 8-10).

- [ ] **Step 1: Add a wider page container to `admin/admin.css`**

Append:

```css
.page-wide {
  max-width: 900px;
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
}
.status-unused { background: rgba(120, 200, 140, 0.2); color: #7FD99A; }
.status-used { background: rgba(200, 200, 200, 0.15); color: #C9C9C9; }
.status-expired { background: rgba(220, 100, 100, 0.2); color: #ff8a8a; }

.filters {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.filters input, .filters select { width: auto; margin-top: 0; }

.pagination {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  align-items: center;
}
.pagination button { width: auto; padding: 8px 14px; }
```

- [ ] **Step 2: Write `admin/customers.html`**

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Danh sách khách hàng — Hiền Lê Garden CRM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="admin.css" />
</head>
<body>
  <div class="page page-wide">
    <h1>Danh sách khách hàng</h1>
    <nav>
      <a href="manager.html">Cấu hình &rarr;</a>
      <a href="templates.html">Kho template &rarr;</a>
      <a href="users.html">Quản lý user &rarr;</a>
    </nav>

    <div class="filters">
      <input type="search" id="searchInput" placeholder="Tìm tên / SĐT / mã..." />
      <select id="statusFilter">
        <option value="">Tất cả trạng thái</option>
        <option value="unused">Còn hạn</option>
        <option value="used">Đã dùng</option>
        <option value="expired">Hết hạn</option>
      </select>
    </div>

    <p id="listError" class="error"></p>
    <div class="table-scroll">
      <table id="customerTable">
        <thead><tr><th>Tên</th><th>SĐT</th><th>Sao</th><th>Mã KM</th><th>Giảm %</th><th>Trạng thái</th><th>Ngày gửi</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="pagination">
      <button id="prevPage">&larr; Trước</button>
      <span id="pageInfo"></span>
      <button id="nextPage">Sau &rarr;</button>
    </div>

    <div id="detailPanel" class="hidden">
      <h2>Chi tiết khách hàng</h2>
      <div id="detailContent"></div>
      <h2>Gửi tin nhắn</h2>
      <form id="sendForm">
        <label>Kênh
          <select id="sendChannel">
            <option value="email">Email</option>
            <option value="telegram">Telegram</option>
          </select>
        </label>
        <label>Template
          <select id="sendTemplate"></select>
        </label>
        <button type="submit">Gửi ngay</button>
        <p id="sendError" class="error"></p>
        <p id="sendSuccess" class="error" style="color:#7FD99A;"></p>
      </form>
      <h3>Lịch sử gửi tin</h3>
      <div id="messageHistory"></div>
    </div>
  </div>

  <script src="customers.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write `admin/customers.js`**

```js
// admin/customers.js
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = 'login.html';
  }
})();

let currentPage = 1;
const pageSize = 25;
let allTemplates = [];
let selectedFeedbackId = null;

const statusLabel = { unused: 'Còn hạn', used: 'Đã dùng', expired: 'Hết hạn' };

async function loadCustomers() {
  const search = document.getElementById('searchInput').value.trim();
  const status = document.getElementById('statusFilter').value;
  const params = new URLSearchParams({ page: String(currentPage), pageSize: String(pageSize) });
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const response = await fetch(`/api/customers?${params.toString()}`);
  const listError = document.getElementById('listError');
  listError.textContent = '';

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải danh sách khách hàng';
    return;
  }

  const { results, total } = await response.json();
  const tbody = document.querySelector('#customerTable tbody');
  tbody.innerHTML = '';

  results.forEach((c) => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td>${c.guestName}</td>
      <td>${c.phone}</td>
      <td>${c.rating}</td>
      <td>${c.promoCode}</td>
      <td>${c.discountPercent}%</td>
      <td><span class="status-badge status-${c.promoStatus}">${statusLabel[c.promoStatus]}</span></td>
      <td>${new Date(c.submittedAt).toLocaleDateString('vi-VN')}</td>
    `;
    tr.addEventListener('click', () => showDetail(c.feedbackId));
    tbody.appendChild(tr);
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  document.getElementById('pageInfo').textContent = `Trang ${currentPage}/${totalPages} (${total} khách)`;
  document.getElementById('prevPage').disabled = currentPage <= 1;
  document.getElementById('nextPage').disabled = currentPage >= totalPages;
}

document.getElementById('searchInput').addEventListener('input', () => { currentPage = 1; loadCustomers(); });
document.getElementById('statusFilter').addEventListener('change', () => { currentPage = 1; loadCustomers(); });
document.getElementById('prevPage').addEventListener('click', () => { currentPage -= 1; loadCustomers(); });
document.getElementById('nextPage').addEventListener('click', () => { currentPage += 1; loadCustomers(); });

async function loadTemplates() {
  const response = await fetch('/api/templates');
  if (response.ok) {
    allTemplates = await response.json();
  }
}

function refreshTemplateOptions(hasTelegramChatId) {
  const channelSelect = document.getElementById('sendChannel');
  const telegramOption = channelSelect.querySelector('option[value="telegram"]');
  telegramOption.disabled = !hasTelegramChatId;
  telegramOption.title = hasTelegramChatId ? '' : 'Khách chưa kết nối Telegram';
  if (!hasTelegramChatId && channelSelect.value === 'telegram') {
    channelSelect.value = 'email';
  }
  updateTemplateOptions();
}

function updateTemplateOptions() {
  const channel = document.getElementById('sendChannel').value;
  const templateSelect = document.getElementById('sendTemplate');
  templateSelect.innerHTML = '';
  allTemplates
    .filter((t) => t.channel === channel)
    .forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name + (t.isActive ? ' (active)' : '');
      templateSelect.appendChild(opt);
    });
}
document.getElementById('sendChannel').addEventListener('change', updateTemplateOptions);

async function showDetail(feedbackId) {
  selectedFeedbackId = feedbackId;
  const response = await fetch(`/api/customers/${feedbackId}`);
  if (!response.ok) return;
  const detail = await response.json();

  document.getElementById('detailPanel').hidden = false;
  document.getElementById('detailContent').innerHTML = `
    <p>Ghi chú trải nghiệm: ${detail.comment || '(không có)'}</p>
    <p>Ngày lưu trú: ${detail.stayDate || '(không có)'}</p>
    <p>Mong muốn lần sau: ${detail.wishesNextTime || '(không có)'}</p>
    <p>Hoạt động yêu thích: ${detail.favoriteActivities.join(', ') || '(không có)'}</p>
    <p>Quà tặng: ${detail.giftOffered ? (detail.giftClaimed ? 'Đã phát' : 'Chưa phát') : 'Không có'}</p>
  `;

  refreshTemplateOptions(detail.hasTelegramChatId);

  const history = document.getElementById('messageHistory');
  history.innerHTML = detail.messageHistory.length
    ? detail.messageHistory
        .map((h) => `<p>${new Date(h.sentAt).toLocaleString('vi-VN')} — ${h.channel} — ${h.templateName || '(template đã xoá)'} — ${h.status === 'success' ? '✅' : '❌'} — bởi ${h.sentBy}</p>`)
        .join('')
    : '<p>Chưa có tin nhắn nào được gửi.</p>';
}

document.getElementById('sendForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const sendError = document.getElementById('sendError');
  const sendSuccess = document.getElementById('sendSuccess');
  sendError.textContent = '';
  sendSuccess.textContent = '';

  const templateId = Number(document.getElementById('sendTemplate').value);
  const response = await fetch(`/api/customers/${selectedFeedbackId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    sendError.textContent = body.error || 'Có lỗi khi gửi tin nhắn';
    return;
  }

  const body = await response.json();
  sendSuccess.textContent = body.ok ? 'Đã gửi thành công!' : 'Gửi thất bại — kiểm tra lại kênh gửi.';
  await showDetail(selectedFeedbackId);
});

loadTemplates();
loadCustomers();
```

- [ ] **Step 4: Manual verification**

Run `npm run dev`, log in as reception, visit `/admin/customers.html`, search by a known phone number, filter by status, click a row to open detail + message history, send a message using an email template, confirm it appears in the history and the guest's real inbox receives it (or check server logs if `BREVO_API_KEY` isn't configured locally).

- [ ] **Step 5: Commit**

```bash
git add admin/customers.html admin/customers.js admin/admin.css
git commit -m "feat: add customer list admin page with search, filters, and manual send"
```

---

### Task 17: Shared change-password widget wired into every admin page

**Files:**
- Create: `admin/change-password.js`
- Modify: `admin/manager.html`, `admin/reception.html`, `admin/customers.html`, `admin/templates.html`, `admin/users.html` (add the change-password section + script include)

**Interfaces:**
- Consumes: `POST /api/auth/change-password` (Task 13) and `GET /api/auth/me` — both `functions/api/auth/me.js` and every admin page's login-guard (`fetch('/api/auth/me')` redirecting to `login.html` on 401) already exist from an earlier session and need no changes here.

- [ ] **Step 1: Write `admin/change-password.js`**

```js
// admin/change-password.js
function mountChangePasswordWidget() {
  const container = document.createElement('div');
  container.innerHTML = `
    <h2>Đổi mật khẩu</h2>
    <form id="changePasswordForm">
      <label>Mật khẩu hiện tại <input type="password" name="currentPassword" required /></label>
      <label>Mật khẩu mới <input type="password" name="newPassword" minlength="8" required /></label>
      <button type="submit">Đổi mật khẩu</button>
      <p id="changePasswordError" class="error"></p>
      <p id="changePasswordSuccess" class="error" style="color:#7FD99A;"></p>
    </form>
  `;
  document.querySelector('.page').appendChild(container);

  document.getElementById('changePasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const errorEl = document.getElementById('changePasswordError');
    const successEl = document.getElementById('changePasswordSuccess');
    errorEl.textContent = '';
    successEl.textContent = '';

    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || 'Có lỗi khi đổi mật khẩu';
      return;
    }

    event.target.reset();
    successEl.textContent = 'Đổi mật khẩu thành công.';
  });
}

mountChangePasswordWidget();
```

- [ ] **Step 2: Add `<script src="change-password.js"></script>` to every admin page**

Add this line right before `</body>` in `admin/manager.html`, `admin/reception.html`, `admin/customers.html`, `admin/templates.html`, and `admin/users.html` — after the page's own script tag, so `.page` already exists in the DOM when `mountChangePasswordWidget()` runs.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, log in, confirm a "Đổi mật khẩu" section appears at the bottom of every admin page, submit a wrong current password (see the specific error), then a correct one (see success), log out and back in with the new password.

- [ ] **Step 4: Commit**

```bash
git add admin/change-password.js admin/manager.html admin/reception.html admin/customers.html admin/templates.html admin/users.html
git commit -m "feat: add shared change-password widget to every admin page"
```

---

### Task 18: Playwright e2e coverage for the new admin flows

**Files:**
- Create: `tests/e2e/crm-customers.spec.js` (in the `hien-le-garden` root repo)
- Create: `tests/e2e/crm-templates.spec.js`
- Create: `tests/e2e/crm-users.spec.js`

**Interfaces:**
- Consumes: the `v4` Playwright project already configured in `playwright.config.js` (baseURL served from `v4/`); every new spec mocks `/api/*` calls via `page.route()`, following the exact pattern in `tests/e2e/crm-admin.spec.js`.

- [ ] **Step 1: Write `tests/e2e/crm-customers.spec.js`**

```js
// tests/e2e/crm-customers.spec.js
const { test, expect } = require('@playwright/test');

test.describe('CRM customer list', () => {
  test('lists customers, filters by search, and opens detail with send form', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'hienle', role: 'reception' }) }));
    await page.route('**/api/customers?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ feedbackId: 'fb-1', guestName: 'Nguyễn Văn A', phone: '0900000001', rating: 5, promoCode: 'HLG-AAAA', discountPercent: 10, promoStatus: 'unused', submittedAt: '2026-08-20T10:00:00Z' }],
          total: 1, page: 1, pageSize: 25,
        }),
      })
    );
    await page.route('**/api/customers/fb-1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          feedbackId: 'fb-1', comment: 'Rất tốt', stayDate: null, wishesNextTime: null, favoriteActivities: [],
          giftOffered: false, giftClaimed: false, hasTelegramChatId: false, messageHistory: [],
        }),
      })
    );
    await page.route('**/api/templates', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 1, name: 'Email mặc định', channel: 'email', isActive: true }]) })
    );

    await page.goto('/admin/customers.html');
    await expect(page.locator('#customerTable tbody tr')).toHaveCount(1);
    await page.click('#customerTable tbody tr');
    await expect(page.locator('#detailPanel')).toBeVisible();
    await expect(page.locator('#detailContent')).toContainText('Rất tốt');
  });

  test('redirects to login.html when not authenticated', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401 }));
    await page.goto('/admin/customers.html');
    await page.waitForURL('**/admin/login.html');
  });
});
```

- [ ] **Step 2: Write `tests/e2e/crm-templates.spec.js`**

```js
// tests/e2e/crm-templates.spec.js
const { test, expect } = require('@playwright/test');

test.describe('CRM template library', () => {
  test('creates a template and shows it in the list', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'Panther', role: 'manager' }) }));

    let created = false;
    await page.route('**/api/templates', (route) => {
      if (route.request().method() === 'POST') {
        created = true;
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 2 }) });
      }
      const list = created
        ? [{ id: 2, name: 'Lời cảm ơn', channel: 'email', body: 'x', isActive: false }]
        : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
    });

    await page.goto('/admin/templates.html');
    await page.fill('input[name="name"]', 'Lời cảm ơn');
    await page.fill('input[name="subject"]', 'Cảm ơn bạn');
    await page.fill('textarea[name="body"]', 'Xin chào {guestName}');
    await page.click('button[type="submit"]');

    await expect(page.locator('#templateList')).toContainText('Lời cảm ơn');
  });

  test('redirects to login.html when not authenticated', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401 }));
    await page.goto('/admin/templates.html');
    await page.waitForURL('**/admin/login.html');
  });
});
```

- [ ] **Step 3: Write `tests/e2e/crm-users.spec.js`**

```js
// tests/e2e/crm-users.spec.js
const { test, expect } = require('@playwright/test');

test.describe('CRM user management', () => {
  test('creates a user and shows it in the list', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'Panther', role: 'manager' }) }));

    let created = false;
    await page.route('**/api/users', (route) => {
      if (route.request().method() === 'POST') {
        created = true;
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 2 }) });
      }
      const list = [
        { id: 1, username: 'Panther', role: 'manager', createdAt: '2026-08-01T00:00:00Z' },
        ...(created ? [{ id: 2, username: 'hienle2', role: 'reception', createdAt: '2026-08-20T00:00:00Z' }] : []),
      ];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
    });

    await page.goto('/admin/users.html');
    await page.fill('input[name="username"]', 'hienle2');
    await page.fill('input[name="password"]', 'MatKhauManh123');
    await page.click('button[type="submit"]');

    await expect(page.locator('#userTable tbody')).toContainText('hienle2');
  });

  test('disables delete on your own row', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'Panther', role: 'manager' }) }));
    await page.route('**/api/users', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 1, username: 'Panther', role: 'manager', createdAt: '2026-08-01T00:00:00Z' }]) })
    );

    await page.goto('/admin/users.html');
    await expect(page.locator('#userTable tbody tr button')).toBeDisabled();
  });

  test('redirects to login.html when not authenticated', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401 }));
    await page.goto('/admin/users.html');
    await page.waitForURL('**/admin/login.html');
  });
});
```

- [ ] **Step 4: Run the full v4 Playwright project**

Run (from the `hien-le-garden` repo root): `npx playwright test --project=v4` — Expected: all pass, including the 3 new spec files.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/crm-customers.spec.js tests/e2e/crm-templates.spec.js tests/e2e/crm-users.spec.js
git commit -m "test: add e2e coverage for customer list, template library, and user management"
```

---

## After all tasks: one-time production step (not part of any task, do once after merge)

```bash
wrangler d1 migrations apply hien_le_garden_crm --remote
```

This applies `0003_templates_and_logging.sql` to the real database, seeding the two default active templates so guest-facing automatic sends keep working unchanged.
