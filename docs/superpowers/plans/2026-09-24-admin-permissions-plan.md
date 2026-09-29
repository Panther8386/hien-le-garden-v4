# Phân quyền chi tiết cho admin — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay kiểm tra quyền theo danh sách vai trò viết cứng bằng mã quyền; bảng quyền vai trò + chỉnh riêng từng user lưu trong D1; khoá tạm tài khoản; trang Phân quyền mới.

**Architecture:** `lib/permissions.js` định nghĩa danh mục mã quyền và hàm tính quyền thực tế. Migration `0042` tạo `role_permissions`, `user_permission_overrides`, cột khoá, seed mặc định bằng đúng hành vi hiện tại và chuyển 4 cờ cũ thành override. `getSession` nạp quyền trong một truy vấn; `requireAuth(request, env, 'mã.quyền')` kiểm tra. Các API được chuyển đổi theo nhóm; trong lúc chuyển, `requireAuth` tạm chấp nhận cả mảng role cũ, task cuối bỏ hẳn. Frontend đọc `permissions` từ `/api/auth/me`.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), Vitest + `@cloudflare/vitest-pool-workers`, JS thuần ở `admin/`.

**Spec:** `docs/superpowers/specs/2026-09-24-admin-permissions-design.md` — đọc mục 3 (danh mục + mặc định), 4 (ánh xạ API), 7 (quy tắc an toàn) trước khi làm bất kỳ task nào.

## Global Constraints

- Nhánh làm việc: `admin-redesign`. Không push, không merge vào `main` (push `main` = deploy production).
- **Chạy test:** trên máy Windows này `npm test` (cả bộ) crash hạ tầng 40/40 lần (2026-09-24) — không dùng. Task 1 thêm `npm run test:each` (`scripts/test-each.js`): chạy từng file, chỉ chạy lại file khi crash hạ tầng (không có dòng `N failed`), dừng ở lỗi assertion thật. Một hoặc vài file: `npm run test:each -- test/a.test.js test/b.test.js`. "Chạy toàn bộ test" trong kế hoạch = `npm run test:each`; đạt khi `fail=0`. File `CRASH` sau đủ số lần thử: chạy lại riêng file đó cho tới khi có kết quả thật (pass hoặc fail) — không được coi `CRASH` là pass.
- **Mốc trước khi làm (2026-09-24, nhánh `admin-redesign` @ `06e0319`):** 70 file; 64 pass (985 test), 0 fail, 6 crash hạ tầng dù đã thử 8 lần (`assetInventoryBatches`, `assetInventoryLines`, `assetPhotos`, `dineInOrders`, `financeAttachments`, `migrations`) — chạy riêng lại thì pass (ví dụ `dineInOrders` 45/45). Không có test đỏ từ trước.
- Thông báo lỗi API bằng tiếng Việt, dạng `{ error: '...' }`, giữ nguyên thông báo hiện có: 401 `Chưa đăng nhập`, 403 `Không đủ quyền`.
- Quản trị (`admin`) luôn có mọi quyền, không có override.
- Mọi thay đổi quyền/khoá ghi `audit_log` với các `action_type`: `role_permissions_change`, `user_permissions_change`, `account_lock`, `account_unlock`.
- Test mỗi file dùng storage cô lập theo test (mặc định của pool-workers): sửa `role_permissions` trong một test không ảnh hưởng test khác.
- Không đổi giao diện chung (phần 2 làm sau). Trang Phân quyền (Task 10) dùng token màu phần 2 trong file CSS riêng `admin/users.css`.
- Commit sau mỗi task, message kiểu `feat(permissions): ...`, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **User đổi vai trò khi đang có override** — mong đợi: override bị xoá, quyền = đúng vai trò mới (không mang quyền xoá tài sản sang người quan sát). Test ở Task 9.
2. **Người quan sát mở trang Vận hành** — mọi API mà `admin/reception.js` gọi khi tải trang phải trả 200 cho người quan sát (rooms, bookings, reminders, catalog, dine-in-menu, holidays, cancellation-policy, layout-log). Test ở Task 8.
3. **Phiên đang mở của tài khoản vừa bị khoá** — request tiếp theo phải 401, không đợi hết hạn phiên. Test ở Task 3 và Task 9.
4. **Quản lý tự nâng quyền** — quản lý gán vai trò admin, `grant` quyền mình không có, sửa override của chính mình, sửa tài khoản admin: đều bị chặn. Test ở Task 9.
5. **Bảng quyền vai trò nhận mã quyền không tồn tại hoặc vai trò `admin`** — 400, không ghi gì. Test ở Task 9.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `lib/permissions.js` (mới) | Danh mục quyền (nhóm, nhãn), `ROLE_DEFAULTS`, `effectivePermissions`, `hasPermission`, `isValidPermission` |
| `migrations/0042_permissions.sql` (mới) | Bảng quyền, cột khoá, seed, chuyển cờ cũ |
| `lib/auth.js` | `getSession` nạp quyền + loại tài khoản bị khoá |
| `lib/requireAuth.js` | Kiểm tra mã quyền |
| `test/helpers/permissions.js` (mới) | `setOverride(db, staffId, key, effect)` cho test |
| `functions/api/**` | Đổi tham số `requireAuth` + nhánh `role ===` bên trong theo spec mục 4 |
| `functions/api/permissions.js`, `functions/api/roles/[role]/permissions.js`, `functions/api/users/[id]/permissions.js`, `functions/api/users/[id]/lock.js`, `functions/api/users/[id]/unlock.js` (mới) | API quản lý quyền |
| `lib/staffGuards.js` (mới) | Quy tắc an toàn dùng chung cho API user (admin cuối, tự sửa mình, sửa admin) |
| `admin/nav-drawer.js` | Menu theo quyền + chặn truy cập trang |
| `admin/*.js` | Đổi `currentRole` sang `can('...')` |
| `admin/users.html`, `admin/users.js`, `admin/users.css` | Trang Phân quyền mới |
| `admin/audit-log.js` | Nhãn action mới |
| `_redirects` | Đủ trang cho cả 3 tiền tố |

---

### Task 1: Danh mục quyền `lib/permissions.js`

**Files:**
- Create: `scripts/test-each.js`; Modify: `package.json` (thêm script `test:each`)
- Create: `lib/permissions.js`
- Test: `test/permissions.test.js`

**Interfaces:**
- Produces:
  - `PERMISSION_GROUPS: Array<{ label: string, permissions: Array<{ key: string, label: string }> }>`
  - `PERMISSION_KEYS: string[]`
  - `EDITABLE_ROLES: ['reception', 'manager', 'observer']`
  - `ROLE_DEFAULTS: { reception: string[], manager: string[], observer: string[] }`
  - `isValidPermission(key: string): boolean`
  - `effectivePermissions(role: string, rolePermissions: string[], overrides: Array<{ permission: string, effect: 'grant'|'deny' }>): Set<string>`
  - `hasPermission(auth: { permissions: Set<string> }, key: string): boolean`

- [ ] **Step 0: Thêm script chạy test từng file**

```js
// scripts/test-each.js
// Chạy từng file Vitest riêng, chỉ chạy lại một file khi gặp crash hạ tầng
// Windows (không có dòng "failed" — xem scripts/test-with-retry.js). Lỗi
// assertion thật báo ngay. Dùng: npm run test:each [-- test/a.test.js ...]
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const MAX_ATTEMPTS = 15;
const REAL_FAILURE = /(Tests|Test Files)\s+\d+\s+failed/;
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);

const counts = { pass: 0, fail: 0, crash: 0 };
for (const file of files) {
  let outcome = 'crash';
  let detail = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = spawnSync('npx', ['vitest', 'run', file], { shell: true, encoding: 'utf8' });
    const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
    if (REAL_FAILURE.test(out)) {
      outcome = 'fail';
      detail = '\n' + out.split('\n').filter((l) => /FAIL|×|AssertionError|Error:/.test(l)).slice(0, 15).join('\n');
      break;
    }
    if (r.status === 0 && /Tests\s+\d+\s+passed/.test(out)) {
      outcome = 'pass';
      detail = `(${out.match(/Tests\s+(\d+)\s+passed/)[1]} tests, attempt ${attempt})`;
      break;
    }
  }
  counts[outcome]++;
  console.log(`${outcome.toUpperCase()} ${file} ${detail}`);
}
console.log(`\nSUMMARY pass=${counts.pass} fail=${counts.fail} crash=${counts.crash} total=${files.length}`);
process.exit(counts.fail || counts.crash ? 1 : 0);
```

`package.json` → `"scripts"` thêm `"test:each": "node scripts/test-each.js",`.

Kiểm tra: `npm run test:each -- test/usersEndpoints.test.js` → `PASS test/usersEndpoints.test.js (11 tests, ...)`, `SUMMARY pass=1 fail=0 crash=0`.

- [ ] **Step 1: Viết test**

```js
// test/permissions.test.js
import { describe, it, expect } from 'vitest';
import { PERMISSION_KEYS, ROLE_DEFAULTS, EDITABLE_ROLES, isValidPermission, effectivePermissions, hasPermission } from '../lib/permissions.js';

describe('permission catalog', () => {
  it('has 38 unique keys matching the spec table', () => {
    expect(PERMISSION_KEYS.length).toBe(38);
    expect(new Set(PERMISSION_KEYS).size).toBe(38);
  });

  it('only uses valid keys in role defaults', () => {
    for (const role of EDITABLE_ROLES) {
      for (const key of ROLE_DEFAULTS[role]) expect(isValidPermission(key)).toBe(true);
    }
  });

  it('gives observer only today-ops view and finance income view', () => {
    expect([...ROLE_DEFAULTS.observer].sort()).toEqual(['bookings.view', 'finance.view_income']);
  });

  it('rejects unknown keys', () => {
    expect(isValidPermission('bookings.fly')).toBe(false);
  });
});

describe('effectivePermissions', () => {
  it('gives admin every key regardless of inputs', () => {
    const set = effectivePermissions('admin', [], [{ permission: 'bookings.view', effect: 'deny' }]);
    expect(set.size).toBe(PERMISSION_KEYS.length);
  });

  it('adds grants and removes denies on top of the role set', () => {
    const set = effectivePermissions('reception', ['bookings.view', 'bookings.manage'], [
      { permission: 'assets.delete', effect: 'grant' },
      { permission: 'bookings.manage', effect: 'deny' },
    ]);
    expect([...set].sort()).toEqual(['assets.delete', 'bookings.view']);
  });

  it('treats a grant of a permission the role already has as a no-op', () => {
    const set = effectivePermissions('manager', ['finance.create'], [{ permission: 'finance.create', effect: 'grant' }]);
    expect([...set]).toEqual(['finance.create']);
  });

  it('ignores unknown keys stored in the database', () => {
    const set = effectivePermissions('reception', ['bookings.view', 'old.key'], [{ permission: 'gone.key', effect: 'grant' }]);
    expect([...set]).toEqual(['bookings.view']);
  });
});

describe('hasPermission', () => {
  it('reads the Set on the auth object', () => {
    expect(hasPermission({ permissions: new Set(['a.b']) }, 'a.b')).toBe(true);
    expect(hasPermission({ permissions: new Set() }, 'a.b')).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npm run test:each -- test/permissions.test.js` → FAIL (không tìm thấy module).

- [ ] **Step 3: Viết `lib/permissions.js`**

