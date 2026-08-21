# Manager Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manager-only "Tổng quan số liệu" dashboard page showing today's room-operations snapshot and a selectable month's occupancy/revenue-estimate/booking-funnel/source-breakdown, backed by one new aggregation endpoint.

**Architecture:** A new `lib/dashboardMetrics.js` module computes two pure, testable metric objects (`getTodaySnapshot`, `getMonthSummary`) against the existing `bookings`/`rooms` tables — no schema changes. A new `GET /api/dashboard/summary` endpoint (manager-only) wires them together behind one auth check. A new `admin/dashboard.html` + `admin/dashboard.js` page renders the result; existing admin pages get a nav link to it.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), Vitest + `@cloudflare/vitest-pool-workers`, vanilla JS admin frontend, Playwright e2e (sibling repo).

**Spec:** `docs/specs/2026-08-21-manager-dashboard-design.md`

## Global Constraints

- Manager-only: every new endpoint uses `requireAuth(request, env, ['manager'])` — not `['reception', 'manager']` like the booking/room endpoints. `requireAuth` returns `401` when there is no session at all, and `403` when a session exists but the role isn't in the allowed list (verified against `lib/requireAuth.js`) — tests and frontend error handling must expect `403` for a logged-in reception-role request, not `401`.
- All "today" computation happens in the `Asia/Ho_Chi_Minh` timezone via `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })`, matching `admin/reception.js`'s `todayISO()` — never `new Date().toISOString()` (UTC), which was the source of a timezone bug fixed in the previous plan.
- Departures counted as `check_out <= today` (not `=`), matching the previous plan's final-review fix, so an overdue checked-in booking still counts.
- "This month" is overlap-based for every figure: a booking is included in month `M` if `check_in < M_end AND check_out > M_start`, regardless of `created_at` or which month `check_in` itself falls in. Occupancy/revenue count only the nights that fall inside `[M_start, M_end)`; the status funnel and source breakdown count the whole booking once per overlapping month.
- `estimatedRevenueVnd` uses `lib/roomTypes.js`'s existing `ROOM_TYPES[type].priceVnd` verbatim — no new pricing data, no new table.
- All user-facing error strings are Vietnamese, matching the `jsonError(message, status)` convention used throughout `functions/api/`.
- No new database tables or migrations — this feature only reads `bookings` and `rooms`, both created by `migrations/0004_bookings_and_rooms.sql`.

---

### Task 1: `getTodaySnapshot` — today's room/arrivals/departures counts

**Files:**
- Create: `lib/dashboardMetrics.js`
- Test: `test/dashboardMetrics.test.js`

**Interfaces:**
- Produces: `getTodaySnapshot(env): Promise<{ roomsOccupied: number, roomsNeedCleaning: number, roomsEmpty: number, arrivalsToday: number, departuresToday: number }>` — consumed by Task 3's endpoint.

This reuses the exact per-room status precedence already implemented in `functions/api/rooms/index.js` (`needs_cleaning` wins over `occupied`, which wins over `empty`), but returns aggregate counts instead of a per-room list.

- [ ] **Step 1: Write the failing tests**