```js
// lib/permissions.js
// Danh mục mã quyền. Nguồn sự thật lúc chạy là bảng role_permissions +
// user_permission_overrides trong D1; file này định nghĩa mã nào hợp lệ,
// nhãn hiển thị, và mặc định dùng để seed (migration 0042) + test.

export const PERMISSION_GROUPS = [
  { label: 'Vận hành & đặt phòng', permissions: [
    { key: 'bookings.view', label: 'Xem đặt phòng, sơ đồ phòng, nhắc việc' },
    { key: 'bookings.manage', label: 'Tạo / sửa / xác nhận / nhận-trả phòng / huỷ, dịch vụ, thêm cọc, đánh dấu đã dọn' },
    { key: 'bookings.edit_paid_service', label: 'Sửa / xoá dịch vụ đã thanh toán' },
    { key: 'bookings.deposit_delete', label: 'Xoá cọc' },
    { key: 'rooms.layout', label: 'Sắp xếp sơ đồ phòng' },
    { key: 'guests.contact_view', label: 'Xem SĐT / email khách' },
    { key: 'promo.redeem', label: 'Tra mã ưu đãi, đổi mã, nhận quà' },
    { key: 'records.hide', label: 'Ẩn bản ghi khỏi lịch sử, xem bản ghi đã ẩn' },
  ] },
  { label: 'Order ăn uống', permissions: [
    { key: 'dine_in.view', label: 'Xem order' },
    { key: 'dine_in.manage', label: 'Tạo / thêm món / đóng / huỷ order' },
  ] },
  { label: 'Giờ Xanh', permissions: [
    { key: 'gio_xanh.view', label: 'Xem phiên' },
    { key: 'gio_xanh.manage', label: 'Tạo / thêm món / đóng / huỷ phiên' },
  ] },
  { label: 'Khách hàng', permissions: [
    { key: 'customers.view', label: 'Xem danh sách & chi tiết khách' },
    { key: 'customers.send', label: 'Gửi tin nhắn cho khách' },
    { key: 'templates.view', label: 'Xem template tin nhắn' },
    { key: 'templates.manage', label: 'Tạo / sửa / bật-tắt template' },
    { key: 'promo_config.view', label: 'Xem cấu hình khuyến mãi, kho quà, thông báo' },
    { key: 'promo_config.manage', label: 'Sửa cấu hình khuyến mãi, kho quà' },
  ] },
  { label: 'Tài chính', permissions: [
    { key: 'dashboard.view', label: 'Xem tổng quan số liệu' },
    { key: 'finance.view_income', label: 'Xem sổ thu chi — phần thu' },
    { key: 'finance.view_all', label: 'Xem toàn bộ sổ thu chi (phần chi, cân đối, biểu đồ)' },
    { key: 'finance.create', label: 'Thêm giao dịch' },
    { key: 'finance.manage', label: 'Sửa / huỷ giao dịch, chứng từ, số dư đầu kỳ' },
  ] },
  { label: 'Kho & tài sản', permissions: [
    { key: 'assets.view', label: 'Xem tài sản, kho, kiểm kê, hồ sơ nguồn' },
    { key: 'assets.count', label: 'Kiểm kê, ghi phiếu kho' },
    { key: 'assets.manage', label: 'Tạo / sửa tài sản, mở-chốt đợt kiểm kê, đối soát' },
    { key: 'assets.delete', label: 'Xoá tài sản' },
    { key: 'assets.config', label: 'Danh mục, vị trí, lô thực phẩm' },
  ] },
  { label: 'Cài đặt', permissions: [
    { key: 'settings.view', label: 'Xem trang Phòng & giá, Bảng giá dịch vụ, Chính sách hoàn cọc' },
    { key: 'settings.rooms', label: 'Sửa giá phòng, ngày lễ' },
    { key: 'settings.catalog', label: 'Sửa bảng giá dịch vụ, khung giờ, cài đặt đặt trải nghiệm' },
    { key: 'settings.dine_in_menu', label: 'Sửa menu quán' },
    { key: 'settings.cancellation_policy', label: 'Sửa chính sách hoàn cọc' },
    { key: 'settings.finance_categories', label: 'Sửa danh mục thu chi' },
    { key: 'settings.reminders', label: 'Sửa ngưỡng nhắc việc' },
    { key: 'audit.view', label: 'Xem nhật ký thao tác' },
    { key: 'users.manage', label: 'Quản lý tài khoản, khoá tạm, chỉnh quyền riêng' },
    { key: 'users.security', label: 'Đặt lại mật khẩu, tắt 2FA của người khác' },
  ] },
];

export const PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
const KEY_SET = new Set(PERMISSION_KEYS);

export const EDITABLE_ROLES = ['reception', 'manager', 'observer'];

const RECEPTION = [
  'bookings.view', 'bookings.manage', 'guests.contact_view', 'promo.redeem',
  'dine_in.view', 'dine_in.manage', 'gio_xanh.view', 'gio_xanh.manage',
  'customers.view', 'customers.send', 'templates.view', 'promo_config.view',
  'assets.view', 'assets.count', 'settings.view',
];

export const ROLE_DEFAULTS = {
  reception: RECEPTION,
  manager: [
    ...RECEPTION,
    'templates.manage', 'promo_config.manage', 'dashboard.view',
    'finance.view_income', 'finance.view_all', 'finance.create', 'finance.manage',
    'assets.manage', 'audit.view', 'users.manage',
  ],
  observer: ['bookings.view', 'finance.view_income'],
};

export function isValidPermission(key) {
  return KEY_SET.has(key);
}

export function effectivePermissions(role, rolePermissions, overrides) {
  if (role === 'admin') return new Set(PERMISSION_KEYS);
  const set = new Set(rolePermissions.filter(isValidPermission));
  for (const { permission, effect } of overrides) {
    if (!isValidPermission(permission)) continue;
    if (effect === 'grant') set.add(permission);
    else if (effect === 'deny') set.delete(permission);
  }
  return set;
}

export function hasPermission(auth, key) {
  return auth.permissions.has(key);
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npm run test:each -- test/permissions.test.js` → PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/test-each.js package.json lib/permissions.js test/permissions.test.js
git commit -m "feat(permissions): add permission catalog and effective-permission logic"
```

---

### Task 2: Migration `0042_permissions.sql`

**Files:**
- Create: `migrations/0042_permissions.sql`
- Test: `test/permissionsMigration.test.js`

**Interfaces:**
- Consumes: `ROLE_DEFAULTS`, `EDITABLE_ROLES` (Task 1) — chỉ trong test, để đối chiếu seed.
- Produces: bảng `role_permissions(role, permission)`, `user_permission_overrides(staff_id, permission, effect)`, cột `staff_accounts.locked_at`, `staff_accounts.locked_by`.

- [ ] **Step 1: Viết test**

`env.TEST_MIGRATIONS` là mảng `{ name, queries: string[] }` do `readD1Migrations` tạo; test dùng nó để chạy lại đúng các câu chuyển cờ của migration trên dữ liệu test.

```js
// test/permissionsMigration.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ROLE_DEFAULTS, EDITABLE_ROLES } from '../lib/permissions.js';

function flagConversionQueries() {
  const mig = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0042_'));
  return mig.queries.filter((q) => q.trim().startsWith('INSERT INTO user_permission_overrides'));
}

describe('0042_permissions seed', () => {
  it('seeds role_permissions exactly equal to ROLE_DEFAULTS', async () => {
    const { results } = await env.DB.prepare('SELECT role, permission FROM role_permissions').all();
    for (const role of EDITABLE_ROLES) {
      const seeded = results.filter((r) => r.role === role).map((r) => r.permission).sort();
      expect(seeded).toEqual([...ROLE_DEFAULTS[role]].sort());
    }
    expect(results.some((r) => r.role === 'admin')).toBe(false);
  });

  it('adds nullable lock columns', async () => {
    const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('m42', 'x', 'reception', '2026-09-24T00:00:00Z')`).run();
    const row = await env.DB.prepare('SELECT locked_at, locked_by FROM staff_accounts WHERE id = ?').bind(r.meta.last_row_id).first();
    expect(row).toEqual({ locked_at: null, locked_by: null });
  });
});

describe('0042_permissions legacy flag conversion', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM user_permission_overrides');
    await env.DB.exec('DELETE FROM staff_accounts');
    await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at, can_manage_room_layout, can_add_finance_transaction, can_delete_asset, can_delete_deposit)
      VALUES (1, 'lt', 'x', 'reception', '2026-09-24T00:00:00Z', 1, 1, 1, 1),
             (2, 'ql', 'x', 'manager', '2026-09-24T00:00:00Z', 1, 1, 1, 1),
             (3, 'qs', 'x', 'observer', '2026-09-24T00:00:00Z', 1, 1, 1, 1),
             (4, 'qt', 'x', 'admin', '2026-09-24T00:00:00Z', 1, 1, 1, 1),
             (5, 'lt0', 'x', 'reception', '2026-09-24T00:00:00Z', 0, 0, 0, 0)`).run();
    for (const q of flagConversionQueries()) await env.DB.prepare(q).run();
  });

  async function grantsFor(id) {
    const { results } = await env.DB.prepare(`SELECT permission, effect FROM user_permission_overrides WHERE staff_id = ? ORDER BY permission`).bind(id).all();
    return results;
  }

  it('turns all four flags into grants for reception', async () => {
    expect(await grantsFor(1)).toEqual([
      { permission: 'assets.delete', effect: 'grant' },
      { permission: 'bookings.deposit_delete', effect: 'grant' },
      { permission: 'finance.create', effect: 'grant' },
      { permission: 'rooms.layout', effect: 'grant' },
    ]);
  });

  it('skips finance.create for manager (role already has it)', async () => {
    expect((await grantsFor(2)).map((g) => g.permission)).toEqual(['assets.delete', 'bookings.deposit_delete', 'rooms.layout']);
  });

  it('skips observer and admin, and users with no flags', async () => {
    expect(await grantsFor(3)).toEqual([]);
    expect(await grantsFor(4)).toEqual([]);
    expect(await grantsFor(5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL** — `npm run test:each -- test/permissionsMigration.test.js` → FAIL (`no such table: role_permissions`).

- [ ] **Step 3: Viết migration**

Mỗi câu `INSERT INTO user_permission_overrides` phải nằm trên **một** câu lệnh riêng bắt đầu đúng bằng chuỗi đó (test lọc theo tiền tố).

```sql
-- migrations/0042_permissions.sql
-- Phân quyền theo mã quyền: bảng quyền vai trò (chỉnh được), chỉnh riêng
-- từng user, khoá tạm tài khoản. Seed = đúng hành vi trước migration, trừ
-- observer bị siết còn bookings.view + finance.view_income. Admin không có
-- dòng nào: code luôn cho admin mọi quyền.

CREATE TABLE role_permissions (
  role TEXT NOT NULL CHECK (role IN ('reception', 'manager', 'observer')),
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

CREATE TABLE user_permission_overrides (
  staff_id INTEGER NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('grant', 'deny')),
  PRIMARY KEY (staff_id, permission)
);

ALTER TABLE staff_accounts ADD COLUMN locked_at TEXT;
ALTER TABLE staff_accounts ADD COLUMN locked_by TEXT;

INSERT INTO role_permissions (role, permission) VALUES
  ('reception', 'bookings.view'), ('reception', 'bookings.manage'), ('reception', 'guests.contact_view'), ('reception', 'promo.redeem'),
  ('reception', 'dine_in.view'), ('reception', 'dine_in.manage'), ('reception', 'gio_xanh.view'), ('reception', 'gio_xanh.manage'),
  ('reception', 'customers.view'), ('reception', 'customers.send'), ('reception', 'templates.view'), ('reception', 'promo_config.view'),
  ('reception', 'assets.view'), ('reception', 'assets.count'), ('reception', 'settings.view'),
  ('manager', 'bookings.view'), ('manager', 'bookings.manage'), ('manager', 'guests.contact_view'), ('manager', 'promo.redeem'),
  ('manager', 'dine_in.view'), ('manager', 'dine_in.manage'), ('manager', 'gio_xanh.view'), ('manager', 'gio_xanh.manage'),
  ('manager', 'customers.view'), ('manager', 'customers.send'), ('manager', 'templates.view'), ('manager', 'promo_config.view'),
  ('manager', 'assets.view'), ('manager', 'assets.count'), ('manager', 'settings.view'),
  ('manager', 'templates.manage'), ('manager', 'promo_config.manage'), ('manager', 'dashboard.view'),
  ('manager', 'finance.view_income'), ('manager', 'finance.view_all'), ('manager', 'finance.create'), ('manager', 'finance.manage'),
  ('manager', 'assets.manage'), ('manager', 'audit.view'), ('manager', 'users.manage'),
  ('observer', 'bookings.view'), ('observer', 'finance.view_income');

INSERT INTO user_permission_overrides (staff_id, permission, effect) SELECT id, 'rooms.layout', 'grant' FROM staff_accounts WHERE can_manage_room_layout = 1 AND role IN ('reception', 'manager');
INSERT INTO user_permission_overrides (staff_id, permission, effect) SELECT id, 'finance.create', 'grant' FROM staff_accounts WHERE can_add_finance_transaction = 1 AND role = 'reception';
INSERT INTO user_permission_overrides (staff_id, permission, effect) SELECT id, 'assets.delete', 'grant' FROM staff_accounts WHERE can_delete_asset = 1 AND role IN ('reception', 'manager');
INSERT INTO user_permission_overrides (staff_id, permission, effect) SELECT id, 'bookings.deposit_delete', 'grant' FROM staff_accounts WHERE can_delete_deposit = 1 AND role IN ('reception', 'manager');
```

- [ ] **Step 4: Chạy test, xác nhận PASS** — `npm run test:each -- test/permissionsMigration.test.js test/migrations.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations/0042_permissions.sql test/permissionsMigration.test.js
git commit -m "feat(permissions): add role/user permission tables, lock columns, legacy flag conversion"
```

---

### Task 3: Phiên đăng nhập mang quyền, `requireAuth` theo mã quyền, khoá chặn đăng nhập

**Files:**
- Modify: `lib/auth.js` (`getSession`, dòng ~88-101)
- Modify: `lib/requireAuth.js`
- Modify: `functions/api/auth/me.js`, `functions/api/auth/login.js`, `functions/api/auth/verify-2fa.js`
- Create: `test/helpers/permissions.js`
- Modify tests đang bật cờ cũ bằng SQL: `test/assets.test.js` (dòng ~230-302), `test/auth.test.js:45`, `test/authMeEndpoint.test.js:20-27`, `test/bookingsEndpoints.test.js` (dòng ~359, 540, 627), `test/financeTransactions.test.js:56-70`, và mọi chỗ khác mà `grep -n "can_manage_room_layout\|can_add_finance_transaction\|can_delete_asset\|can_delete_deposit" test/*.js` tìm thấy **ngoài** `test/migrations.test.js`, `test/roomLayoutSchema.test.js`, `test/permissionsMigration.test.js`, `test/userManagement.test.js` (file này viết lại ở Task 9).
- Test: `test/authPermissions.test.js` (mới)

**Interfaces:**
- Consumes: `effectivePermissions` (Task 1), bảng Task 2.
- Produces:
  - `getSession(db, token)` → `null` | `{ staffId, username, role, totpEnabled, permissions: Set<string>, canManageRoomLayout, canAddFinanceTransaction, canDeleteAsset, canDeleteDeposit }`. 4 trường `can*` **tạm thời** suy ra từ `permissions` (`rooms.layout`, `finance.create`, `assets.delete`, `bookings.deposit_delete`) để API chưa chuyển vẫn chạy; Task 11 xoá.
  - `requireAuth(request, env, required)` với `required`: `undefined`/`null` (chỉ cần đăng nhập), `string` (mã quyền), hoặc tạm thời `string[]` (vai trò cũ).
  - `GET /api/auth/me` thêm `permissions: string[]` (đã sắp xếp).
  - `test/helpers/permissions.js`: `setOverride(db, staffId, permission, effect = 'grant')`, `setRolePermissions(db, role, permissions)`.

- [ ] **Step 1: Viết helper test**

```js
// test/helpers/permissions.js
export async function setOverride(db, staffId, permission, effect = 'grant') {
  await db.prepare(
    `INSERT INTO user_permission_overrides (staff_id, permission, effect) VALUES (?, ?, ?)
     ON CONFLICT (staff_id, permission) DO UPDATE SET effect = excluded.effect`
  ).bind(staffId, permission, effect).run();
}

export async function setRolePermissions(db, role, permissions) {
  await db.prepare('DELETE FROM role_permissions WHERE role = ?').bind(role).run();
  for (const p of permissions) {
    await db.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)').bind(role, p).run();
  }
}
```

- [ ] **Step 2: Viết test mới**

```js
// test/authPermissions.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getSession, createSession, hashPassword } from '../lib/auth.js';
import { requireAuth } from '../lib/requireAuth.js';
import { onRequestGet as me } from '../functions/api/auth/me.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { PERMISSION_KEYS } from '../lib/permissions.js';
import { setOverride, setRolePermissions } from './helpers/permissions.js';

let receptionId, adminId, observerId;
beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  const hash = await hashPassword('s3cret-pass');
  receptionId = (await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('lt', ?, 'reception', '2026-09-24T00:00:00Z')`).bind(hash).run()).meta.last_row_id;
  adminId = (await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('qt', ?, 'admin', '2026-09-24T00:00:00Z')`).bind(hash).run()).meta.last_row_id;
  observerId = (await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('qs', ?, 'observer', '2026-09-24T00:00:00Z')`).bind(hash).run()).meta.last_row_id;
});

const req = (token) => new Request('https://x/api/test', { headers: token ? { Cookie: `session=${token}` } : {} });

describe('getSession permissions', () => {
  it('loads the role set plus overrides', async () => {
    await setOverride(env.DB, receptionId, 'assets.delete', 'grant');
    await setOverride(env.DB, receptionId, 'customers.send', 'deny');
    const s = await getSession(env.DB, await createSession(env.DB, receptionId));
    expect(s.permissions.has('bookings.manage')).toBe(true);
    expect(s.permissions.has('assets.delete')).toBe(true);
    expect(s.permissions.has('customers.send')).toBe(false);
    expect(s.canDeleteAsset).toBe(true);
  });

  it('gives admin every permission', async () => {
    const s = await getSession(env.DB, await createSession(env.DB, adminId));
    expect(s.permissions.size).toBe(PERMISSION_KEYS.length);
  });

  it('picks up role-table edits on the next request', async () => {
    const token = await createSession(env.DB, observerId);
    await setRolePermissions(env.DB, 'observer', ['bookings.view', 'finance.view_income', 'assets.view']);
    expect((await getSession(env.DB, token)).permissions.has('assets.view')).toBe(true);
  });

  it('returns null for a locked account even with a live session', async () => {
    const token = await createSession(env.DB, receptionId);
    await env.DB.prepare(`UPDATE staff_accounts SET locked_at = '2026-09-24T01:00:00Z', locked_by = 'qt' WHERE id = ?`).bind(receptionId).run();
    expect(await getSession(env.DB, token)).toBeNull();
  });
});

describe('requireAuth with a permission key', () => {
  it('401s without a session', async () => {
    const r = await requireAuth(req(null), env, 'bookings.view');
    expect(r.status).toBe(401);
  });

  it('403s when the permission is missing', async () => {
    const r = await requireAuth(req(await createSession(env.DB, observerId)), env, 'assets.view');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Không đủ quyền' });
  });

  it('returns the session when the permission is present', async () => {
    const r = await requireAuth(req(await createSession(env.DB, observerId)), env, 'bookings.view');
    expect(r.username).toBe('qs');
  });

  it('still accepts a legacy role array during the migration', async () => {
    const r = await requireAuth(req(await createSession(env.DB, observerId)), env, ['observer']);
    expect(r.username).toBe('qs');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the sorted permission list', async () => {
    const res = await me({ request: req(await createSession(env.DB, observerId)), env });
    expect((await res.json()).permissions).toEqual(['bookings.view', 'finance.view_income']);
  });
});