Create `test/dashboardMetrics.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getTodaySnapshot } from '../lib/dashboardMetrics.js';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0');
});

describe('getTodaySnapshot', () => {
  it('counts all 16 active rooms as empty with no bookings', async () => {
    const snapshot = await getTodaySnapshot(env);
    expect(snapshot.roomsOccupied).toBe(0);
    expect(snapshot.roomsNeedCleaning).toBe(0);
    expect(snapshot.roomsEmpty).toBe(16);
    expect(snapshot.arrivalsToday).toBe(0);
    expect(snapshot.departuresToday).toBe(0);
  });

  it('counts a checked_in room as occupied', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2020-01-01', '2020-01-03', 'checked_in', 'website', '2020-01-01T00:00:00Z')`
    ).bind(room.id).run();

    const snapshot = await getTodaySnapshot(env);
    expect(snapshot.roomsOccupied).toBe(1);
    expect(snapshot.roomsEmpty).toBe(15);
  });

  it('needs_cleaning wins over occupied for the same room', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1 WHERE id = ?`).bind(room.id).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'vip', ?, '2020-01-01', '2020-01-03', 'checked_in', 'website', '2020-01-01T00:00:00Z')`
    ).bind(room.id).run();

    const snapshot = await getTodaySnapshot(env);
    expect(snapshot.roomsNeedCleaning).toBe(1);
    expect(snapshot.roomsOccupied).toBe(0);
  });

  it('counts a confirmed booking checking in today as an arrival', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2099-01-01', 'confirmed', 'website', '2020-01-01T00:00:00Z')`
    ).bind(today).run();

    const snapshot = await getTodaySnapshot(env);
    expect(snapshot.arrivalsToday).toBe(1);
  });

  it('counts an overdue checked_in booking (check_out before today) as a departure', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2020-01-01', ?, 'checked_in', 'website', '2020-01-01T00:00:00Z')`
    ).bind(yesterday).run();

    const snapshot = await getTodaySnapshot(env);
    expect(snapshot.departuresToday).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/dashboardMetrics.test.js`
Expected: FAIL — `lib/dashboardMetrics.js` doesn't exist yet (`Cannot find module`).

- [ ] **Step 3: Implement `getTodaySnapshot`**

Create `lib/dashboardMetrics.js`:

```js
export async function getTodaySnapshot(env) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

  const { results: rooms } = await env.DB.prepare(
    `SELECT id, needs_cleaning AS needsCleaning FROM rooms WHERE is_active = 1`
  ).all();

  const { results: checkedInRows } = await env.DB.prepare(
    `SELECT DISTINCT room_id FROM bookings WHERE status = 'checked_in' AND room_id IS NOT NULL`
  ).all();
  const checkedInIds = new Set(checkedInRows.map((r) => r.room_id));

  let roomsOccupied = 0;
  let roomsNeedCleaning = 0;
  let roomsEmpty = 0;
  for (const room of rooms) {
    if (room.needsCleaning) {
      roomsNeedCleaning++;
    } else if (checkedInIds.has(room.id)) {
      roomsOccupied++;
    } else {
      roomsEmpty++;
    }
  }

  const arrivalsRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM bookings WHERE status = 'confirmed' AND check_in = ?`
  ).bind(today).first();

  const departuresRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM bookings WHERE status = 'checked_in' AND check_out <= ?`
  ).bind(today).first();

  return {
    roomsOccupied,
    roomsNeedCleaning,
    roomsEmpty,
    arrivalsToday: arrivalsRow.c,
    departuresToday: departuresRow.c,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/dashboardMetrics.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/dashboardMetrics.js test/dashboardMetrics.test.js
git commit -m "feat: add getTodaySnapshot for the manager dashboard"
```

---

### Task 2: `getMonthSummary` — occupancy, revenue estimate, status funnel, source breakdown

**Files:**
- Modify: `lib/dashboardMetrics.js` (append)
- Test: `test/dashboardMetrics.test.js` (append)

**Interfaces:**
- Consumes: `ROOM_TYPES` from `lib/roomTypes.js` (`{ [roomType]: { label, priceVnd } }`, already exists).
- Produces: `getMonthSummary(env, month: 'YYYY-MM'): Promise<{ occupancyRate: number, estimatedRevenueVnd: number, statusFunnel: { pending, confirmed, checked_in, checked_out, cancelled }, sourceBreakdown: { website, phone, zalo, walk_in } }>` — consumed by Task 3's endpoint. Caller guarantees `month` already matches `/^\d{4}-(0[1-9]|1[0-2])$/` (validated in Task 3, not re-validated here).

- [ ] **Step 1: Write the failing tests**

Append to `test/dashboardMetrics.test.js` (add the import and a new `describe` block):

```js
import { getTodaySnapshot, getMonthSummary } from '../lib/dashboardMetrics.js';
```

(replace the existing single-name import line with the two-name one above), then add:

```js
describe('getMonthSummary', () => {
  it('returns zeros for a month with no bookings', async () => {
    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.occupancyRate).toBe(0);
    expect(summary.estimatedRevenueVnd).toBe(0);
    expect(summary.statusFunnel).toEqual({ pending: 0, confirmed: 0, checked_in: 0, checked_out: 0, cancelled: 0 });
    expect(summary.sourceBreakdown).toEqual({ website: 0, phone: 0, zalo: 0, walk_in: 0 });
  });

  it('splits a cross-month booking\'s nights correctly between the two months it overlaps', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-07-30', '2026-08-02', 'confirmed', 'website', '2026-07-01T00:00:00Z')`
    ).run();

    const july = await getMonthSummary(env, '2026-07');
    const august = await getMonthSummary(env, '2026-08');

    // circle = 600000 VND/night; stay is Jul30,Jul31,Aug1 = 3 nights total, split 2/1
    expect(july.estimatedRevenueVnd).toBe(2 * 600000);
    expect(august.estimatedRevenueVnd).toBe(1 * 600000);
    expect(july.statusFunnel.confirmed).toBe(1);
    expect(august.statusFunnel.confirmed).toBe(1);
  });

  it('excludes pending and cancelled bookings from occupancy and revenue but counts them in the status funnel', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-08-05', '2026-08-07', 'pending', 'website', '2026-08-01T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('B', '091', 'vip', '2026-08-05', '2026-08-07', 'cancelled', 'phone', '2026-08-01T00:00:00Z')`
    ).run();

    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.occupancyRate).toBe(0);
    expect(summary.estimatedRevenueVnd).toBe(0);
    expect(summary.statusFunnel.pending).toBe(1);
    expect(summary.statusFunnel.cancelled).toBe(1);
  });

  it('excludes cancelled bookings from source breakdown', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-08-05', '2026-08-07', 'cancelled', 'zalo', '2026-08-01T00:00:00Z')`
    ).run();

    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.sourceBreakdown.zalo).toBe(0);
  });

  it('computes occupancy rate as booked room-nights over active-room-nights for the month', async () => {
    // August 2026 has 31 days, 16 active rooms => 496 room-nights capacity; this booking is 10 nights
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-08-01', '2026-08-11', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).run();

    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.occupancyRate).toBeCloseTo(10 / (16 * 31), 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/dashboardMetrics.test.js`
Expected: FAIL — `getMonthSummary is not a function` (the new describe block's tests fail; Task 1's tests still pass).

- [ ] **Step 3: Implement `getMonthSummary`**

Append to `lib/dashboardMetrics.js`:

```js
import { ROOM_TYPES } from './roomTypes.js';

function monthBounds(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = `${month}-01`;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const nextYear = mon === 12 ? year + 1 : year;
  const end = `${String(nextYear).padStart(4, '0')}-${String(nextMon).padStart(2, '0')}-01`;
  return { start, end };
}

function nightsInRange(checkIn, checkOut, rangeStart, rangeEnd) {
  const clampedStart = checkIn > rangeStart ? checkIn : rangeStart;
  const clampedEnd = checkOut < rangeEnd ? checkOut : rangeEnd;
  const nights = (Date.parse(clampedEnd) - Date.parse(clampedStart)) / 86400000;
  return nights > 0 ? nights : 0;
}

export async function getMonthSummary(env, month) {
  const { start, end } = monthBounds(month);
  const daysInMonth = (Date.parse(end) - Date.parse(start)) / 86400000;

  const activeRoomsRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM rooms WHERE is_active = 1`).first();
  const activeRoomsCount = activeRoomsRow.c;

  const { results: overlapping } = await env.DB.prepare(
    `SELECT status, source, room_type AS roomType, check_in AS checkIn, check_out AS checkOut
     FROM bookings WHERE check_in < ? AND check_out > ?`
  ).bind(end, start).all();

  const statusFunnel = { pending: 0, confirmed: 0, checked_in: 0, checked_out: 0, cancelled: 0 };
  const sourceBreakdown = { website: 0, phone: 0, zalo: 0, walk_in: 0 };
  let occupiedNights = 0;
  let revenueVnd = 0;

  for (const b of overlapping) {
    statusFunnel[b.status]++;
    if (b.status !== 'cancelled') {
      sourceBreakdown[b.source]++;
    }
    if (b.status === 'confirmed' || b.status === 'checked_in' || b.status === 'checked_out') {
      const nights = nightsInRange(b.checkIn, b.checkOut, start, end);
      occupiedNights += nights;
      revenueVnd += nights * ROOM_TYPES[b.roomType].priceVnd;
    }
  }

  const occupancyRate = activeRoomsCount > 0 ? occupiedNights / (activeRoomsCount * daysInMonth) : 0;

  return { occupancyRate, estimatedRevenueVnd: revenueVnd, statusFunnel, sourceBreakdown };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/dashboardMetrics.test.js`
Expected: PASS (10 tests total — 5 from Task 1, 5 new)

- [ ] **Step 5: Commit**

```bash
git add lib/dashboardMetrics.js test/dashboardMetrics.test.js
git commit -m "feat: add getMonthSummary for the manager dashboard"
```

---

### Task 3: `GET /api/dashboard/summary` endpoint

**Files:**
- Create: `functions/api/dashboard/summary.js`
- Test: `test/dashboardEndpoint.test.js`

**Interfaces:**
- Consumes: `getTodaySnapshot(env)` and `getMonthSummary(env, month)` from `lib/dashboardMetrics.js` (Tasks 1-2); `requireAuth(request, env, allowedRoles)` from `lib/requireAuth.js` (existing).
- Produces: `GET /api/dashboard/summary?month=YYYY-MM` → `200 { month: string, today: {...}, monthSummary: {...} }`, consumed by Task 4's `admin/dashboard.js`.

- [ ] **Step 1: Write the failing tests**

Create `test/dashboardEndpoint.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getSummary } from '../functions/api/dashboard/summary.js';
import { createSession } from '../lib/auth.js';

let managerToken;
let receptionToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 2);
});

function authedRequest(url, token) {
  return new Request(url, { headers: { Cookie: `session=${token}` } });
}

describe('GET /api/dashboard/summary', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const response = await getSummary({ request: new Request('https://x/api/dashboard/summary'), env });
    expect(response.status).toBe(401);
  });

  it('rejects reception-role requests with 403 (manager-only)', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary', receptionToken), env });
    expect(response.status).toBe(403);
  });

  it('returns today and monthSummary for a manager, defaulting to the current month', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    const expectedMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
    expect(body.month).toBe(expectedMonth);
    expect(body.today).toHaveProperty('roomsOccupied');
    expect(body.today).toHaveProperty('roomsEmpty');
    expect(body.monthSummary).toHaveProperty('occupancyRate');
    expect(body.monthSummary).toHaveProperty('estimatedRevenueVnd');
    expect(body.monthSummary.statusFunnel).toEqual({ pending: 0, confirmed: 0, checked_in: 0, checked_out: 0, cancelled: 0 });
  });

  it('accepts an explicit month param', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary?month=2026-01', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.month).toBe('2026-01');
  });

  it('rejects an out-of-range month param with 400', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary?month=2026-13', managerToken), env });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed month param with 400', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary?month=August', managerToken), env });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/dashboardEndpoint.test.js`
Expected: FAIL — `functions/api/dashboard/summary.js` doesn't exist yet.

- [ ] **Step 3: Implement the endpoint**

Create `functions/api/dashboard/summary.js`:

```js
import { requireAuth } from '../../../lib/requireAuth.js';
import { getTodaySnapshot, getMonthSummary } from '../../../lib/dashboardMetrics.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

function currentMonth() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
}

const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || currentMonth();

  if (!MONTH_FORMAT.test(month)) {
    return jsonError('Tháng không hợp lệ, dùng định dạng YYYY-MM', 400);
  }

  const [todaySnapshot, monthSummary] = await Promise.all([
    getTodaySnapshot(env),
    getMonthSummary(env, month),
  ]);

  return new Response(JSON.stringify({ month, today: todaySnapshot, monthSummary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/dashboardEndpoint.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/api/dashboard/summary.js test/dashboardEndpoint.test.js
git commit -m "feat: add GET /api/dashboard/summary endpoint"
```

---

### Task 4: `admin/dashboard.html` page + nav wiring

**Files:**
- Create: `admin/dashboard.html`
- Create: `admin/dashboard.js`
- Modify: `admin/admin.css` (append)
- Modify: `admin/reception.html` (nav)
- Modify: `admin/manager.html` (nav)
- Modify: `admin/customers.html` (nav)
- Modify: `admin/templates.html` (nav)
- Modify: `admin/users.html` (nav)

**Interfaces:**
- Consumes: `GET /api/dashboard/summary?month=YYYY-MM` (Task 3) — response shape `{ month, today: { roomsOccupied, roomsNeedCleaning, roomsEmpty, arrivalsToday, departuresToday }, monthSummary: { occupancyRate, estimatedRevenueVnd, statusFunnel, sourceBreakdown } }`. `GET /api/auth/me` (existing) for the login-redirect check.

No automated test for this task — matches the established convention for every other admin page in this codebase (verified by manual reasoning-trace during implementation and by the e2e spec in Task 5), per `docs/superpowers/plans/2026-08-21-booking-and-daily-ops-plan.md`'s Task 14 precedent.

- [ ] **Step 1: Add dashboard stat-card CSS**

Append to `admin/admin.css`:

```css
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
  margin: 12px 0 24px;
}
.stat-card {
  background: rgba(245, 240, 230, 0.06);
  border: 1px solid rgba(245, 240, 230, 0.15);
  border-radius: 6px;
  padding: 14px;
  text-align: center;
}
.stat-value {
  font-family: var(--font-serif);
  font-size: 1.8rem;
  color: var(--gold);
  font-weight: 600;
}
.stat-label {
  font-size: 0.8rem;
  opacity: 0.8;
  margin-top: 4px;
}
```

- [ ] **Step 2: Create `admin/dashboard.html`**

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Tổng quan số liệu — Hiền Lê Garden CRM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="admin.css" />
</head>
<body>
  <div class="page page-wide">
    <h1>Tổng quan số liệu</h1>
    <nav>
      <a href="reception.html">Vận hành hôm nay &rarr;</a>
      <a href="manager.html">Cấu hình &rarr;</a>
      <a href="customers.html">Danh sách khách hàng &rarr;</a>
      <a href="templates.html">Kho template &rarr;</a>
      <a href="users.html">Quản lý user &rarr;</a>
    </nav>
    <p id="dashboardError" class="error"></p>

    <h2>Hôm nay</h2>
    <div class="stat-grid" id="todayStats"></div>

    <h2>Theo tháng</h2>
    <label>Chọn tháng <input type="month" id="monthInput" /></label>

    <div class="stat-grid" id="monthStats"></div>

    <h3>Phễu trạng thái booking</h3>
    <div class="table-scroll">
      <table id="funnelTable">
        <thead><tr><th>Trạng thái</th><th>Số lượng</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>

    <h3>Nguồn đặt phòng</h3>
    <div class="table-scroll">
      <table id="sourceTable">
        <thead><tr><th>Nguồn</th><th>Số lượng</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>

  <script src="dashboard.js"></script>
  <script src="change-password.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `admin/dashboard.js`**

```js
// admin/dashboard.js
const STATUS_LABELS = {
  pending: 'Chờ xử lý',
  confirmed: 'Đã xác nhận',
  checked_in: 'Đang ở',
  checked_out: 'Đã trả phòng',
  cancelled: 'Đã huỷ',
};

const SOURCE_LABELS = {
  website: 'Website',
  phone: 'Điện thoại',
  zalo: 'Zalo',
  walk_in: 'Khách vãng lai',
};

function currentMonthValue() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
}

function formatVnd(amount) {
  return amount.toLocaleString('vi-VN') + 'đ';
}

function showDashboardError(message) {
  document.getElementById('dashboardError').textContent = message || '';
}

function renderStatCards(containerId, cards) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  cards.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'stat-card';
    const value = document.createElement('div');
    value.className = 'stat-value';
    value.textContent = c.value;
    const label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = c.label;
    div.appendChild(value);
    div.appendChild(label);
    container.appendChild(div);
  });
}

function renderCountTable(tbodySelector, counts, labels) {
  const tbody = document.querySelector(tbodySelector);
  tbody.innerHTML = '';
  Object.entries(counts).forEach(([key, count]) => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = labels[key] || key;
    const tdCount = document.createElement('td');
    tdCount.textContent = count;
    tr.appendChild(tdLabel);
    tr.appendChild(tdCount);
    tbody.appendChild(tr);
  });
}

function renderSummary(data) {
  renderStatCards('todayStats', [
    { label: 'Đang có khách', value: data.today.roomsOccupied },
    { label: 'Cần dọn', value: data.today.roomsNeedCleaning },
    { label: 'Còn trống', value: data.today.roomsEmpty },
    { label: 'Khách đến hôm nay', value: data.today.arrivalsToday },
    { label: 'Khách đi hôm nay', value: data.today.departuresToday },
  ]);

  renderStatCards('monthStats', [
    { label: 'Tỷ lệ lấp đầy', value: `${Math.round(data.monthSummary.occupancyRate * 100)}%` },
    { label: 'Doanh thu ước tính', value: formatVnd(data.monthSummary.estimatedRevenueVnd) },
  ]);

  renderCountTable('#funnelTable tbody', data.monthSummary.statusFunnel, STATUS_LABELS);
  renderCountTable('#sourceTable tbody', data.monthSummary.sourceBreakdown, SOURCE_LABELS);
}

async function loadSummary(month) {
  showDashboardError('');
  let response;
  try {
    response = await fetch(`/api/dashboard/summary?month=${month}`);
  } catch (err) {
    showDashboardError('Không thể kết nối — vui lòng thử lại.');
    return;
  }
  if (!response.ok) {
    if (response.status === 401) {
      window.location.href = 'login.html';
      return;
    }
    const body = await response.json().catch(() => ({}));
    showDashboardError(body.error || 'Có lỗi khi tải số liệu');
    return;
  }
  const data = await response.json();
  renderSummary(data);
}

(async () => {
  let res;
  try {
    res = await fetch('/api/auth/me');
  } catch (err) {
    showDashboardError('Không thể kết nối — vui lòng thử lại.');
    return;
  }
  if (!res.ok) {
    window.location.href = 'login.html';
    return;
  }

  const monthInput = document.getElementById('monthInput');
  monthInput.value = currentMonthValue();
  monthInput.addEventListener('change', () => loadSummary(monthInput.value));
  await loadSummary(monthInput.value);
})();
```

- [ ] **Step 4: Add the dashboard link to every existing admin page's nav, and fix `manager.html`'s stale "Tra cứu mã" label**

In `admin/reception.html`, change:

```html
    <nav><a href="manager.html">Cấu hình &rarr;</a> <a href="customers.html">Danh sách khách hàng &rarr;</a></nav>
```

to:

```html
    <nav><a href="dashboard.html">Tổng quan &rarr;</a> <a href="manager.html">Cấu hình &rarr;</a> <a href="customers.html">Danh sách khách hàng &rarr;</a></nav>
```

In `admin/manager.html`, change (note: `reception.html`'s label is fixed here too — it was still "Tra cứu mã" from before `reception.html` became the ops board in the previous plan):

```html
    <nav><a href="reception.html">Tra cứu mã &rarr;</a> <a href="customers.html">Danh sách khách hàng &rarr;</a> <a href="templates.html">Kho template &rarr;</a> <a href="users.html">Quản lý user &rarr;</a></nav>
```

to:

```html
    <nav><a href="dashboard.html">Tổng quan &rarr;</a> <a href="reception.html">Vận hành hôm nay &rarr;</a> <a href="customers.html">Danh sách khách hàng &rarr;</a> <a href="templates.html">Kho template &rarr;</a> <a href="users.html">Quản lý user &rarr;</a></nav>
```

In `admin/customers.html`, change:

```html
    <nav>
      <a href="manager.html">Cấu hình &rarr;</a>
      <a href="templates.html">Kho template &rarr;</a>
      <a href="users.html">Quản lý user &rarr;</a>
    </nav>
```

to:

```html
    <nav>
      <a href="dashboard.html">Tổng quan &rarr;</a>
      <a href="manager.html">Cấu hình &rarr;</a>
      <a href="templates.html">Kho template &rarr;</a>
      <a href="users.html">Quản lý user &rarr;</a>
    </nav>
```

In `admin/templates.html`, change:

```html
    <nav>
      <a href="manager.html">Cấu hình &rarr;</a>
      <a href="customers.html">Danh sách khách hàng &rarr;</a>
      <a href="users.html">Quản lý user &rarr;</a>
    </nav>
```

to:

```html
    <nav>
      <a href="dashboard.html">Tổng quan &rarr;</a>
      <a href="manager.html">Cấu hình &rarr;</a>
      <a href="customers.html">Danh sách khách hàng &rarr;</a>
      <a href="users.html">Quản lý user &rarr;</a>
    </nav>
```

In `admin/users.html`, change:

```html
    <nav>
      <a href="manager.html">Cấu hình &rarr;</a>
      <a href="customers.html">Danh sách khách hàng &rarr;</a>
      <a href="templates.html">Kho template &rarr;</a>
    </nav>
```

to:

```html
    <nav>
      <a href="dashboard.html">Tổng quan &rarr;</a>
      <a href="manager.html">Cấu hình &rarr;</a>
      <a href="customers.html">Danh sách khách hàng &rarr;</a>
      <a href="templates.html">Kho template &rarr;</a>
    </nav>
```

- [ ] **Step 5: Manual verification**

Run: `npx vitest run` (confirm nothing broke — this task touches no backend code, so this is a sanity check, not new coverage).
Expected: PASS, same count as before this task.

Then start a local static server (`npx http-server . -p 4174 -s -c-1` from the repo root) and manually open `admin/dashboard.html` in a browser, logged in as a manager account, to confirm the page renders without console errors and the month input reacts to changes. (Task 5's e2e spec formalizes this with mocked responses; this manual pass is a quick sanity check before that.)

- [ ] **Step 6: Commit**

```bash
git add admin/dashboard.html admin/dashboard.js admin/admin.css admin/reception.html admin/manager.html admin/customers.html admin/templates.html admin/users.html
git commit -m "feat: add the manager dashboard page and wire it into admin nav"
```

---

### Task 5: E2e coverage for the dashboard

**Files:**
- Create: `tests/e2e/manager-dashboard.spec.js` — **in the sibling `hien-le-garden-landing` repo** at `D:\VDX\HienLeGarden\LandingPage\tests\e2e\manager-dashboard.spec.js`, NOT in the `hien-le-garden-v4` repo this plan otherwise lives in. This mirrors `tests/e2e/reception-ops-board.spec.js` and `tests/e2e/crm-users.spec.js`, both already in that sibling repo for the same reason (the Playwright suite and its `page.route()` mocking live there, per `BACKEND.md`'s documented split of responsibility).

**Interfaces:**
- Consumes: `admin/dashboard.html`/`admin/dashboard.js` (Task 4) — mocks `GET /api/auth/me` and `GET /api/dashboard/summary` via `page.route()`, exercises no live backend.

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/manager-dashboard.spec.js` in the `hien-le-garden-landing` repo:

```js
// tests/e2e/manager-dashboard.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Manager dashboard', () => {
  test('renders today and month figures from the summary endpoint', async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'quan_ly_a', role: 'manager' }) })
    );
    await page.route('**/api/dashboard/summary**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          month: '2026-08',
          today: { roomsOccupied: 9, roomsNeedCleaning: 2, roomsEmpty: 5, arrivalsToday: 3, departuresToday: 2 },
          monthSummary: {
            occupancyRate: 0.62,
            estimatedRevenueVnd: 18400000,
            statusFunnel: { pending: 4, confirmed: 6, checked_in: 3, checked_out: 20, cancelled: 2 },
            sourceBreakdown: { website: 14, phone: 9, zalo: 8, walk_in: 4 },
          },
        }),
      })
    );

    await page.goto('/admin/dashboard.html');

    await expect(page.locator('#todayStats')).toContainText('9');
    await expect(page.locator('#todayStats')).toContainText('Đang có khách');
    await expect(page.locator('#monthStats')).toContainText('62%');
    await expect(page.locator('#funnelTable')).toContainText('Chờ xử lý');
    await expect(page.locator('#funnelTable')).toContainText('4');
    await expect(page.locator('#sourceTable')).toContainText('Website');
    await expect(page.locator('#sourceTable')).toContainText('14');
  });

  test('redirects to login.html when not authenticated', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401 }));
    await page.goto('/admin/dashboard.html');
    await page.waitForURL('**/admin/login.html');
  });

  test('shows an inline error when logged in as reception (403, not manager)', async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'le_tan_a', role: 'reception' }) })
    );
    await page.route('**/api/dashboard/summary**', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Không đủ quyền' }) })
    );

    await page.goto('/admin/dashboard.html');
    await expect(page.locator('#dashboardError')).toHaveText('Không đủ quyền');
  });
});
```

- [ ] **Step 2: Run the spec against the local dev server**

From the `hien-le-garden-landing` repo root, with a static server serving the up-to-date `v4/` directory on the port `playwright.config.js` expects:

Run: `npx playwright test tests/e2e/manager-dashboard.spec.js --project=v4`
Expected: PASS (3 tests) — if the server isn't already running on the configured port, start one first (`npx http-server . -p 4174 -s -c-1` from the directory containing the up-to-date `admin/` folder), matching the same manual server setup used in the previous plan's live verification.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/manager-dashboard.spec.js
git commit -m "test: add e2e coverage for the manager dashboard"
```