describe('POST /api/auth/login on a locked account', () => {
  it('403s with the lock message and creates no session', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET locked_at = '2026-09-24T01:00:00Z' WHERE id = ?`).bind(receptionId).run();
    const res = await login({ request: new Request('https://x/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'lt', password: 's3cret-pass' }) }), env });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Tài khoản đang bị khoá. Liên hệ quản trị.' });
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first();
    expect(n).toBe(0);
  });

  it('checks the password first, so a wrong password on a locked account still says 401', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET locked_at = '2026-09-24T01:00:00Z' WHERE id = ?`).bind(receptionId).run();
    const res = await login({ request: new Request('https://x/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'lt', password: 'wrong-pass' }) }), env });
    expect(res.status).toBe(401);
  });
});
```

Thêm vào `test/twoFactorAuth.test.js` (describe của `verify-2fa`) một test: tài khoản bật 2FA bị khoá **sau** khi lấy `pendingToken` → `verify-2fa` với mã đúng trả 403 cùng thông báo trên và không tạo phiên. Dùng cách tạo mã TOTP mà các test hiện có trong file đó đang dùng.

- [ ] **Step 3: Chạy test, xác nhận FAIL** — `npm run test:each -- test/authPermissions.test.js` → FAIL.

- [ ] **Step 4: Sửa `lib/auth.js` `getSession`**

```js
import { effectivePermissions } from './permissions.js';

export async function getSession(db, token) {
  const row = await db
    .prepare(
      `SELECT s.staff_id AS staffId, a.username, a.role, a.totp_enabled AS totpEnabled,
              (SELECT group_concat(permission, ',') FROM role_permissions WHERE role = a.role) AS rolePerms,
              (SELECT group_concat(permission || ':' || effect, ',') FROM user_permission_overrides WHERE staff_id = a.id) AS overrides
       FROM sessions s
       JOIN staff_accounts a ON a.id = s.staff_id
       WHERE s.token = ? AND s.expires_at > ? AND a.locked_at IS NULL`
    )
    .bind(token, new Date().toISOString())
    .first();

  if (!row) return null;
  const rolePerms = row.rolePerms ? row.rolePerms.split(',') : [];
  const overrides = row.overrides
    ? row.overrides.split(',').map((pair) => {
        const [permission, effect] = pair.split(':');
        return { permission, effect };
      })
    : [];
  const permissions = effectivePermissions(row.role, rolePerms, overrides);
  return {
    staffId: row.staffId,
    username: row.username,
    role: row.role,
    totpEnabled: !!row.totpEnabled,
    permissions,
    // Tạm thời cho API chưa chuyển sang mã quyền — xoá ở Task 11.
    canManageRoomLayout: permissions.has('rooms.layout'),
    canAddFinanceTransaction: permissions.has('finance.create'),
    canDeleteAsset: permissions.has('assets.delete'),
    canDeleteDeposit: permissions.has('bookings.deposit_delete'),
  };
}
```

- [ ] **Step 5: Sửa `lib/requireAuth.js`**

```js
export async function requireAuth(request, env, required) {
  const token = parseCookie(request, 'session');
  const session = token ? await getSession(env.DB, token) : null;

  if (!session) {
    return jsonResponse({ error: 'Chưa đăng nhập' }, 401);
  }
  if (required == null) return session;
  // Tạm thời: API chưa chuyển vẫn truyền mảng vai trò. Task 11 bỏ nhánh này.
  const allowed = Array.isArray(required) ? required.includes(session.role) : session.permissions.has(required);
  if (!allowed) {
    return jsonResponse({ error: 'Không đủ quyền' }, 403);
  }
  return session;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 6: Sửa `me.js`, `login.js`, `verify-2fa.js`**

`functions/api/auth/me.js` — thêm `permissions: [...auth.permissions].sort()` vào JSON trả về (giữ các trường khác ở task này).

`functions/api/auth/login.js` — thêm `locked_at AS lockedAt` vào `SELECT`, và **sau** khi kiểm tra mật khẩu, **trước** nhánh 2FA:

```js
  if (account.lockedAt) {
    return jsonError('Tài khoản đang bị khoá. Liên hệ quản trị.', 403);
  }
```

`functions/api/auth/verify-2fa.js` — sau khi xác định tài khoản từ pending token và kiểm tra mã TOTP đúng, trước `createSession`: đọc `locked_at` của tài khoản đó; nếu có giá trị → xoá pending token, trả `jsonError('Tài khoản đang bị khoá. Liên hệ quản trị.', 403)`.

- [ ] **Step 7: Chuyển các test đang bật cờ bằng SQL sang `setOverride`**

Ví dụ `test/assets.test.js:230`:

```js
// trước
await env.DB.prepare(`UPDATE staff_accounts SET can_delete_asset = 1 WHERE id = ?`).bind(receptionRow.id).run();
// sau
await setOverride(env.DB, receptionRow.id, 'assets.delete');
```

Ánh xạ cờ → mã quyền: `can_manage_room_layout` → `rooms.layout`, `can_add_finance_transaction` → `finance.create`, `can_delete_asset` → `assets.delete`, `can_delete_deposit` → `bookings.deposit_delete`. Với các `INSERT INTO staff_accounts (..., can_x, ...) VALUES (..., 1, ...)`, bỏ cột cờ khỏi INSERT và gọi `setOverride` ngay sau với id vừa chèn. Import `setOverride` từ `./helpers/permissions.js`.

Các test "người quan sát có cờ vẫn bị từ chối" (`assets.test.js:238`, `bookingsEndpoints.test.js:626`, `financeTransactions.test.js:65`, `roomsEndpoints.test.js:272`) giữ nguyên ý nghĩa bằng cách **không** cấp override cho người quan sát (hành vi mới: người quan sát không có quyền trừ khi được cấp rõ ràng) — đổi tên test thành `rejects an observer without an explicit grant (403)` và bỏ dòng bật cờ.

`test/authMeEndpoint.test.js`: các assert về `canManageRoomLayout`/`canAddFinanceTransaction` giữ nguyên ở task này (trường vẫn còn, suy ra từ override).

- [ ] **Step 8: Chạy toàn bộ test** — `npm run test:each` → `fail=0`, không còn file `CRASH` chưa chạy lại. Nếu còn test đỏ vì đọc cột cờ, sửa theo Step 7.

- [ ] **Step 9: Commit**

```bash
git add lib/auth.js lib/requireAuth.js functions/api/auth test
git commit -m "feat(permissions): load permissions into sessions, permission-key requireAuth, block locked logins"
```

---

### Tasks 4–8: Chuyển API sang mã quyền

Quy tắc chung cho cả 5 task:
- Đổi tham số thứ 3 của `requireAuth` từ mảng vai trò sang mã quyền theo bảng của task. Handler hiện truyền `null` thì giữ `null` nếu bảng không nói khác.
- Thay nhánh `auth.role === ...` / `auth.canX` bên trong bằng `hasPermission(auth, '...')` (import từ `lib/permissions.js`) theo cột "Bên trong".
- Test hiện có: vai trò Lễ tân/Quản lý/Quản trị phải giữ nguyên kết quả. Test người quan sát trên API mà người quan sát **mất quyền** đổi kỳ vọng sang 403 và đổi tên thành `rejects observer (403)`. Mỗi task liệt kê các test đã biết; nếu gặp thêm test người quan sát đỏ trên API mất quyền thì đổi tương tự và ghi tên test vào commit message.
- Mỗi task thêm ít nhất một test **override**: user không có quyền theo vai trò nhưng được `grant` → 2xx; user có quyền theo vai trò nhưng bị `deny` → 403.
- Kiểm tra cuối mỗi task: `grep -rn "requireAuth(request, env, \[" <thư mục của task>` rỗng; `grep -rn "auth.role\|auth.can" <thư mục của task>` rỗng.

### Task 4: API đặt phòng, phòng, ưu đãi

**Files:** `functions/api/bookings/**`, `functions/api/rooms/**`, `functions/api/reception/reminders.js`, `functions/api/promo/**`; tests `test/bookingsEndpoints.test.js`, `test/bookingsStaffEndpoint.test.js`, `test/bookingLifecycle.test.js`, `test/bookingIdentity.test.js`, `test/bookingServiceItems.test.js`, `test/roomsEndpoints.test.js`, `test/receptionRemindersEndpoint.test.js`, `test/promoEndpoints.test.js`.

**Interfaces:** Consumes `requireAuth(request, env, key)`, `hasPermission(auth, key)`, `setOverride` (Task 1, 3).

| File | Hiện tại | Mới | Bên trong |
|---|---|---|---|
| `bookings/index.js:87` GET | 4 vai trò | `bookings.view` | `:94` `includeHidden` → `hasPermission(auth,'records.hide')`; `:130` che SĐT/email khi `!hasPermission(auth,'guests.contact_view')` |
| `bookings/staff.js:15` | L,Q,T | `bookings.manage` | |
| `bookings/[id]/cancel.js`, `check-in.js`, `check-out.js`, `confirm.js`, `reject.js`, `identity.js`, `index.js` | L,Q,T | `bookings.manage` | |
| `bookings/[id]/deposits/index.js:10` | L,Q,T | `bookings.manage` | |
| `bookings/[id]/deposits/[depositId].js:8` | `null` + `:10` `canDeleteDeposit && !observer` | `bookings.deposit_delete` | xoá khối `:10-12` |
| `bookings/[id]/services/index.js:60` | L,Q,T | `bookings.manage` | |
| `bookings/[id]/services/[itemId].js:8` | L,Q,T | `bookings.manage` | `:22` `auth.role !== 'admin'` → `!hasPermission(auth,'bookings.edit_paid_service')` |
| `bookings/[id]/hide.js:8` | T | `records.hide` | |
| `rooms/index.js:4`, `rooms/layout-log.js:4` | 4 vai trò | `bookings.view` | |
| `rooms/reorder.js:8` | `null` + `:10` `canManageRoomLayout && !observer` | `rooms.layout` | xoá khối `:10-12` |
| `rooms/[id]/clean.js:8` | L,Q,T | `bookings.manage` | |
| `rooms/[id]/price.js:12` | T | `settings.rooms` | |
| `reception/reminders.js:5` | 4 vai trò | `bookings.view` | |
| `promo/[code].js:5`, `promo/[code]/redeem.js:4`, `promo/[code]/claim-gift.js:4` | L,Q,T | `promo.redeem` | |

Test người quan sát không đổi trong task này (người quan sát vẫn xem được đặt phòng/phòng/nhắc việc; vẫn bị chặn thao tác).

- [ ] **Step 1:** Thêm vào cuối `test/bookingsEndpoints.test.js` (file này đã có `listBookings`, `hideBooking`, `authedRequest`, `authedPatchRequest`; staff id cố định: 1 manager, 2 observer, 3 reception, 4 admin):

```js
import { setOverride } from './helpers/permissions.js';

const HIDDEN_BOOKING_SQL = `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at, is_hidden) VALUES ('Khách Ẩn', '0900000001', 'circle', '2026-09-10', '2026-09-11', 'cancelled', 'phone', '2026-09-05T00:00:00Z', 1)`;

describe('booking permissions via overrides', () => {
  it('lets a reception user granted records.hide list hidden bookings', async () => {
    const booking = await env.DB.prepare(HIDDEN_BOOKING_SQL).run();
    await setOverride(env.DB, 3, 'records.hide');
    const res = await listBookings({ request: authedRequest('https://x/api/bookings?status=cancelled&includeHidden=1', receptionToken), env });
    const body = await res.json();
    expect(body.find((b) => b.id === booking.meta.last_row_id)).toBeTruthy();
  });

  it('lets a reception user granted records.hide hide a booking', async () => {
    const booking = await env.DB.prepare(HIDDEN_BOOKING_SQL).run();
    await setOverride(env.DB, 3, 'records.hide');
    const res = await hideBooking({ request: authedPatchRequest(`https://x/api/bookings/${booking.meta.last_row_id}/hide`, receptionToken, { hidden: false }), env, params: { id: String(booking.meta.last_row_id) } });
    expect(res.status).toBe(200);
  });

  it('redacts contact details for a manager denied guests.contact_view', async () => {
    await env.DB.prepare(`INSERT INTO bookings (guest_name, phone, email, room_type, check_in, check_out, status, source, created_at) VALUES ('Khách', '0900000002', 'k@example.com', 'circle', '2099-01-01', '2099-01-02', 'pending', 'phone', '2026-09-05T00:00:00Z')`).run();
    await setOverride(env.DB, 1, 'guests.contact_view', 'deny');
    const body = await (await listBookings({ request: authedRequest('https://x/api/bookings', managerToken), env })).json();
    expect(body.length).toBeGreaterThan(0);
    body.forEach((b) => { expect(b.phone).toBeNull(); expect(b.email).toBeNull(); });
  });

  it('403s listing for a manager denied bookings.view', async () => {
    await setOverride(env.DB, 1, 'bookings.view', 'deny');
    const res = await listBookings({ request: authedRequest('https://x/api/bookings', managerToken), env });
    expect(res.status).toBe(403);
  });
});
```

Kiểm tra body mà `hide.js` nhận (đọc `functions/api/bookings/[id]/hide.js` và test `PATCH /api/bookings/:id/hide` hiện có) và dùng đúng trường đó thay cho `{ hidden: false }` nếu khác.

Thêm vào `test/roomsEndpoints.test.js` (đọc đầu file để lấy tên handler/token): reception được `grant` `rooms.layout` → PATCH reorder 200; manager bị `deny` `bookings.view` → GET rooms 403.

- [ ] **Step 2:** Chạy các test đã liệt kê → test override mới FAIL.
- [ ] **Step 3:** Sửa các file theo bảng.
- [ ] **Step 4:** Chạy lại → PASS; chạy grep kiểm tra (quy tắc chung) cho `functions/api/bookings functions/api/rooms functions/api/reception functions/api/promo` → rỗng.
- [ ] **Step 5:** Commit `feat(permissions): convert booking, room, reminder and promo APIs to permission keys`.

### Task 5: API order ăn uống, Giờ Xanh, khách hàng, template, khuyến mãi, tổng quan, nhật ký

**Files:** `functions/api/dine-in-orders/**`, `functions/api/gio-xanh-sessions/**`, `functions/api/customers/**`, `functions/api/templates/**`, `functions/api/policy.js`, `functions/api/gift-inventory.js`, `functions/api/notification-settings.js`, `functions/api/dashboard/summary.js`, `functions/api/audit-log/index.js`; tests `test/dineInOrders.test.js`, `test/gioXanhSessions.test.js`, `test/customersEndpoints.test.js`, `test/customerDetail.test.js`, `test/customerSend.test.js`, `test/templatesEndpoints.test.js`, `test/templateActivation.test.js`, `test/policy.test.js`, `test/managerEndpoints.test.js`, `test/notificationSettingsEndpoint.test.js`, `test/dashboardEndpoint.test.js`, `test/auditLog.test.js`.

| File | Mới | Bên trong |
|---|---|---|
| `dine-in-orders/index.js:10` GET | `dine_in.view` | `:16` `includeHidden` → `records.hide` |
| `dine-in-orders/index.js:28` POST, `[id]/close.js`, `[id]/items/index.js`, `[id]/items/[itemId].js`, `[id]/void.js` | `dine_in.manage` | |
| `dine-in-orders/[id]/index.js:8` | `dine_in.view` | |
| `dine-in-orders/[id]/hide.js` | `records.hide` | |
| `gio-xanh-sessions/index.js:10` GET | `gio_xanh.view` | `:16` `includeHidden` → `records.hide` |
| `gio-xanh-sessions/index.js:30` POST, `[id]/close.js`, `[id]/items/index.js`, `[id]/items/[itemId].js`, `[id]/void.js` | `gio_xanh.manage` | |
| `gio-xanh-sessions/[id]/index.js:8` | `gio_xanh.view` | |
| `gio-xanh-sessions/[id]/hide.js` | `records.hide` | |
| `customers/index.js:5` | `customers.view` | `:18`, `:63` `role === 'observer'` → `!hasPermission(auth,'guests.contact_view')` |
| `customers/[id].js:5` | `customers.view` | ngay sau: `if (!hasPermission(auth,'guests.contact_view')) return 403 { error: 'Không đủ quyền' }` |
| `customers/[id]/send.js:11` | `customers.send` | |
| `templates/index.js:8` GET | `templates.view` | |
| `templates/index.js:21`, `templates/[id].js:8,47`, `activate.js`, `deactivate.js` | `templates.manage` | |
| `policy.js:46` GET, `gift-inventory.js:45` GET, `notification-settings.js:4` | `promo_config.view` | |
| `policy.js:11` POST, `policy.js:65` DELETE, `gift-inventory.js:11` POST | `promo_config.manage` | |
| `dashboard/summary.js:15` | `dashboard.view` | |
| `audit-log/index.js:10` | `audit.view` | |

Test người quan sát cần đổi sang 403: mọi test người quan sát **đọc** order/phiên Giờ Xanh (GET list/detail) trong `dineInOrders.test.js`, `gioXanhSessions.test.js`; `customersEndpoints.test.js:106` và `:113` (người quan sát giờ bị 403 ở GET customers — thay hai test này bằng hai test dùng user **reception bị `deny` `guests.contact_view`**: tìm theo SĐT không khớp, tìm theo tên/mã vẫn khớp, SĐT/email trả `null`).

- [ ] **Step 1:** Thêm test: reception bị `deny` `guests.contact_view` → `customers/[id]` 403; observer được `grant` `dine_in.view` → GET dine-in-orders 200; manager bị `deny` `dashboard.view` → 403.
- [ ] **Step 2:** Chạy các file test đã liệt kê → FAIL ở test mới.
- [ ] **Step 3:** Sửa theo bảng; đổi các test người quan sát nêu trên.
- [ ] **Step 4:** Chạy lại → PASS; grep kiểm tra cho các file của task → rỗng.
- [ ] **Step 5:** Commit `feat(permissions): convert dine-in, Giờ Xanh, customer, template, promo config, dashboard and audit APIs`.

### Task 6: API sổ thu chi

**Files:** `functions/api/finance/**`; tests `test/financeTransactions.test.js`, `test/financeCategories.test.js`, `test/financeSummary.test.js`, `test/financeAttachments.test.js`, `test/financeReceiptsUsage.test.js`.

| File | Mới | Bên trong |
|---|---|---|
| `transactions/index.js:43` GET | `finance.view_income` | `:52` `role === 'observer'` → `!hasPermission(auth,'finance.view_all')` (ép `type = 'income'`); `:56` `includeHidden` → `records.hide` **và** `finance.view_all` |
| `transactions/index.js:117` POST | `finance.create` | xoá biểu thức `canAdd` `:123` và khối trả 403 dùng nó |
| `transactions/[id].js:14`, `[id]/void.js:11` | `finance.manage` | |
| `transactions/[id]/hide.js:10` | `records.hide` | |
| `transactions/[id]/attachment.js:20` POST, `:64` DELETE | `finance.manage` | |
| `transactions/[id]/attachment.js:89` GET | `finance.view_income` | `:97` `role === 'observer' && (...)` → `!hasPermission(auth,'finance.view_all') && (...)` (vẫn 404) |
| `categories/index.js:26` GET | `finance.view_income` | `:32` → `!hasPermission(auth,'finance.view_all')` |
| `categories/index.js:38` POST, `categories/[id].js:8`, `categories/[id]/move.js:8` | `settings.finance_categories` | |
| `summary.js:26`, `opening-balance.js:10` GET, `receipts-usage.js:7` | `finance.view_all` | |
| `opening-balance.js:35` POST | `finance.manage` | |

Các test người quan sát của sổ thu chi giữ nguyên kỳ vọng (người quan sát vẫn chỉ thấy phần thu). Test `financeTransactions.test.js:56-70` (reception có cờ thêm giao dịch) đã chuyển sang override ở Task 3 — giữ nguyên.

- [ ] **Step 1:** Thêm test: reception được `grant` `finance.view_income` → GET transactions chỉ trả `income`; manager bị `deny` `finance.view_all` → GET summary 403 và GET transactions chỉ trả `income`; reception được `grant` `finance.create` → POST 201.
- [ ] **Step 2:** Chạy → FAIL test mới.
- [ ] **Step 3:** Sửa theo bảng.
- [ ] **Step 4:** Chạy lại → PASS; grep `functions/api/finance` → rỗng.
- [ ] **Step 5:** Commit `feat(permissions): convert finance APIs to permission keys`.

### Task 7: API kho & tài sản

**Files:** `functions/api/asset-*/**`, `functions/api/assets/**`; tests `test/asset*.test.js`, `test/assets.test.js`.

| File | Mới | Bên trong |
|---|---|---|
| Mọi GET: `asset-categories/index.js:28`, `asset-inventory-batches/index.js:23`, `asset-inventory-batches/[id].js:45`, `asset-inventory-food-lots/index.js:22`, `asset-inventory-lines/missing-devices.js:20`, `asset-inventory-lines/[id]/photo.js:89`, `asset-inventory-stock/index.js:4`, `asset-inventory-transactions/index.js:42`, `asset-locations/index.js:27`, `asset-source-documents/index.js:16`, `asset-source-rows/index.js:24`, `assets/index.js:42`, `assets/[id]/photo.js:74` | `assets.view` | `assets/index.js:51` `includeDeleted` → `hasPermission(auth,'assets.manage')` |
| `asset-inventory-batches/[id].js:63` PATCH | `assets.count` | `:85`, `:88` `auth.role === 'reception'` → `!hasPermission(auth,'assets.manage')` |
| `asset-inventory-lines/[id].js:17`, `asset-inventory-lines/[id]/photo.js:32,70` | `assets.count` | `canWriteLine(role, status)` → `canWriteLine(auth, status)`: `pending_close` → `hasPermission(auth,'assets.manage')`, còn lại giữ logic cũ |
| `asset-inventory-transactions/index.js:118` POST, `asset-inventory-transactions/[id].js:10` | `assets.count` | |
| `asset-inventory-batches/index.js:44` POST, `asset-inventory-batches/[id]/refresh-lines.js:9`, `asset-source-rows/[id]/reconcile.js:10`, `assets/index.js:74` POST, `assets/[id].js:14` PATCH, `assets/[id]/photo.js:20,57` | `assets.manage` | |
| `assets/[id].js:75` DELETE | `assets.delete` | xoá khối `:77` |
| `asset-categories/index.js:43`, `asset-categories/[id].js:8`, `asset-locations/index.js:49`, `asset-locations/[id].js:8`, `asset-inventory-food-lots/index.js:53` | `assets.config` | |

Test người quan sát cần đổi sang 403: `assetInventoryStock.test.js:96` (`lets an observer read`), phần người quan sát trong `assetPhotos.test.js:133` (tách: 3 vai trò 200, người quan sát 403), và mọi test người quan sát đọc các API ở dòng đầu bảng.

- [ ] **Step 1:** Thêm test: người quan sát được `grant` `assets.view` → GET assets 200; reception được `grant` `assets.manage` → PATCH batch sang `counting` 200; manager bị `deny` `assets.count` → POST asset-inventory-transactions 403.
- [ ] **Step 2:** Chạy → FAIL test mới.
- [ ] **Step 3:** Sửa theo bảng; đổi các test người quan sát nêu trên.
- [ ] **Step 4:** Chạy lại → PASS; grep `functions/api/asset* functions/api/assets` → rỗng.
- [ ] **Step 5:** Commit `feat(permissions): convert asset and inventory APIs to permission keys`.

### Task 8: API cài đặt và dữ liệu tham chiếu

**Files:** `functions/api/catalog/**`, `functions/api/dine-in-menu/**`, `functions/api/holidays/**`, `functions/api/cancellation-policy/**`, `functions/api/experience-booking-settings.js`, `functions/api/reminder-settings.js`, `functions/api/availability*` (nếu có `requireAuth`); tests `test/serviceCatalogEndpoints.test.js`, `test/experienceSlots.test.js`, `test/dineInMenu.test.js`, `test/dineInMenuOrdering.test.js`, `test/holidaysEndpoints.test.js`, `test/cancellationPolicyEndpoints.test.js`, `test/experienceBookingSettings.test.js`, `test/reminderSettings.test.js`, `test/roomPricing.test.js`; **mới** `test/observerTodayOps.test.js`.

| File | Mới |
|---|---|
| GET `catalog/index.js:42`, `catalog/[id]/slot-availability.js:15`, `catalog/[id]/slot-templates/index.js:29`, `dine-in-menu/index.js:27`, `holidays/index.js:17`, `cancellation-policy/index.js:12`, `experience-booking-settings.js:8`, `reminder-settings.js:8` | `null` (chỉ cần đăng nhập) |
| `catalog/index.js:61`, `catalog/[id].js:13,95`, `catalog/[id]/slot-templates/index.js:43`, `catalog/[id]/slot-templates/[templateId].js:10`, `experience-booking-settings.js:20` | `settings.catalog` |
| `dine-in-menu/index.js:35`, `dine-in-menu/[id].js:9`, `dine-in-menu/[id]/move.js:8`, `dine-in-menu/move-group.js:10`, `dine-in-menu/rename-group.js:10` | `settings.dine_in_menu` |
| `holidays/index.js:28`, `holidays/[id].js:17,45` | `settings.rooms` |
| `cancellation-policy/index.js:25`, `cancellation-policy/[id].js:8,43` | `settings.cancellation_policy` |
| `reminder-settings.js:20` | `settings.reminders` |

- [ ] **Step 1: Viết `test/observerTodayOps.test.js`** (Review Focus #2)

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSession } from '../lib/auth.js';
import { onRequestGet as rooms } from '../functions/api/rooms/index.js';
import { onRequestGet as layoutLog } from '../functions/api/rooms/layout-log.js';
import { onRequestGet as bookings } from '../functions/api/bookings/index.js';
import { onRequestGet as reminders } from '../functions/api/reception/reminders.js';
import { onRequestGet as catalog } from '../functions/api/catalog/index.js';
import { onRequestGet as dineInMenu } from '../functions/api/dine-in-menu/index.js';
import { onRequestGet as holidays } from '../functions/api/holidays/index.js';
import { onRequestGet as cancellationPolicy } from '../functions/api/cancellation-policy/index.js';
import { onRequestGet as customers } from '../functions/api/customers/index.js';
import { onRequestGet as assets } from '../functions/api/assets/index.js';

let token;
beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  const id = (await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('qs', 'x', 'observer', '2026-09-24T00:00:00Z')`).run()).meta.last_row_id;
  token = await createSession(env.DB, id);
});

const get = (url) => new Request(url, { headers: { Cookie: `session=${token}` } });

describe('observer loading the Vận hành hôm nay page', () => {
  it.each([
    ['rooms', rooms, 'https://x/api/rooms?date=2026-09-24'],
    ['rooms/layout-log', layoutLog, 'https://x/api/rooms/layout-log?limit=5'],
    ['bookings', bookings, 'https://x/api/bookings'],
    ['reception/reminders', reminders, 'https://x/api/reception/reminders'],
    ['catalog', catalog, 'https://x/api/catalog'],
    ['dine-in-menu', dineInMenu, 'https://x/api/dine-in-menu'],
    ['holidays', holidays, 'https://x/api/holidays'],
    ['cancellation-policy', cancellationPolicy, 'https://x/api/cancellation-policy'],
  ])('GET %s → 200', async (_name, handler, url) => {
    const res = await handler({ request: get(url), env, params: {} });
    expect(res.status).toBe(200);
  });

  it.each([
    ['customers', customers, 'https://x/api/customers'],
    ['assets', assets, 'https://x/api/assets'],
  ])('GET %s → 403', async (_name, handler, url) => {
    const res = await handler({ request: get(url), env, params: {} });
    expect(res.status).toBe(403);
  });
});
```

Nếu `reception/reminders` hoặc `bookings` cần tham số bắt buộc (đọc `admin/reception.js` để lấy query thực tế nó gửi), dùng đúng tham số đó.

- [ ] **Step 2:** Chạy → PASS/FAIL tuỳ trạng thái; sau Step 3 phải PASS toàn bộ.
- [ ] **Step 3:** Sửa theo bảng. Test hiện có "lets observer view ..." cho các GET tham chiếu giữ nguyên (vẫn 200).
- [ ] **Step 4:** Chạy các test đã liệt kê → PASS; grep các thư mục của task → rỗng.
- [ ] **Step 5:** Commit `feat(permissions): convert settings APIs, make reference reads login-only`.

---

### Task 9: API quản lý user, quyền, khoá tạm

**Files:**
- Create: `lib/staffGuards.js`, `functions/api/permissions.js`, `functions/api/roles/[role]/permissions.js`, `functions/api/users/[id]/permissions.js`, `functions/api/users/[id]/lock.js`, `functions/api/users/[id]/unlock.js`
- Modify: `functions/api/users/index.js`, `functions/api/users/[id].js`, `functions/api/users/[id]/role.js`, `functions/api/users/[id]/password.js`, `functions/api/users/[id]/disable-2fa.js`
- Delete: `functions/api/users/[id]/room-layout-access.js`, `finance-transaction-access.js`, `asset-delete-access.js`, `deposit-delete-access.js`
- Modify: `admin/audit-log.js` (nhãn)
- Test: viết lại `test/userManagement.test.js`; sửa `test/usersEndpoints.test.js`; mới `test/permissionsAdmin.test.js`

**Interfaces:**
- Consumes: `PERMISSION_GROUPS`, `EDITABLE_ROLES`, `isValidPermission`, `hasPermission` (Task 1); `requireAuth` (Task 3).
- Produces (dùng ở Task 10):
  - `GET /api/permissions` → `{ groups: PERMISSION_GROUPS, roles: { reception: string[], manager: string[], observer: string[] }, canEditRoles: boolean }`
  - `PUT /api/roles/:role/permissions` body `{ permissions: string[] }` → `{ ok: true }`
  - `GET /api/users` → `Array<{ id, username, role, totpEnabled, lockedAt, overrideCount, createdAt }>`
  - `GET /api/users/:id/permissions` → `{ role, overrides: Record<string,'grant'|'deny'>, effective: string[] }`
  - `PUT /api/users/:id/permissions` body `{ overrides: Record<string,'grant'|'deny'> }` → `{ ok: true }`
  - `POST /api/users/:id/lock`, `POST /api/users/:id/unlock` → `{ ok: true }`
  - `PATCH /api/users/:id/role` (giữ) → `{ ok: true }`, xoá override của user
  - `lib/staffGuards.js`: `loadTarget(db, id)`, `guardTarget(auth, target, { allowSelf = false } = {})` → `Response|null`, `isLastActiveAdmin(db, targetId)` → `Promise<boolean>`

- [ ] **Step 1: Viết `lib/staffGuards.js`**

```js
// lib/staffGuards.js
// Quy tắc an toàn dùng chung cho các API sửa tài khoản khác (spec mục 7).
function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function loadTarget(db, id) {
  return db.prepare(`SELECT id, username, role, locked_at AS lockedAt FROM staff_accounts WHERE id = ?`).bind(id).first();
}

// Trả Response lỗi, hoặc null nếu được phép thao tác trên target.
export function guardTarget(auth, target, { allowSelf = false } = {}) {
  if (!target) return jsonError('Không tìm thấy tài khoản', 404);
  if (!allowSelf && target.id === auth.staffId) return jsonError('Không thể tự thao tác trên tài khoản của chính mình', 400);
  if (target.role === 'admin' && auth.role !== 'admin') return jsonError('Chỉ quản trị mới được sửa tài khoản quản trị', 403);
  return null;
}

export async function isLastActiveAdmin(db, targetId) {
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'admin' AND locked_at IS NULL AND id != ?`).bind(targetId).first();
  const target = await db.prepare(`SELECT role, locked_at AS lockedAt FROM staff_accounts WHERE id = ?`).bind(targetId).first();
  return !!target && target.role === 'admin' && !target.lockedAt && n === 0;
}
```

- [ ] **Step 2: Viết `test/permissionsAdmin.test.js`** — tạo 5 tài khoản (admin `qt`, admin `qt2`, manager `ql`, reception `lt`, observer `qs`) và phiên cho `qt`, `ql`, `lt`, theo mẫu `beforeEach` của `test/userManagement.test.js`. Các test (mỗi dòng một `it`, kiểm tra status + trạng thái DB + dòng `audit_log`):

GET `/api/permissions`:
- `ql` → 200, `canEditRoles: false`, `roles.observer` = `['bookings.view','finance.view_income']`; `qt` → `canEditRoles: true`; `lt` → 403.

PUT `/api/roles/:role/permissions`:
- `qt` đặt observer = `['bookings.view','finance.view_income','assets.view']` → 200; `role_permissions` của observer đúng 3 dòng; `audit_log` có `role_permissions_change`, `entity_label = 'observer'`, `old_value`/`new_value` là danh sách phân tách bằng dấu phẩy đã sắp xếp.
- `ql` → 403 `Không đủ quyền`.
- `role = 'admin'` → 400 `Không thể sửa quyền của vai trò quản trị`; `role = 'boss'` → 400 `Vai trò không hợp lệ`.
- `permissions` chứa `'bookings.fly'` → 400 `Mã quyền không hợp lệ: bookings.fly`; `role_permissions` không đổi.
- body không phải mảng → 400 `Dữ liệu không hợp lệ`.

PUT `/api/users/:id/permissions`:
- `ql` đặt cho `lt` `{ 'finance.create': 'grant', 'customers.send': 'deny' }` → 200; bảng override đúng 2 dòng; `audit_log` `user_permissions_change`, `old_value` `''`, `new_value` `'customers.send:deny,finance.create:grant'`.
- `ql` grant `users.security` cho `lt` → 403 `Không thể cấp quyền mà bạn không có: users.security`.
- `ql` deny `users.security` cho `lt` → 200 (deny luôn được).
- `ql` sửa chính mình → 400; `ql` sửa `qt` → 403; `qt` sửa `qt2` (admin) → 400 `Tài khoản quản trị luôn có toàn quyền, không chỉnh riêng`.
- mã không hợp lệ hoặc effect khác `grant`/`deny` → 400.
- gửi `{}` → xoá hết override.

GET `/api/users/:id/permissions`:
- sau khi grant `assets.delete` cho `lt` → `effective` chứa `assets.delete`, `overrides` = `{ 'assets.delete': 'grant' }`, `role` = `'reception'`.

PATCH `/api/users/:id/role` (Review Focus #1, #4):
- `lt` có override grant `assets.delete`; `ql` đổi `lt` sang `observer` → 200; override của `lt` bị xoá; `getSession` với phiên mới của `lt` không có `assets.delete`.
- `ql` đổi `lt` sang `admin` → 403 `Chỉ quản trị mới được gán vai trò quản trị`.
- `qt` đổi `qt2` sang `manager` → 200 (còn `qt` là admin active).
- `ql` đổi chính mình → 400.

`isLastActiveAdmin` (gọi trực tiếp hàm):
- `qt` và `qt2` đều active → `isLastActiveAdmin(db, qt) === false`.
- khoá `qt2` bằng SQL (`UPDATE staff_accounts SET locked_at = ...`) → `isLastActiveAdmin(db, qt) === true`; `isLastActiveAdmin(db, qt2) === false` (đã khoá); `isLastActiveAdmin(db, lt) === false` (không phải admin).

Ghi chú: qua HTTP, nhánh "admin active cuối cùng" trong handler **không thể xảy ra** — thao tác trên tài khoản admin đòi hỏi người làm là một admin *khác* đang active (phiên của tài khoản bị khoá trả 401), nên đích không bao giờ là admin active cuối cùng; tự thao tác thì bị chặn trước bởi `guardTarget`. Handler vẫn gọi `isLastActiveAdmin` làm lớp phòng thủ thêm; hành vi được bảo đảm bằng test hàm ở trên cùng test "`qt` tự đổi/khoá/xoá chính mình → 400" và "manager thao tác trên admin → 403".

POST `/api/users/:id/lock` / `unlock` (Review Focus #3):
- `ql` khoá `lt` → 200; `locked_at` có giá trị, `locked_by = 'ql'`; mọi dòng `sessions` của `lt` bị xoá; `requireAuth` với phiên cũ của `lt` → 401; `audit_log` có `account_lock`.
- khoá lần 2 → 400 `Tài khoản đã bị khoá`; unlock → 200, `locked_at` null, `audit_log` `account_unlock`; unlock tài khoản chưa khoá → 400 `Tài khoản không bị khoá`.
- `ql` khoá `qt` → 403; `ql` khoá chính mình → 400.
- `qt` khoá `qt2` → 200 (còn `qt` active).

DELETE `/api/users/:id`:
- xoá `lt` có override → 204 và bảng override không còn dòng nào của `lt`.
- `ql` xoá `qt` → 403.

`password.js`, `disable-2fa.js`: `ql` → 403; `qt` → như cũ; `qt` đặt lại mật khẩu cho `qt2` → 200 (admin sửa admin được).

- [ ] **Step 3:** Chạy `npm run test:each -- test/permissionsAdmin.test.js` → FAIL.

- [ ] **Step 4: Viết các API**

`functions/api/permissions.js`:

```js
import { requireAuth } from '../../lib/requireAuth.js';
import { PERMISSION_GROUPS, EDITABLE_ROLES } from '../../lib/permissions.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare('SELECT role, permission FROM role_permissions ORDER BY permission').all();
  const roles = Object.fromEntries(EDITABLE_ROLES.map((r) => [r, results.filter((x) => x.role === r).map((x) => x.permission)]));
  return new Response(JSON.stringify({ groups: PERMISSION_GROUPS, roles, canEditRoles: auth.role === 'admin' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
```

`functions/api/roles/[role]/permissions.js`:

```js
import { requireAuth } from '../../../../lib/requireAuth.js';
import { EDITABLE_ROLES, isValidPermission } from '../../../../lib/permissions.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPut({ request, env, params }) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'admin') return jsonError('Không đủ quyền', 403);

  if (params.role === 'admin') return jsonError('Không thể sửa quyền của vai trò quản trị', 400);
  if (!EDITABLE_ROLES.includes(params.role)) return jsonError('Vai trò không hợp lệ', 400);

  let body;
  try { body = await request.json(); } catch { return jsonError('Dữ liệu không hợp lệ', 400); }
  if (!body || !Array.isArray(body.permissions)) return jsonError('Dữ liệu không hợp lệ', 400);
  const next = [...new Set(body.permissions)].sort();
  const bad = next.find((p) => !isValidPermission(p));
  if (bad) return jsonError(`Mã quyền không hợp lệ: ${bad}`, 400);

  const { results } = await env.DB.prepare('SELECT permission FROM role_permissions WHERE role = ? ORDER BY permission').bind(params.role).all();
  const prev = results.map((r) => r.permission);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM role_permissions WHERE role = ?').bind(params.role),
    ...next.map((p) => env.DB.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)').bind(params.role, p)),
    // audit_log.entity_id là NOT NULL; vai trò không có id nên ghi 0, tên vai trò nằm ở entity_label.
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('role_permissions_change', 'role', 0, ?, ?, ?, ?, ?)`
    ).bind(params.role, prev.join(','), next.join(','), auth.username, new Date().toISOString()),
  ]);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

`functions/api/users/[id]/permissions.js`:

```js
import { requireAuth } from '../../../../lib/requireAuth.js';
import { isValidPermission, hasPermission, effectivePermissions } from '../../../../lib/permissions.js';
import { loadTarget, guardTarget } from '../../../../lib/staffGuards.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const jsonError = (message, status) => json({ error: message }, status);

async function readOverrides(db, staffId) {
  const { results } = await db.prepare('SELECT permission, effect FROM user_permission_overrides WHERE staff_id = ? ORDER BY permission').bind(staffId).all();
  return results;
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;
  const target = await loadTarget(env.DB, params.id);
  if (!target) return jsonError('Không tìm thấy tài khoản', 404);

  const overrides = await readOverrides(env.DB, target.id);
  const { results } = await env.DB.prepare('SELECT permission FROM role_permissions WHERE role = ?').bind(target.role).all();
  const effective = [...effectivePermissions(target.role, results.map((r) => r.permission), overrides)].sort();
  return json({ role: target.role, overrides: Object.fromEntries(overrides.map((o) => [o.permission, o.effect])), effective });
}

export async function onRequestPut({ request, env, params }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;
  const target = await loadTarget(env.DB, params.id);
  const denied = guardTarget(auth, target);
  if (denied) return denied;
  if (target.role === 'admin') return jsonError('Tài khoản quản trị luôn có toàn quyền, không chỉnh riêng', 400);

  let body;
  try { body = await request.json(); } catch { return jsonError('Dữ liệu không hợp lệ', 400); }
  const overrides = body && body.overrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return jsonError('Dữ liệu không hợp lệ', 400);

  const entries = Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, effect] of entries) {
    if (!isValidPermission(key)) return jsonError(`Mã quyền không hợp lệ: ${key}`, 400);
    if (effect !== 'grant' && effect !== 'deny') return jsonError('Dữ liệu không hợp lệ', 400);
    if (effect === 'grant' && !hasPermission(auth, key)) return jsonError(`Không thể cấp quyền mà bạn không có: ${key}`, 403);
  }

  const prev = await readOverrides(env.DB, target.id);
  const fmt = (list) => list.map(([k, e]) => `${k}:${e}`).join(',');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_permission_overrides WHERE staff_id = ?').bind(target.id),
    ...entries.map(([k, e]) => env.DB.prepare('INSERT INTO user_permission_overrides (staff_id, permission, effect) VALUES (?, ?, ?)').bind(target.id, k, e)),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('user_permissions_change', 'staff_account', ?, ?, ?, ?, ?, ?)`
    ).bind(target.id, target.username, fmt(prev.map((o) => [o.permission, o.effect])), fmt(entries), auth.username, new Date().toISOString()),
  ]);
  return json({ ok: true });
}
```

`functions/api/users/[id]/lock.js` (và `unlock.js` đối xứng: kiểm tra `target.lockedAt` phải có, `UPDATE ... SET locked_at = NULL, locked_by = NULL`, action `account_unlock`, lỗi `Tài khoản không bị khoá`; unlock không cần kiểm tra admin cuối):

```js
import { requireAuth } from '../../../../lib/requireAuth.js';
import { loadTarget, guardTarget, isLastActiveAdmin } from '../../../../lib/staffGuards.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;
  const target = await loadTarget(env.DB, params.id);
  const denied = guardTarget(auth, target);
  if (denied) return denied;
  if (target.lockedAt) return json({ error: 'Tài khoản đã bị khoá' }, 400);
  if (await isLastActiveAdmin(env.DB, target.id)) return json({ error: 'Không thể khoá quản trị cuối cùng' }, 400);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE staff_accounts SET locked_at = ?, locked_by = ? WHERE id = ?').bind(now, auth.username, target.id),
    env.DB.prepare('DELETE FROM sessions WHERE staff_id = ?').bind(target.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('account_lock', 'staff_account', ?, ?, 'Đang hoạt động', 'Đã khoá', ?, ?)`
    ).bind(target.id, target.username, auth.username, now),
  ]);
  return json({ ok: true });
}
```

`functions/api/users/[id]/role.js` — viết lại phần kiểm tra:
- `requireAuth(request, env, 'users.manage')`; `loadTarget` + `guardTarget` (không tự đổi mình, không sửa admin nếu không phải admin).
- `role` phải thuộc `['reception','manager','admin','observer']` (giữ thông báo cũ).
- `role === 'admin' && auth.role !== 'admin'` → 403 `Chỉ quản trị mới được gán vai trò quản trị`.
- `target.role === 'admin' && role !== 'admin' && await isLastActiveAdmin(env.DB, target.id)` → 400 `Không thể hạ quyền quản trị cuối cùng`.
- Bỏ quy tắc "manager cuối cùng" cũ.
- Batch: `UPDATE role` + `DELETE FROM user_permission_overrides WHERE staff_id = ?` + dòng audit `account_role_change` như cũ.

`functions/api/users/[id].js` DELETE: `users.manage`; `loadTarget` + `guardTarget` (thông báo tự xoá giữ `Không thể tự xoá tài khoản của chính mình` — kiểm tra tự xoá **trước** `guardTarget`); `isLastActiveAdmin` → 400 `Không thể xoá quản trị cuối cùng`; batch thêm `DELETE FROM user_permission_overrides WHERE staff_id = ?` trước `DELETE FROM staff_accounts`.

`functions/api/users/index.js`: GET/POST → `users.manage`. GET chọn `id, username, role, totp_enabled AS totpEnabled, locked_at AS lockedAt, created_at AS createdAt, (SELECT COUNT(*) FROM user_permission_overrides o WHERE o.staff_id = staff_accounts.id) AS overrideCount` (bỏ 4 cột cờ; ép `totpEnabled` về boolean khi trả). POST: `role === 'admin' && auth.role !== 'admin'` → 403 `Chỉ quản trị mới được gán vai trò quản trị`.

`password.js`, `disable-2fa.js`: `users.security`; thêm `guardTarget(auth, target, { allowSelf: true })` sau khi đọc target (đổi mật khẩu của chính mình vẫn qua `change-password`, không chặn ở đây).

Xoá 4 file `*-access.js`.

`admin/audit-log.js` — thêm vào `ACTION_TYPE_LABELS`:

```js
  role_permissions_change: 'Sửa bảng quyền vai trò',
  user_permissions_change: 'Sửa quyền riêng của tài khoản',
  account_lock: 'Khoá tài khoản',
  account_unlock: 'Mở khoá tài khoản',
```

- [ ] **Step 5: Sửa test cũ** — trong `test/userManagement.test.js` xoá các `describe` của 4 API cờ và import của chúng; đổi test "last manager" thành các test tương ứng "last active admin"; giữ test xoá/đổi vai trò còn đúng. `test/usersEndpoints.test.js`: bỏ assert 4 trường cờ, thêm assert `lockedAt`, `overrideCount`; thêm test manager tạo tài khoản admin → 403.

- [ ] **Step 6:** `npm run test:each` → `fail=0`, không còn file `CRASH` chưa chạy lại.

- [ ] **Step 7: Commit**

```bash
git add lib/staffGuards.js functions/api/permissions.js functions/api/roles functions/api/users admin/audit-log.js test
git commit -m "feat(permissions): add role/user permission APIs, account lock, admin safety rules"
```

---

### Task 10: Frontend theo quyền + trang Phân quyền

**Files:**
- Modify: `admin/nav-drawer.js`, `_redirects`, và mọi `admin/*.js` có `currentRole`/`can*` (danh sách dưới)
- Rewrite: `admin/users.html`, `admin/users.js`
- Create: `admin/users.css`

**Interfaces:**
- Consumes: `GET /api/auth/me` → `{ username, role, permissions: string[] }`; các API Task 9.
- Produces: không.

- [ ] **Step 1: Mẫu chung cho mỗi trang** — thay

```js
const { role } = await res.json();
currentRole = role;
```

bằng

```js
const me = await res.json();
currentPermissions = me.permissions || [];
```

khai báo ở đầu file `let currentPermissions = [];` và `function can(key) { return currentPermissions.includes(key); }` (xoá `let currentRole`). Rồi đổi từng điều kiện:

| File:dòng | Điều kiện cũ | Mới |
|---|---|---|
| `asset-config.js:49,125,296` | `=== 'admin'` | `can('assets.config')` |
| `asset-inventory-stock.js:42,170` | `!== 'observer'` | `can('assets.count')` |
| `asset-inventory-stock.js:45` | `=== 'admin'` | `can('assets.config')` |
| `asset-inventory.js:38,327` | admin‖manager | `can('assets.manage')` |
| `asset-inventory.js:279-289` | `canTransition(status, role)` / `canWriteLine(status, role)` | bỏ tham số role: `draft`→`can('assets.manage')`, `counting`→`can('assets.count')`, `pending_close`→`can('assets.manage')`; `canWriteLine`: `counting`→`can('assets.count')`, `pending_close`→`can('assets.manage')`; sửa lời gọi `:318`, `:338` |
| `asset-source-data.js:24,149` | admin‖manager | `can('assets.manage')` |
| `assets.js:34,171` | admin‖manager | `can('assets.manage')` |
| `assets.js:172,183` + biến `canDeleteAsset` | `canDeleteAsset && !observer` | `can('assets.delete')`; xoá biến `canDeleteAsset` và dòng `:30-32` đọc cờ |
| `cancellation-policy.js:12,49` | `=== 'admin'` | `can('settings.cancellation_policy')` |
| `catalog.js:16,125,213` | `=== 'admin'` | `can('settings.catalog')` |
| `customers.js:70` | `!== 'observer'` | `can('guests.contact_view')` |
| `dine-in-menu.js:20,89,136` | `=== 'admin'` | `can('settings.dine_in_menu')` |
| `dine-in-order-detail.js:32,115,134` | `!== 'observer'` | `can('dine_in.manage')` |
| `dine-in-orders.js:19` | `!== 'observer'` | `can('dine_in.manage')` |
| `dine-in-orders.js:26,112,162` | `=== 'admin'` | `can('records.hide')` |
| `finance-categories.js:20,62` | `=== 'admin'` | `can('settings.finance_categories')` |
| `finance.js:188` | manager‖admin‖cờ | `can('finance.create')`; bỏ đọc `canAddFinanceTransaction` `:180` |
| `finance.js:191,225,644,716` | manager‖admin | `can('finance.manage')` |
| `finance.js:195,263,439` | `=== 'admin'` | `can('records.hide')` |
| `finance.js:206` | `=== 'observer'` | `!can('finance.view_all')` |
| `finance.js:213,690` | `!== 'observer'` / manager‖admin | `can('finance.view_all')` |
| `gio-xanh-detail.js:33,136,156` | `!== 'observer'` | `can('gio_xanh.manage')` |
| `gio-xanh.js:22` | `!== 'observer'` | `can('gio_xanh.manage')` |
| `gio-xanh.js:27,151,204` | `=== 'admin'` | `can('records.hide')` |
| `manager.js:53,215` | `=== 'manager'` | `can('promo_config.manage')` (admin giờ cũng thấy form — API vốn đã cho phép) |
| `manager.js:223` | `=== 'admin'` | `can('settings.reminders')` |
| `reception.js:109-112` | `=== 'observer'` ẩn 2 khối | ẩn `newBookingSection` khi `!can('bookings.manage')`; ẩn `promoLookupSection` khi `!can('promo.redeem')` |
| `reception.js:116,1609,1638` | `=== 'admin'` | `can('records.hide')` |
| `reception.js:271` | `!observer && (paid‖admin)` | `can('bookings.manage') && (item.paymentStatus !== 'paid' \|\| can('bookings.edit_paid_service'))` |
| `reception.js:306,678,1326` | `!== 'observer'` | `can('bookings.manage')` |
| `reception.js:695` | `canDeleteDeposit && !observer` | `can('bookings.deposit_delete')` |
| `reception.js:823,840,865,877,888` | `=== 'observer') return` | `if (!can('bookings.manage')) return` |
| `reception.js:1305,1353` | `canManageRoomLayout` | `can('rooms.layout')`; xoá biến `canManageRoomLayout`, `canDeleteDeposit` và `:102-105` đọc cờ |
| `rooms.js:26,100,171` | `=== 'admin'` | `can('settings.rooms')` |

Sau bước này: `grep -n "currentRole\|canManageRoomLayout\|canDeleteDeposit\|canDeleteAsset\|canAddFinanceTransaction" admin/*.js` chỉ còn trong `users.js` cũ (viết lại ở Step 3) — không còn file nào khác.

- [ ] **Step 2: `nav-drawer.js`** — đổi `roles: [...]` của từng mục thành `perm: '...'` theo spec mục 9 (Vận hành hôm nay `bookings.view`; Sổ thu chi `finance.view_income`; Tổng quan `dashboard.view`; 5 trang kho/tài sản `assets.view`; Order `dine_in.view`; Giờ Xanh `gio_xanh.view`; Khách hàng `customers.view`; Template `templates.view`; Cấu hình khuyến mãi `promo_config.view`; Bảng giá dịch vụ, Quản lý phòng, Chính sách hoàn cọc `settings.view`; Menu quán `settings.dine_in_menu`; Danh mục Sổ thu chi `settings.finance_categories`; Nhật ký `audit.view`; Quản lý user → nhãn **Phân quyền**, `users.manage`). `buildDrawer(role, username, permissions)`: lọc bằng `permissions.includes(item.perm)`. Thêm chặn trang, chạy ngay sau khi có `me`:

```js
const PAGE_ALWAYS_ALLOWED = ['change-password.html', 'security.html'];
const PAGE_EXTRA_PERMS = {
  'dine-in-order-detail.html': 'dine_in.view',
  'gio-xanh-detail.html': 'gio_xanh.view',
};

function requiredPermForPage(pageFile) {
  if (PAGE_ALWAYS_ALLOWED.includes(pageFile)) return null;
  if (PAGE_EXTRA_PERMS[pageFile]) return PAGE_EXTRA_PERMS[pageFile];
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => i.page === pageFile);
    if (item) return item.perm;
  }
  return null;
}

function guardPage(role, permissions) {
  const page = currentPageFile() || 'reception.html';
  const needed = requiredPermForPage(page.endsWith('.html') ? page : `${page}.html`);
  if (!needed || permissions.includes(needed)) return true;
  const first = NAV_GROUPS.flatMap((g) => g.items).find((i) => permissions.includes(i.perm));
  window.location.href = first ? urlFor(role, first.page) : urlFor(role, 'change-password.html');
  return false;
}
```

`urlFor` hiện là hàm lồng trong `buildDrawer`; đưa ra ngoài thành `urlFor(role, pageFile)` dùng chung. Trong khối khởi động cuối file: `const { role, username, permissions = [] } = await res.json(); if (!guardPage(role, permissions)) return; buildDrawer(role, username, permissions);`. Lưu ý `currentPageFile()` trả tên theo URL sạch (ví dụ `dashboard` với `/manager/dashboard`, `''` với `/manager`) — ánh xạ ngược qua `pageSlug` trước khi tra `requiredPermForPage` (`''` hoặc tiền tố vai trò → `reception.html`).

- [ ] **Step 3: `_redirects`** — với mỗi tiền tố `/manager`, `/reception`, `/observer` khai báo đủ tập đường dẫn mà `/manager` đang có (22 dòng), trỏ tới cùng file `admin/...`. Giữ nguyên các dòng hiện có, chỉ thêm dòng còn thiếu.

- [ ] **Step 4: Trang Phân quyền** — viết lại `admin/users.html` + `admin/users.js`, thêm `admin/users.css`, theo spec mục 8 và mockup `.superpowers/brainstorm/782-1790212890/content/permissions.html` (mở file để lấy cấu trúc và CSS; token màu lấy từ spec phần 2 mục 3). Yêu cầu hành vi:
  - Tải `GET /api/users` + `GET /api/permissions` song song. Tab **Vai trò** chỉ hiện khi `canEditRoles`.
  - Danh sách user: tên; `Vai trò · 2FA bật/tắt`; nhãn `Đang khoá` (nền trạng thái lỗi) nếu `lockedAt`; nhãn `+N` nếu `overrideCount > 0`.
  - Chọn user → `GET /api/users/:id/permissions`. Mỗi quyền 3 nút `Theo vai trò: có|không` / `Cho` / `Chặn` (nhóm `role="radiogroup"`, mỗi nút `role="radio"` + `aria-checked`). Không hiện nút `Cho` với quyền mà người đang thao tác không có (`me.permissions`). Dòng khác vai trò: nền vàng nhạt + chú thích `· vai trò: có/không`. Chân: `N quyền khác vai trò`, nút `Huỷ` (khôi phục trạng thái đã tải), `Lưu thay đổi` → `PUT /api/users/:id/permissions` với toàn bộ override hiện tại → thông báo `Đã lưu quyền của <username>`.
  - Đổi vai trò: nếu user có override, hiện dòng xác nhận trong trang (không dùng `confirm()`): `Đổi vai trò sẽ xoá N quyền chỉnh riêng. Tiếp tục?` [Đổi vai trò] [Giữ nguyên]. Người không phải admin không thấy lựa chọn `Quản trị`.
  - Nút `Khoá tài khoản` / `Mở khoá`, `Đặt lại mật khẩu` + `Tắt 2FA` (chỉ khi `me.permissions` có `users.security`; `Tắt 2FA` chỉ khi user bật 2FA), `Xoá tài khoản` (xác nhận trong trang). Ẩn toàn bộ nút thao tác và thay danh sách quyền bằng `Quản trị có toàn quyền` khi user là admin mà người thao tác không phải admin; với admin xem admin khác: có nút thao tác, danh sách quyền vẫn là dòng `Quản trị có toàn quyền`. Ẩn nút thao tác trên chính mình.
  - Tab **Vai trò**: bảng quyền (hàng nhóm nền `--side`), 4 cột, cột Quản trị tick sẵn `disabled`. Đếm thay đổi chưa lưu; `Lưu bảng quyền` gửi `PUT /api/roles/:role/permissions` cho từng vai trò bị đổi → `Đã lưu bảng quyền`. Rời tab khi có thay đổi chưa lưu: giữ nguyên thay đổi (không mất khi quay lại).
  - `+ Tạo tài khoản` mở form (tên đăng nhập, mật khẩu ban đầu tối thiểu 8 ký tự, vai trò) → `POST /api/users` → chọn luôn user vừa tạo.
  - Lỗi từ server hiện nguyên văn `error` ở vùng lỗi gần nút vừa bấm.
  - `< 640px`: danh sách một cột; chọn user → ẩn danh sách, hiện chi tiết với nút `‹ Danh sách`; bảng vai trò trong `.table-scroll`, cột đầu `position: sticky; left: 0`.

- [ ] **Step 5: Kiểm tra bằng tay** — `wrangler d1 migrations apply hien_le_garden_crm --local`, `npm run dev`. Tạo 4 tài khoản (seed theo `BACKEND.md`), đăng nhập lần lượt:
  - Người quan sát: menu chỉ có Hôm nay, Sổ thu chi; trang Hôm nay tải đủ dữ liệu, không có nút thao tác; gõ thẳng `/observer/assets` → bị chuyển về Hôm nay; Sổ thu chi chỉ có phần thu.
  - Lễ tân: menu khớp cột L; cấp `Xoá cọc` cho lễ tân ở trang Phân quyền → đăng nhập lễ tân thấy nút xoá cọc.
  - Quản lý: không thấy tab Vai trò; không chọn được `Quản trị`; không thấy nút `Cho` ở `Đặt lại mật khẩu`.
  - Quản trị: sửa bảng quyền người quan sát thêm `Xem tài sản` → người quan sát thấy mục Kho; hoàn tác.
  - Khoá lễ tân đang đăng nhập ở tab khác → tab đó thao tác tiếp bị đưa về trang đăng nhập.

  Chụp màn hình trang Phân quyền ở 390px và 1440px.

- [ ] **Step 6: Commit**

```bash
git add admin _redirects
git commit -m "feat(permissions): permission-driven admin UI and new Phân quyền page"
```

---

### Task 11: Dọn dẹp — bỏ mảng vai trò và trường cờ cũ

**Files:** `lib/requireAuth.js`, `lib/auth.js`, `functions/api/auth/me.js`, `test/authPermissions.test.js`, `test/authMeEndpoint.test.js`, `BACKEND.md`.

- [ ] **Step 1:** Trong `test/authPermissions.test.js`, thay test `still accepts a legacy role array during the migration` bằng:

```js
  it('throws on a legacy role array so a missed conversion fails loudly', async () => {
    await expect(requireAuth(req(await createSession(env.DB, observerId)), env, ['observer'])).rejects.toThrow(TypeError);
  });
```

Thêm assert trong test `returns the sorted permission list` (me): `expect(body).not.toHaveProperty('canManageRoomLayout')`. Chạy → FAIL.

- [ ] **Step 2:** `requireAuth`: nếu `Array.isArray(required)` → `throw new TypeError('requireAuth: dùng mã quyền, không dùng mảng vai trò')`; bỏ nhánh mảng. `getSession`: xoá 4 trường `can*`. `me.js`: trả `{ username, role, totpEnabled, permissions }`. `test/authMeEndpoint.test.js`: bỏ assert `can*`, thay bằng assert `permissions` chứa `rooms.layout` / `finance.create` cho 2 user được cấp override.

- [ ] **Step 3:** Kiểm tra:

```bash
grep -rn "requireAuth(request, env, \[" functions   # phải rỗng
grep -rn "auth\.can[A-Z]\|auth\.role ===\|auth\.role !==" functions lib   # chỉ còn so sánh 'admin' trong lib/staffGuards.js, functions/api/permissions.js, functions/api/roles, functions/api/users
grep -rn "canManageRoomLayout\|canAddFinanceTransaction\|canDeleteAsset\|canDeleteDeposit" functions lib admin   # phải rỗng
```

- [ ] **Step 4:** `npm run test:each` → `fail=0`, không còn file `CRASH` chưa chạy lại.

- [ ] **Step 5:** `BACKEND.md` — thêm mục "Phân quyền": mã quyền trong `lib/permissions.js`; thêm quyền mới = thêm vào `PERMISSION_GROUPS` + migration seed cho vai trò cần có; migration `0042` phải chạy remote trước khi merge; cột cờ cũ còn trong bảng nhưng không dùng.

- [ ] **Step 6: Commit**

```bash
git add lib functions/api/auth test BACKEND.md
git commit -m "refactor(permissions): drop legacy role arrays and permission flags"
```
