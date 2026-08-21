# Booking Requests & Daily Operations Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the homepage's existing (currently non-functional) booking UI to a real backend, and replace `admin/reception.html`'s promo-lookup home with a daily operations board — closing the site's biggest gap: no real reservation system and no view of today's arrivals/departures/room status.

**Architecture:** Two new D1 tables (`rooms`, `bookings`). A shared `lib/bookingAvailability.js` computes per-type availability and per-room conflict checks, used by the public availability endpoint, both booking-creation endpoints, and the confirm step. Guests submit `pending` requests (no inventory lock); staff confirm (assigning one of 16 real physical units) or reject from the new ops board, which also drives check-in/check-out and room-cleaning status.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), Vitest + `@cloudflare/vitest-pool-workers`, vanilla JS admin pages (no framework, matching `admin/*.html`+`.js`), Playwright for e2e (in the sibling `hien-le-garden-landing` repo).

**Spec:** `docs/specs/2026-08-21-booking-and-daily-ops-design.md` (in the `hien-le-garden-landing` repo root, not this `v4` repo)

## Global Constraints

- Every new/modified Function that requires staff auth uses `requireAuth(request, env, [roles])` from `lib/requireAuth.js` — never a new auth mechanism. `GET /api/availability` and `POST /api/bookings` are public (no auth call at all), matching `functions/api/feedback.js`'s precedent for guest-facing writes.
- No CORS handling on any new endpoint — the booking modal is same-origin only, matching `functions/api/policy.js`/`functions/api/gift-inventory.js`'s no-CORS precedent (not `feedback.js`, which adds CORS only because the survey page is designed to be embeddable elsewhere).
- Every `jsonError(message, status)` helper and Vietnamese error-message tone matches the existing files exactly (see `functions/api/policy.js`, `functions/api/customers/index.js`).
- `check_in`/`check_out` are ISO date strings (`YYYY-MM-DD`), always compared as plain strings (valid for ISO dates) — never parsed to `Date` objects for comparison inside SQL or JS overlap logic. A stay occupies `[check_in, check_out)`: a checkout day is not occupied, so same-day turnover on one room is allowed.
- After every mutating JSON body is parsed, guard against a `null`/non-object result before destructuring (`body = body || {};`) — a `POST` with body literal `null` or no body at all must 400/proceed gracefully, never 500.
- Every mutating `fetch()` in new frontend JS checks `response.ok` before treating the call as successful, and surfaces `body.error` inline — never `alert()`/`prompt()`.
- Every element toggled via `classList.add/remove/toggle('hidden')` must have `class="hidden"` in its HTML, never the `hidden` boolean attribute — the two are unrelated mechanisms and mixing them silently breaks the toggle.
- No `innerHTML` assignment ever receives interpolated dynamic/user-controlled data — build with `textContent`/`createElement`/property assignment instead. The only acceptable `innerHTML` use is clearing content (`el.innerHTML = ''`).
- An auth-gated page's first data load happens *inside* the `/api/auth/me` IIFE, after auth succeeds — never as a bare module-scope call racing the auth check.
- Admin pages reuse `admin/admin.css` (dark green `#0D1F14` / gold `#C9A84C`, Cormorant Garamond + Inter) and existing classes (`.page`, `.page-wide`, `.error`, `.hidden`, `.table-scroll`/`table`, `.status-badge`) — new classes are added by appending to `admin.css`, never a competing style system.
- All new Vitest test files live in `v4/test/*.test.js` and follow the existing `authedRequest(url, token, method, body)` / `postReq(url, body)` helper pattern already used across the codebase — defined locally per file (no shared test-helpers file exists yet).
- Any test that depends on "today's date" computes it at runtime (`new Date().toISOString().slice(0, 10)`) — never hardcodes a specific calendar date for "today", since the suite runs on whatever date it's actually executed.
- After every task, run `npm test` from `v4/` — it auto-retries known Windows-only infra flakes (see `BACKEND.md`); a real failure surfaces as `N failed` in the summary and must be fixed before moving on.
- Migration file: `migrations/0004_bookings_and_rooms.sql`, applied locally via the existing `vitest.config.js`/`test/apply-migrations.js` machinery automatically — applying it to the **real remote D1** (`wrangler d1 migrations apply hien_le_garden_crm --remote`) happens once, after this plan's tasks are all merged, not as part of any individual task.
- `ROOM_TYPES` values (`triangle`, `circle`, `ede_cozy`, `vip`, `bungalow`, `dormitory`) are the single source of truth for the room-type enum everywhere — `lib/roomTypes.js` (Task 2) is the only place the price is written, and every backend endpoint that validates a `roomType` (Tasks 4, 5, 6) imports its keys rather than hardcoding a fourth copy of the six codes. Frontend files (`index.html` in Task 13, `admin/reception.js` in Task 14) cannot import a backend `lib/` module, so each keeps its own small label map for display purposes only — the three copies (`lib/roomTypes.js`, `index.html`'s `BM_ROOM_TYPE_NAMES`, `admin/reception.js`'s `ROOM_TYPE_LABELS`) must stay in sync on the Vietnamese label text, matching this codebase's existing precedent of small per-file display maps (e.g. each admin page's own `statusLabel()`-style function).

---

### Task 1: Migration — `rooms` and `bookings` tables, seed the 16 real rooms

**Files:**
- Create: `migrations/0004_bookings_and_rooms.sql`
- Test: `test/migrations.test.js` (append)

**Interfaces:**
- Produces: `rooms(id, name, room_type, is_active, needs_cleaning)` seeded with 16 rows (3 Triangle House, 5 Circle House, 2 Ê Đê Cozy House, 2 VIP House, 3 Bungalow Gia Đình, 1 Phòng Tập Thể), and `bookings(id, guest_name, phone, email, room_type, room_id, check_in, check_out, guests_count, notes, status, source, cancel_reason, created_at, created_by, confirmed_by, confirmed_at)` — every later task's DB queries against these tables use exactly these column names.

- [ ] **Step 1: Write the migration file**

```sql
CREATE TABLE rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  room_type TEXT NOT NULL CHECK (room_type IN ('triangle', 'circle', 'ede_cozy', 'vip', 'bungalow', 'dormitory')),
  is_active INTEGER NOT NULL DEFAULT 1,
  needs_cleaning INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_rooms_type_active ON rooms(room_type, is_active);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  room_type TEXT NOT NULL CHECK (room_type IN ('triangle', 'circle', 'ede_cozy', 'vip', 'bungalow', 'dormitory')),
  room_id INTEGER REFERENCES rooms(id),
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  guests_count INTEGER,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled')) DEFAULT 'pending',
  source TEXT NOT NULL CHECK (source IN ('website', 'phone', 'zalo', 'walk_in')) DEFAULT 'website',
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT
);

CREATE INDEX idx_bookings_dates ON bookings(check_in, check_out);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_room ON bookings(room_id);

INSERT INTO rooms (name, room_type) VALUES
  ('Triangle House 1', 'triangle'),
  ('Triangle House 2', 'triangle'),
  ('Triangle House 3', 'triangle'),
  ('Circle House 1', 'circle'),
  ('Circle House 2', 'circle'),
  ('Circle House 3', 'circle'),
  ('Circle House 4', 'circle'),
  ('Circle House 5', 'circle'),
  ('Ê Đê Cozy House 1', 'ede_cozy'),
  ('Ê Đê Cozy House 2', 'ede_cozy'),
  ('VIP House 1', 'vip'),
  ('VIP House 2', 'vip'),
  ('Bungalow Gia Đình 1', 'bungalow'),
  ('Bungalow Gia Đình 2', 'bungalow'),
  ('Bungalow Gia Đình 3', 'bungalow'),
  ('Phòng Tập Thể 1', 'dormitory');
```

- [ ] **Step 2: Write the failing test**

Append to `test/migrations.test.js`:

```js
describe('migration 0004', () => {
  it('seeds exactly 16 active rooms matching the real inventory counts', async () => {
    const { results } = await env.DB.prepare(
      `SELECT room_type, COUNT(*) as count FROM rooms WHERE is_active = 1 GROUP BY room_type ORDER BY room_type`
    ).all();
    expect(results).toEqual([
      { room_type: 'bungalow', count: 3 },
      { room_type: 'circle', count: 5 },
      { room_type: 'dormitory', count: 1 },
      { room_type: 'ede_cozy', count: 2 },
      { room_type: 'triangle', count: 3 },
      { room_type: 'vip', count: 2 },
    ]);
  });

  it('seeds no room already needing cleaning', async () => {
    const { results } = await env.DB.prepare(`SELECT COUNT(*) as count FROM rooms WHERE needs_cleaning = 1`).all();
    expect(results[0].count).toBe(0);
  });

  it('creates an empty bookings table', async () => {
    const { results } = await env.DB.prepare(`SELECT * FROM bookings`).all();
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/migrations.test.js` — Expected: FAIL (`no such table: rooms`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/migrations.test.js` — vitest auto-applies every file in `migrations/` via `test/apply-migrations.js`, so no other change is needed. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations/0004_bookings_and_rooms.sql test/migrations.test.js
git commit -m "feat: add rooms and bookings tables, seed the 16 real physical units"
```

---

### Task 2: `lib/roomTypes.js` — shared room-type label/price mapping

**Files:**
- Create: `lib/roomTypes.js`
- Test: `test/roomTypes.test.js`

**Interfaces:**
- Produces: `ROOM_TYPES` — `{ [code]: { label: string, priceVnd: number } }` for the six codes. Task 14's `admin/reception.js` keeps its own copy of the label subset (frontend files don't import backend `lib/`), matching the values here exactly.

- [ ] **Step 1: Write the failing test**

```js
// test/roomTypes.test.js
import { describe, it, expect } from 'vitest';
import { ROOM_TYPES } from '../lib/roomTypes.js';

describe('ROOM_TYPES', () => {
  it('has exactly the six room types, each with a label and a price', () => {
    expect(Object.keys(ROOM_TYPES)).toEqual(['triangle', 'circle', 'ede_cozy', 'vip', 'bungalow', 'dormitory']);
    Object.values(ROOM_TYPES).forEach((t) => {
      expect(t.label).toBeTypeOf('string');
      expect(t.priceVnd).toBeTypeOf('number');
    });
  });

  it('matches the prices already published on bang-gia/index.html', () => {
    expect(ROOM_TYPES.triangle).toEqual({ label: 'Triangle House', priceVnd: 300000 });
    expect(ROOM_TYPES.circle).toEqual({ label: 'Circle House', priceVnd: 600000 });
    expect(ROOM_TYPES.ede_cozy).toEqual({ label: 'Ê Đê Cozy House', priceVnd: 700000 });
    expect(ROOM_TYPES.vip).toEqual({ label: 'VIP House', priceVnd: 900000 });
    expect(ROOM_TYPES.bungalow).toEqual({ label: 'Bungalow Gia Đình', priceVnd: 700000 });
    expect(ROOM_TYPES.dormitory).toEqual({ label: 'Phòng Tập Thể', priceVnd: 1200000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/roomTypes.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// lib/roomTypes.js
export const ROOM_TYPES = {
  triangle: { label: 'Triangle House', priceVnd: 300000 },
  circle: { label: 'Circle House', priceVnd: 600000 },
  ede_cozy: { label: 'Ê Đê Cozy House', priceVnd: 700000 },
  vip: { label: 'VIP House', priceVnd: 900000 },
  bungalow: { label: 'Bungalow Gia Đình', priceVnd: 700000 },
  dormitory: { label: 'Phòng Tập Thể', priceVnd: 1200000 },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/roomTypes.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/roomTypes.js test/roomTypes.test.js
git commit -m "feat: add shared room-type label/price mapping"
```

---

### Task 3: `lib/bookingAvailability.js` — availability count/list and per-room conflict check

**Files:**
- Create: `lib/bookingAvailability.js`
- Test: `test/bookingAvailability.test.js`

**Interfaces:**
- Produces: `getAvailability(env, roomType, checkIn, checkOut) -> Promise<{roomType, totalRooms, bookedCount, available, availableRooms: [{id, name}]}>` and `hasRoomConflict(env, roomId, checkIn, checkOut) -> Promise<boolean>` — Task 4 (public availability endpoint), Task 6 (staff create), and Task 7 (confirm) import both.

- [ ] **Step 1: Write the failing test**

```js
// test/bookingAvailability.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getAvailability, hasRoomConflict } from '../lib/bookingAvailability.js';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM bookings');
});

describe('getAvailability', () => {
  it('returns all 5 Circle House rooms available when there are no bookings', async () => {
    const result = await getAvailability(env, 'circle', '2026-09-01', '2026-09-03');
    expect(result.totalRooms).toBe(5);
    expect(result.available).toBe(5);
    expect(result.bookedCount).toBe(0);
    expect(result.availableRooms).toHaveLength(5);
  });

  it('excludes a room booked with an overlapping confirmed stay', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2026-09-01', '2026-09-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const result = await getAvailability(env, 'circle', '2026-09-01', '2026-09-03');
    expect(result.available).toBe(4);
    expect(result.availableRooms.find((r) => r.id === room.id)).toBeUndefined();
  });

  it('does not count a pending request against availability', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2026-09-01', '2026-09-03', 'pending', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const result = await getAvailability(env, 'circle', '2026-09-01', '2026-09-03');
    expect(result.available).toBe(5);
  });

  it('treats back-to-back stays (checkout day = next checkin day) as non-overlapping', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2026-09-01', '2026-09-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const result = await getAvailability(env, 'circle', '2026-09-03', '2026-09-05');
    expect(result.available).toBe(5);
  });
});

describe('hasRoomConflict', () => {
  it('returns false when the room has no bookings', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    expect(await hasRoomConflict(env, room.id, '2026-09-01', '2026-09-03')).toBe(false);
  });

  it('returns true when the exact same room overlaps a confirmed booking', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'vip', ?, '2026-09-01', '2026-09-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    expect(await hasRoomConflict(env, room.id, '2026-09-02', '2026-09-04')).toBe(true);
  });

  it('returns false for a checked_out booking on the same room and dates', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'vip', ?, '2026-09-01', '2026-09-03', 'checked_out', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    expect(await hasRoomConflict(env, room.id, '2026-09-01', '2026-09-03')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bookingAvailability.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// lib/bookingAvailability.js
export async function getAvailability(env, roomType, checkIn, checkOut) {
  const { results: allRooms } = await env.DB.prepare(
    `SELECT id, name FROM rooms WHERE room_type = ? AND is_active = 1 ORDER BY name`
  ).bind(roomType).all();

  const { results: bookedRows } = await env.DB.prepare(
    `SELECT DISTINCT room_id FROM bookings
     WHERE room_type = ? AND room_id IS NOT NULL AND status IN ('confirmed', 'checked_in')
       AND check_in < ? AND check_out > ?`
  ).bind(roomType, checkOut, checkIn).all();

  const bookedIds = new Set(bookedRows.map((r) => r.room_id));
  const availableRooms = allRooms.filter((r) => !bookedIds.has(r.id));

  return {
    roomType,
    totalRooms: allRooms.length,
    bookedCount: bookedIds.size,
    available: availableRooms.length,
    availableRooms: availableRooms.map((r) => ({ id: r.id, name: r.name })),
  };
}

export async function hasRoomConflict(env, roomId, checkIn, checkOut) {
  const row = await env.DB.prepare(
    `SELECT id FROM bookings
     WHERE room_id = ? AND status IN ('confirmed', 'checked_in')
       AND check_in < ? AND check_out > ?
     LIMIT 1`
  ).bind(roomId, checkOut, checkIn).first();
  return !!row;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bookingAvailability.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bookingAvailability.js test/bookingAvailability.test.js
git commit -m "feat: add getAvailability and hasRoomConflict shared logic"
```

---

### Task 4: `GET /api/availability` (public)

**Files:**
- Create: `functions/api/availability.js`
- Test: `test/availabilityEndpoint.test.js`

**Interfaces:**
- Consumes: `getAvailability` from Task 3; `ROOM_TYPES` from Task 2 (its keys are the validation list, replacing what would otherwise be a fourth hardcoded copy of the six room-type codes).
- Produces: the endpoint Task 13 (guest modal) and Task 14 (ops board's room pickers) both call.

- [ ] **Step 1: Write the failing test**

```js
// test/availabilityEndpoint.test.js
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getAvailabilityEndpoint } from '../functions/api/availability.js';

function req(url) {
  return new Request(url);
}

describe('GET /api/availability', () => {
  it('returns availability for a valid room type and date range, no auth required', async () => {
    const response = await getAvailabilityEndpoint({ request: req('https://x/api/availability?roomType=triangle&checkIn=2026-09-01&checkOut=2026-09-03'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ roomType: 'triangle', totalRooms: 3, available: 3 });
  });

  it('rejects an invalid room type', async () => {
    const response = await getAvailabilityEndpoint({ request: req('https://x/api/availability?roomType=deluxe&checkIn=2026-09-01&checkOut=2026-09-03'), env });
    expect(response.status).toBe(400);
  });

  it('rejects a checkout date not after checkin', async () => {
    const response = await getAvailabilityEndpoint({ request: req('https://x/api/availability?roomType=triangle&checkIn=2026-09-03&checkOut=2026-09-01'), env });
    expect(response.status).toBe(400);
  });

  it('rejects a missing date', async () => {
    const response = await getAvailabilityEndpoint({ request: req('https://x/api/availability?roomType=triangle&checkIn=2026-09-01'), env });
    expect(response.status).toBe(400);
  });

  it('rejects an unparseable date', async () => {
    const response = await getAvailabilityEndpoint({ request: req('https://x/api/availability?roomType=triangle&checkIn=not-a-date&checkOut=2026-09-03'), env });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/availabilityEndpoint.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/availability.js
import { getAvailability } from '../../lib/bookingAvailability.js';
import { ROOM_TYPES } from '../../lib/roomTypes.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_ROOM_TYPES = Object.keys(ROOM_TYPES);

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const roomType = url.searchParams.get('roomType');
  const checkIn = url.searchParams.get('checkIn');
  const checkOut = url.searchParams.get('checkOut');

  if (!VALID_ROOM_TYPES.includes(roomType)) {
    return jsonError('Loại phòng không hợp lệ', 400);
  }
  if (!checkIn || !checkOut || isNaN(Date.parse(checkIn)) || isNaN(Date.parse(checkOut))) {
    return jsonError('Ngày không hợp lệ', 400);
  }
  if (checkOut <= checkIn) {
    return jsonError('Ngày trả phòng phải sau ngày nhận phòng', 400);
  }

  const availability = await getAvailability(env, roomType, checkIn, checkOut);
  return new Response(JSON.stringify(availability), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/availabilityEndpoint.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/availability.js test/availabilityEndpoint.test.js
git commit -m "feat: add GET /api/availability"
```

---

### Task 5: `functions/api/bookings/index.js` — `POST` (guest request) and `GET` (staff list/filter)

**Files:**
- Create: `functions/api/bookings/index.js`
- Test: `test/bookingsEndpoints.test.js`

**Interfaces:**
- Consumes: `requireAuth` from `lib/requireAuth.js`; `ROOM_TYPES` from Task 2.
- Produces: `POST /api/bookings` (Task 13 calls this) and `GET /api/bookings?status=&date=&view=` (Task 14's ops board calls this with `view` one of `arrivals`/`departures`/`inhouse`).

- [ ] **Step 1: Write the failing test**

```js
// test/bookingsEndpoints.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as createBooking, onRequestGet as listBookings } from '../functions/api/bookings/index.js';
import { createSession } from '../lib/auth.js';

let managerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
});

function postReq(url, body) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function authedRequest(url, token, method = 'GET') {
  return new Request(url, { method, headers: { Cookie: `session=${token}` } });
}

describe('POST /api/bookings', () => {
  const validBody = { guestName: 'Nguyễn Văn A', phone: '0900000001', roomType: 'circle', checkIn: '2099-01-01', checkOut: '2099-01-03' };

  it('creates a pending booking request with no auth required', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', validBody), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeTypeOf('number');

    const row = await env.DB.prepare(`SELECT status, source, room_id FROM bookings WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ status: 'pending', source: 'website', room_id: null });
  });

  it('rejects a missing guest name', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, guestName: '' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a missing phone', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, phone: '' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid room type', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, roomType: 'deluxe' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects checkOut not after checkIn', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, checkIn: '2099-01-03', checkOut: '2099-01-01' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a checkIn date in the past', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, checkIn: '2020-01-01', checkOut: '2020-01-03' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/bookings', { method: 'POST', body: 'not json' });
    const response = await createBooking({ request, env });
    expect(response.status).toBe(400);
  });

  it('rejects a null JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' });
    const response = await createBooking({ request, env });
    expect(response.status).toBe(400);
  });

  it('does not check availability before accepting the request', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'dormitory'`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('X', '090', 'dormitory', ?, '2099-02-01', '2099-02-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, roomType: 'dormitory', checkIn: '2099-02-01', checkOut: '2099-02-03' }), env });
    expect(response.status).toBe(201);
  });
});

describe('GET /api/bookings', () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Pending Guest', '090', 'circle', '2099-03-01', '2099-03-03', 'pending', 'website', '2026-08-01T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Arriving Today', '090', 'circle', ?, ?, 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(today, tomorrow).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Leaving Today', '090', 'circle', ?, ?, 'checked_in', 'website', '2026-08-01T00:00:00Z')`
    ).bind(yesterday, today).run();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await listBookings({ request: new Request('https://x/api/bookings'), env });
    expect(response.status).toBe(401);
  });

  it('filters by status', async () => {
    const response = await listBookings({ request: authedRequest('https://x/api/bookings?status=pending', managerToken), env });
    const body = await response.json();
    expect(body.map((b) => b.guestName)).toEqual(['Pending Guest']);
  });

  it('filters arrivals by date', async () => {
    const response = await listBookings({ request: authedRequest(`https://x/api/bookings?status=confirmed&date=${today}&view=arrivals`, managerToken), env });
    const body = await response.json();
    expect(body.map((b) => b.guestName)).toEqual(['Arriving Today']);
  });

  it('filters departures by date', async () => {
    const response = await listBookings({ request: authedRequest(`https://x/api/bookings?status=checked_in&date=${today}&view=departures`, managerToken), env });
    const body = await response.json();
    expect(body.map((b) => b.guestName)).toEqual(['Leaving Today']);
  });

  it('orders results by check_in ascending', async () => {
    const response = await listBookings({ request: authedRequest('https://x/api/bookings', managerToken), env });
    const body = await response.json();
    expect(body.map((b) => b.guestName)).toEqual(['Arriving Today', 'Leaving Today', 'Pending Guest']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bookingsEndpoints.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/bookings/index.js
import { requireAuth } from '../../../lib/requireAuth.js';
import { ROOM_TYPES } from '../../../lib/roomTypes.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_ROOM_TYPES = Object.keys(ROOM_TYPES);

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};

  const { guestName, phone, email, roomType, checkIn, checkOut, guestsCount, notes } = body;

  if (typeof guestName !== 'string' || guestName.trim().length === 0) {
    return jsonError('Vui lòng nhập họ tên', 400);
  }
  if (typeof phone !== 'string' || phone.trim().length === 0) {
    return jsonError('Vui lòng nhập số điện thoại', 400);
  }
  if (!VALID_ROOM_TYPES.includes(roomType)) {
    return jsonError('Loại phòng không hợp lệ', 400);
  }
  if (typeof checkIn !== 'string' || typeof checkOut !== 'string' || isNaN(Date.parse(checkIn)) || isNaN(Date.parse(checkOut))) {
    return jsonError('Ngày không hợp lệ', 400);
  }
  if (checkOut <= checkIn) {
    return jsonError('Ngày trả phòng phải sau ngày nhận phòng', 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (checkIn < today) {
    return jsonError('Ngày nhận phòng không thể ở quá khứ', 400);
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, email, room_type, check_in, check_out, guests_count, notes, status, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'website', ?)`
  )
    .bind(guestName.trim(), phone.trim(), email || null, roomType, checkIn, checkOut, guestsCount || null, notes || null, now)
    .run();

  return new Response(JSON.stringify({ id: result.meta.last_row_id }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const date = url.searchParams.get('date');
  const view = url.searchParams.get('view');

  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (date && view === 'arrivals') {
    conditions.push('check_in = ?');
    params.push(date);
  } else if (date && view === 'departures') {
    conditions.push('check_out = ?');
    params.push(date);
  } else if (date && view === 'inhouse') {
    conditions.push('check_out > ?');
    params.push(date);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT id, guest_name AS guestName, phone, email, room_type AS roomType, room_id AS roomId,
            check_in AS checkIn, check_out AS checkOut, guests_count AS guestsCount, notes, status, source,
            created_at AS createdAt, created_by AS createdBy, confirmed_by AS confirmedBy, confirmed_at AS confirmedAt,
            cancel_reason AS cancelReason
     FROM bookings ${where} ORDER BY check_in ASC`
  ).bind(...params).all();

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bookingsEndpoints.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/bookings/index.js test/bookingsEndpoints.test.js
git commit -m "feat: add POST/GET /api/bookings"
```

---

### Task 6: `functions/api/bookings/staff.js` — staff creates a confirmed booking directly

**Files:**
- Create: `functions/api/bookings/staff.js`
- Test: `test/bookingsStaffEndpoint.test.js`

**Interfaces:**
- Consumes: `requireAuth` from `lib/requireAuth.js`; `hasRoomConflict` from Task 3; `ROOM_TYPES` from Task 2.
- Produces: `POST /api/bookings/staff` — Task 14's "+ Tạo đặt phòng mới" form calls this.

- [ ] **Step 1: Write the failing test**

```js
// test/bookingsStaffEndpoint.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as staffCreateBooking } from '../functions/api/bookings/staff.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, circleRoomId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);

  const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
  circleRoomId = room.id;
});

function authedPost(url, token, body) {
  return new Request(url, { method: 'POST', headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/bookings/staff', () => {
  const validBody = () => ({ guestName: 'Trần Văn B', phone: '0900000002', roomType: 'circle', roomId: circleRoomId, checkIn: '2099-01-01', checkOut: '2099-01-03', source: 'phone' });

  it('lets reception create a confirmed booking directly', async () => {
    const response = await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', receptionToken, validBody()), env });
    expect(response.status).toBe(201);
    const body = await response.json();

    const row = await env.DB.prepare(`SELECT status, room_id, created_by, confirmed_by FROM bookings WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ status: 'confirmed', room_id: circleRoomId, created_by: 'le_tan_a', confirmed_by: 'le_tan_a' });
  });

  it('rejects unauthenticated requests', async () => {
    const response = await staffCreateBooking({ request: new Request('https://x/api/bookings/staff', { method: 'POST', body: JSON.stringify(validBody()) }), env });
    expect(response.status).toBe(401);
  });

  it('rejects an invalid source', async () => {
    const response = await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', managerToken, { ...validBody(), source: 'website' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a missing roomId', async () => {
    const { roomId, ...rest } = validBody();
    const response = await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', managerToken, rest), env });
    expect(response.status).toBe(400);
  });

  it('rejects a roomId that does not belong to the given room type', async () => {
    const vipRoom = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    const response = await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', managerToken, { ...validBody(), roomId: vipRoom.id }), env });
    expect(response.status).toBe(400);
  });

  it('returns 409 when the room is already booked for overlapping dates', async () => {
    await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', managerToken, validBody()), env });
    const response = await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', managerToken, { ...validBody(), guestName: 'Someone Else' }), env });
    expect(response.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bookingsStaffEndpoint.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/bookings/staff.js
import { requireAuth } from '../../../lib/requireAuth.js';
import { hasRoomConflict } from '../../../lib/bookingAvailability.js';
import { ROOM_TYPES } from '../../../lib/roomTypes.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_ROOM_TYPES = Object.keys(ROOM_TYPES);
const VALID_SOURCES = ['phone', 'zalo', 'walk_in'];

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};

  const { guestName, phone, email, roomType, roomId, checkIn, checkOut, guestsCount, notes, source } = body;

  if (typeof guestName !== 'string' || guestName.trim().length === 0) {
    return jsonError('Vui lòng nhập họ tên', 400);
  }
  if (typeof phone !== 'string' || phone.trim().length === 0) {
    return jsonError('Vui lòng nhập số điện thoại', 400);
  }
  if (!VALID_ROOM_TYPES.includes(roomType)) {
    return jsonError('Loại phòng không hợp lệ', 400);
  }
  if (!VALID_SOURCES.includes(source)) {
    return jsonError('Nguồn đặt phòng không hợp lệ', 400);
  }
  if (!Number.isInteger(roomId)) {
    return jsonError('Vui lòng chọn phòng cụ thể', 400);
  }
  if (typeof checkIn !== 'string' || typeof checkOut !== 'string' || isNaN(Date.parse(checkIn)) || isNaN(Date.parse(checkOut))) {
    return jsonError('Ngày không hợp lệ', 400);
  }
  if (checkOut <= checkIn) {
    return jsonError('Ngày trả phòng phải sau ngày nhận phòng', 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (checkIn < today) {
    return jsonError('Ngày nhận phòng không thể ở quá khứ', 400);
  }

  const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ? AND room_type = ? AND is_active = 1`).bind(roomId, roomType).first();
  if (!room) {
    return jsonError('Phòng không tồn tại hoặc không thuộc loại đã chọn', 400);
  }

  const conflict = await hasRoomConflict(env, roomId, checkIn, checkOut);
  if (conflict) {
    return jsonError('Phòng đã được đặt trong khoảng ngày này', 409);
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, email, room_type, room_id, check_in, check_out, guests_count, notes, status, source, created_at, created_by, confirmed_by, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)`
  )
    .bind(guestName.trim(), phone.trim(), email || null, roomType, roomId, checkIn, checkOut, guestsCount || null, notes || null, source, now, auth.username, auth.username, now)
    .run();

  return new Response(JSON.stringify({ id: result.meta.last_row_id }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bookingsStaffEndpoint.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/bookings/staff.js test/bookingsStaffEndpoint.test.js
git commit -m "feat: add POST /api/bookings/staff for phone/Zalo/walk-in bookings"
```

---

### Task 7: `POST /api/bookings/:id/confirm`

**Files:**
- Create: `functions/api/bookings/[id]/confirm.js`
- Test: `test/bookingLifecycle.test.js`

**Interfaces:**
- Consumes: `requireAuth`, `hasRoomConflict` from Task 3.
- Produces: the confirm route Task 14's "Xác nhận" button calls.

- [ ] **Step 1: Write the failing test**

```js
// test/bookingLifecycle.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as confirmBooking } from '../functions/api/bookings/[id]/confirm.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, circleRoomId, otherCircleRoomId, pendingBookingId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);

  const rooms = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 2`).all();
  circleRoomId = rooms.results[0].id;
  otherCircleRoomId = rooms.results[1].id;

  const inserted = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
     VALUES ('Nguyễn Văn A', '0900000001', 'circle', '2099-01-01', '2099-01-03', 'pending', 'website', '2026-08-01T00:00:00Z')`
  ).run();
  pendingBookingId = inserted.meta.last_row_id;
});

function authedPost(url, token, body) {
  return new Request(url, {
    method: 'POST',
    headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/bookings/:id/confirm', () => {
  it('confirms a pending booking and assigns the chosen room', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: circleRoomId }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT status, room_id, confirmed_by FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row).toEqual({ status: 'confirmed', room_id: circleRoomId, confirmed_by: 'quan_ly_a' });
  });

  it('lets a reception account confirm too', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, receptionToken, { roomId: circleRoomId }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await confirmBooking({
      request: new Request(`https://x/api/bookings/${pendingBookingId}/confirm`, { method: 'POST', body: JSON.stringify({ roomId: circleRoomId }) }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(401);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await confirmBooking({
      request: authedPost('https://x/api/bookings/999999/confirm', managerToken, { roomId: circleRoomId }),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('rejects confirming a booking that is not pending', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: circleRoomId }), env, params: { id: String(pendingBookingId) } });
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: otherCircleRoomId }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 409 when the chosen room already has an overlapping confirmed booking', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('Khác', '090', 'circle', ?, '2099-01-02', '2099-01-04', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(circleRoomId).run();

    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: circleRoomId }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(409);
  });

  it('rejects a missing roomId with 400 instead of crashing', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, {}),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bookingLifecycle.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/bookings/[id]/confirm.js
import { requireAuth } from '../../../../lib/requireAuth.js';
import { hasRoomConflict } from '../../../../lib/bookingAvailability.js';

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
  body = body || {};
  const { roomId } = body;
  if (!Number.isInteger(roomId)) {
    return jsonError('Vui lòng chọn phòng cụ thể', 400);
  }

  const booking = await env.DB.prepare(`SELECT id, room_type, check_in, check_out, status FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy yêu cầu đặt phòng', 404);
  }
  if (booking.status !== 'pending') {
    return jsonError('Yêu cầu này không còn ở trạng thái chờ xử lý', 400);
  }

  const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ? AND room_type = ? AND is_active = 1`).bind(roomId, booking.room_type).first();
  if (!room) {
    return jsonError('Phòng không tồn tại hoặc không thuộc loại đã yêu cầu', 400);
  }

  const conflict = await hasRoomConflict(env, roomId, booking.check_in, booking.check_out);
  if (conflict) {
    return jsonError('Phòng đã được đặt trong khoảng ngày này', 409);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE bookings SET status = 'confirmed', room_id = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?`
  ).bind(roomId, auth.username, now, params.id).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bookingLifecycle.test.js` — Expected: PASS (only the `confirm` describe block exists so far).

- [ ] **Step 5: Commit**

```bash
git add functions/api/bookings/\[id\]/confirm.js test/bookingLifecycle.test.js
git commit -m "feat: add POST /api/bookings/:id/confirm with conflict check"
```

---

### Task 8: `POST /api/bookings/:id/reject`

**Files:**
- Create: `functions/api/bookings/[id]/reject.js`
- Test: append to `test/bookingLifecycle.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/bookingLifecycle.test.js` (add the import at the top alongside the existing one):

```js
import { onRequestPost as rejectBooking } from '../functions/api/bookings/[id]/reject.js';
```

```js
describe('POST /api/bookings/:id/reject', () => {
  it('cancels a pending booking', async () => {
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row.status).toBe('cancelled');
  });

  it('accepts an optional reason', async () => {
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken, { reason: 'Hết phòng' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT cancel_reason FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row.cancel_reason).toBe('Hết phòng');
  });

  it('works with no request body at all', async () => {
    const response = await rejectBooking({
      request: new Request(`https://x/api/bookings/${pendingBookingId}/reject`, { method: 'POST', headers: { Cookie: `session=${managerToken}` } }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
  });

  it('rejects rejecting a booking that is not pending', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: circleRoomId }), env, params: { id: String(pendingBookingId) } });
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await rejectBooking({
      request: authedPost('https://x/api/bookings/999999/reject', managerToken),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bookingLifecycle.test.js` — Expected: FAIL (module not found for `reject.js`).

- [ ] **Step 3: Implement**

```js
// functions/api/bookings/[id]/reject.js
import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    body = {};
  }
  body = body || {};
  const { reason } = body;

  const booking = await env.DB.prepare(`SELECT id, status FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy yêu cầu đặt phòng', 404);
  }
  if (booking.status !== 'pending') {
    return jsonError('Yêu cầu này không còn ở trạng thái chờ xử lý', 400);
  }

  await env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancel_reason = ? WHERE id = ?`).bind(reason || null, params.id).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bookingLifecycle.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/bookings/\[id\]/reject.js test/bookingLifecycle.test.js
git commit -m "feat: add POST /api/bookings/:id/reject"
```

---

### Task 9: `POST /api/bookings/:id/check-in`

**Files:**
- Create: `functions/api/bookings/[id]/check-in.js`
- Test: append to `test/bookingLifecycle.test.js`

- [ ] **Step 1: Write the failing test**

Add the import:

```js
import { onRequestPost as checkInBooking } from '../functions/api/bookings/[id]/check-in.js';
```

```js
describe('POST /api/bookings/:id/check-in', () => {
  it('checks in a confirmed booking', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: circleRoomId }), env, params: { id: String(pendingBookingId) } });

    const response = await checkInBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-in`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row.status).toBe('checked_in');
  });

  it('rejects checking in a booking that is still pending', async () => {
    const response = await checkInBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-in`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await checkInBooking({
      request: authedPost('https://x/api/bookings/999999/check-in', managerToken),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await checkInBooking({
      request: new Request(`https://x/api/bookings/${pendingBookingId}/check-in`, { method: 'POST' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bookingLifecycle.test.js` — Expected: FAIL (module not found for `check-in.js`).

- [ ] **Step 3: Implement**

```js
// functions/api/bookings/[id]/check-in.js
import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  const booking = await env.DB.prepare(`SELECT id, status FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }
  if (booking.status !== 'confirmed') {
    return jsonError('Chỉ có thể check-in từ trạng thái đã xác nhận', 400);
  }

  await env.DB.prepare(`UPDATE bookings SET status = 'checked_in' WHERE id = ?`).bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bookingLifecycle.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/bookings/\[id\]/check-in.js test/bookingLifecycle.test.js
git commit -m "feat: add POST /api/bookings/:id/check-in"
```

---

### Task 10: `POST /api/bookings/:id/check-out`

**Files:**
- Create: `functions/api/bookings/[id]/check-out.js`
- Test: append to `test/bookingLifecycle.test.js`

**Interfaces:**
- Produces: on success, also sets the booking's `room_id` row in `rooms.needs_cleaning = 1` — Task 11's `GET /api/rooms` reads this flag.

- [ ] **Step 1: Write the failing test**

Add the import:

```js
import { onRequestPost as checkOutBooking } from '../functions/api/bookings/[id]/check-out.js';
```

```js
describe('POST /api/bookings/:id/check-out', () => {
  it('checks out a checked-in booking and flags its room for cleaning', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: circleRoomId }), env, params: { id: String(pendingBookingId) } });
    await checkInBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-in`, managerToken), env, params: { id: String(pendingBookingId) } });

    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-out`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const bookingRow = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(bookingRow.status).toBe('checked_out');

    const roomRow = await env.DB.prepare(`SELECT needs_cleaning FROM rooms WHERE id = ?`).bind(circleRoomId).first();
    expect(roomRow.needs_cleaning).toBe(1);
  });

  it('rejects checking out a booking that is not checked in', async () => {
    const response = await checkOutBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/check-out`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await checkOutBooking({
      request: authedPost('https://x/api/bookings/999999/check-out', managerToken),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bookingLifecycle.test.js` — Expected: FAIL (module not found for `check-out.js`).

- [ ] **Step 3: Implement**

```js
// functions/api/bookings/[id]/check-out.js
import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  const booking = await env.DB.prepare(`SELECT id, status, room_id FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }
  if (booking.status !== 'checked_in') {
    return jsonError('Chỉ có thể check-out từ trạng thái đang lưu trú', 400);
  }

  const statements = [
    env.DB.prepare(`UPDATE bookings SET status = 'checked_out' WHERE id = ?`).bind(params.id),
  ];
  if (booking.room_id) {
    statements.push(env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1 WHERE id = ?`).bind(booking.room_id));
  }
  await env.DB.batch(statements);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bookingLifecycle.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/bookings/\[id\]/check-out.js test/bookingLifecycle.test.js
git commit -m "feat: add POST /api/bookings/:id/check-out, flags the room for cleaning"
```

---

### Task 11: `GET /api/rooms` — room list with computed status

**Files:**
- Create: `functions/api/rooms/index.js`
- Test: `test/roomsEndpoints.test.js`

**Interfaces:**
- Produces: `{id, name, roomType, status}[]` where `status` is `'empty' | 'occupied' | 'needs_cleaning'` — Task 14's "Trạng thái phòng" grid consumes this.

- [ ] **Step 1: Write the failing test**

```js
// test/roomsEndpoints.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listRooms } from '../functions/api/rooms/index.js';
import { createSession } from '../lib/auth.js';

let managerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
});

function authedRequest(url, method = 'GET') {
  return new Request(url, { method, headers: { Cookie: `session=${managerToken}` } });
}

describe('GET /api/rooms', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listRooms({ request: new Request('https://x/api/rooms'), env });
    expect(response.status).toBe(401);
  });

  it('returns all 16 active rooms as empty by default', async () => {
    const response = await listRooms({ request: authedRequest('https://x/api/rooms'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(16);
    expect(body.every((r) => r.status === 'empty')).toBe(true);
  });

  it('marks a room occupied when it has a checked_in booking', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2026-01-01', '2026-01-03', 'checked_in', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const response = await listRooms({ request: authedRequest('https://x/api/rooms'), env });
    const body = await response.json();
    expect(body.find((r) => r.id === room.id).status).toBe('occupied');
  });

  it('marks a room needing cleaning even over an occupied booking', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1 WHERE id = ?`).bind(room.id).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'vip', ?, '2026-01-01', '2026-01-03', 'checked_in', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const response = await listRooms({ request: authedRequest('https://x/api/rooms'), env });
    const body = await response.json();
    expect(body.find((r) => r.id === room.id).status).toBe('needs_cleaning');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/roomsEndpoints.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// functions/api/rooms/index.js
import { requireAuth } from '../../../lib/requireAuth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  const { results: rooms } = await env.DB.prepare(
    `SELECT id, name, room_type AS roomType, needs_cleaning AS needsCleaning FROM rooms WHERE is_active = 1 ORDER BY room_type, name`
  ).all();

  const { results: occupiedRows } = await env.DB.prepare(
    `SELECT DISTINCT room_id FROM bookings WHERE status = 'checked_in' AND room_id IS NOT NULL`
  ).all();
  const occupiedIds = new Set(occupiedRows.map((r) => r.room_id));

  const mapped = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    roomType: r.roomType,
    status: r.needsCleaning ? 'needs_cleaning' : occupiedIds.has(r.id) ? 'occupied' : 'empty',
  }));

  return new Response(JSON.stringify(mapped), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/roomsEndpoints.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/rooms/index.js test/roomsEndpoints.test.js
git commit -m "feat: add GET /api/rooms with computed status"
```

---

### Task 12: `POST /api/rooms/:id/clean`

**Files:**
- Create: `functions/api/rooms/[id]/clean.js`
- Test: append to `test/roomsEndpoints.test.js`

- [ ] **Step 1: Write the failing test**

Add the import:

```js
import { onRequestPost as cleanRoom } from '../functions/api/rooms/[id]/clean.js';
```

```js
describe('POST /api/rooms/:id/clean', () => {
  it('clears the needs_cleaning flag', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'bungalow' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1 WHERE id = ?`).bind(room.id).run();

    const response = await cleanRoom({ request: authedRequest(`https://x/api/rooms/${room.id}/clean`, 'POST'), env, params: { id: String(room.id) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT needs_cleaning FROM rooms WHERE id = ?`).bind(room.id).first();
    expect(row.needs_cleaning).toBe(0);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await cleanRoom({ request: new Request('https://x/api/rooms/1/clean', { method: 'POST' }), env, params: { id: '1' } });
    expect(response.status).toBe(401);
  });

  it('returns 404 for a nonexistent room', async () => {
    const response = await cleanRoom({ request: authedRequest('https://x/api/rooms/999999/clean', 'POST'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/roomsEndpoints.test.js` — Expected: FAIL (module not found for `[id]/clean.js`).

- [ ] **Step 3: Implement**

```js
// functions/api/rooms/[id]/clean.js
import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(params.id).first();
  if (!room) {
    return jsonError('Không tìm thấy phòng', 404);
  }

  await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 0 WHERE id = ?`).bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/roomsEndpoints.test.js` — Expected: PASS.

- [ ] **Step 5: Run the full suite to verify everything passes**

Run: `npm test` (from `v4/`) — Expected: all green, every test file from Tasks 1-12 plus the pre-existing 142 passing.

- [ ] **Step 6: Commit**

```bash
git add functions/api/rooms/\[id\]/clean.js test/roomsEndpoints.test.js
git commit -m "feat: add POST /api/rooms/:id/clean"
```

---

### Task 13: Wire the guest booking modal in `index.html` to the real backend

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `GET /api/availability`, `POST /api/bookings` from Tasks 4 and 5.

This task has no automated test coverage by design — no test file in this suite exercises `index.html`'s DOM behavior. Verify by reading the diff and manually tracing every interactive path (see Step 6).

- [ ] **Step 1: Simplify the quick-booking bar to a shortcut into the modal**

In `index.html`, find `function handleBooking()` (around line 3776):

```js
    function handleBooking() {
      const checkIn = document.getElementById('checkIn').value;
      const checkOut = document.getElementById('checkOut').value;
      const room = document.getElementById('roomType').value;
      if (!room) { alert('Vui lòng chọn loại phòng!'); return; }
      const msg = `Xin chào! Tôi muốn đặt phòng:\n- Phòng: ${room}\n- Nhận: ${checkIn}\n- Trả: ${checkOut}\nVui lòng xác nhận giúp tôi. Cảm ơn!`;
      window.open(`https://www.facebook.com/p/Hi%E1%BB%81n-L%C3%AA-Garden-61556329706262/`, '_blank');
    }
```

Replace with:

```js
    function handleBooking() {
      const checkIn = document.getElementById('checkIn').value;
      const checkOut = document.getElementById('checkOut').value;
      openBookingModal();
      if (checkIn) document.getElementById('bmCheckIn').value = checkIn;
      if (checkOut) document.getElementById('bmCheckOut').value = checkOut;
    }
```

The bar's own room-type dropdown uses "label — price" option values that don't correspond to the modal's room-type codes, so only dates are carried over; the guest re-picks the room type in the modal (one extra click, but avoids a fragile label-matching function). `openBookingModal()` only fills in default dates when the fields are still empty, so setting them afterward correctly overrides the defaults when the guest already picked dates in the bar.

- [ ] **Step 2: Add name/phone/notes fields to the modal, switch room options to the real codes**

Find the `#bmFormState` block (around line 4254):

```html
      <div class="bm-body bm-form-state" id="bmFormState">
        <div class="bm-grid">
          <div class="bm-field">
            <label for="bmCheckIn">Ngày đến</label>
            <input type="date" id="bmCheckIn" name="checkin">
          </div>
          <div class="bm-field">
            <label for="bmCheckOut">Ngày đi</label>
            <input type="date" id="bmCheckOut" name="checkout">
          </div>
          <div class="bm-field">
            <label for="bmGuests">Số người</label>
            <select id="bmGuests" name="guests">
              <option value="1">1 người</option>
              <option value="2" selected>2 người</option>
              <option value="3">3 người</option>
              <option value="4">4 người</option>
              <option value="5">5 người</option>
              <option value="6+">6+ người</option>
            </select>
          </div>
          <div class="bm-field">
            <label for="bmRoom">Loại phòng</label>
            <select id="bmRoom" name="room">
              <option value="">-- Chọn loại phòng --</option>
              <option value="Triangle House">🔺 Triangle House</option>
              <option value="Circle House">⭕ Circle House</option>
              <option value="Ede Cozy Room">🌿 Ede Cozy Room</option>
              <option value="VIP House">⭐ VIP House</option>
              <option value="Bungalow">🏡 Bungalow</option>
              <option value="Dormitory">🛏 Dormitory</option>
            </select>
          </div>
        </div>
        <button class="bm-submit" onclick="submitBooking()">Gửi Yêu Cầu Kiểm Tra Phòng →</button>
        <p class="bm-note">Hỗ trợ đặt phòng qua <a href="tel:0968987311">Điện thoại</a> hoặc <a href="https://zalo.me/0968987311" target="_blank" rel="noopener">Zalo</a></p>
      </div>
```

Replace with:

```html
      <div class="bm-body bm-form-state" id="bmFormState">
        <div class="bm-grid">
          <div class="bm-field full">
            <label for="bmGuestName">Họ tên</label>
            <input type="text" id="bmGuestName" name="guestName" required>
          </div>
          <div class="bm-field full">
            <label for="bmPhone">Số điện thoại</label>
            <input type="tel" id="bmPhone" name="phone" required>
          </div>
          <div class="bm-field">
            <label for="bmCheckIn">Ngày đến</label>
            <input type="date" id="bmCheckIn" name="checkin">
          </div>
          <div class="bm-field">
            <label for="bmCheckOut">Ngày đi</label>
            <input type="date" id="bmCheckOut" name="checkout">
          </div>
          <div class="bm-field">
            <label for="bmGuests">Số người</label>
            <select id="bmGuests" name="guests">
              <option value="1">1 người</option>
              <option value="2" selected>2 người</option>
              <option value="3">3 người</option>
              <option value="4">4 người</option>
              <option value="5">5 người</option>
              <option value="6+">6+ người</option>
            </select>
          </div>
          <div class="bm-field">
            <label for="bmRoom">Loại phòng</label>
            <select id="bmRoom" name="room">
              <option value="">-- Chọn loại phòng --</option>
              <option value="triangle">🔺 Triangle House</option>
              <option value="circle">⭕ Circle House</option>
              <option value="ede_cozy">🌿 Ê Đê Cozy House</option>
              <option value="vip">⭐ VIP House</option>
              <option value="bungalow">🏡 Bungalow Gia Đình</option>
              <option value="dormitory">🛏 Phòng Tập Thể</option>
            </select>
          </div>
          <div class="bm-field full">
            <label for="bmNotes">Ghi chú (không bắt buộc)</label>
            <input type="text" id="bmNotes" name="notes">
          </div>
        </div>
        <p class="bm-availability" id="bmAvailability"></p>
        <button class="bm-submit" onclick="submitBooking()">Gửi Yêu Cầu Kiểm Tra Phòng →</button>
        <p class="bm-error" id="bmSubmitError"></p>
        <p class="bm-note">Hỗ trợ đặt phòng qua <a href="tel:0968987311">Điện thoại</a> hoặc <a href="https://zalo.me/0968987311" target="_blank" rel="noopener">Zalo</a></p>
      </div>
```

- [ ] **Step 3: Add CSS for the new availability hint and error line**

Find `.bm-note a { color: var(--accent-gold); font-weight: 500; }` (around line 1792) and add immediately after it:

```css
    .bm-availability {
      text-align: center;
      margin-top: 0.75rem;
      font-size: 0.82rem;
      color: var(--accent-gold);
      min-height: 1.2em;
    }
    .bm-availability.sold-out { color: #ff8a8a; }
    .bm-error {
      text-align: center;
      margin-top: 0.5rem;
      font-size: 0.82rem;
      color: #ff8a8a;
      min-height: 1.2em;
    }
```

- [ ] **Step 4: Update the confirm-state copy**

Find `#bmConfirmState` (around line 4293):

```html
      <div class="bm-body bm-confirm" id="bmConfirmState">
        <div class="bm-summary" id="bmSummary"></div>
        <p class="bm-contact-title">Liên hệ để xác nhận đặt phòng</p>
        <div class="bm-contact-btns">
          <a href="tel:0968987311" class="bm-contact-btn bm-btn-call">📞 Gọi ngay</a>
          <a href="https://zalo.me/0968987311" class="bm-contact-btn bm-btn-zalo" target="_blank" rel="noopener">💬 Nhắn Zalo</a>
        </div>
        <button class="bm-back" onclick="bmBackToForm()">← Chỉnh sửa thông tin</button>
      </div>
```

Replace with:

```html
      <div class="bm-body bm-confirm" id="bmConfirmState">
        <div class="bm-summary" id="bmSummary"></div>
        <p class="bm-contact-title">Yêu cầu đã được gửi — Hiền Lê Garden sẽ liên hệ xác nhận trong 24h qua số điện thoại bạn cung cấp.</p>
        <p class="bm-note">Hoặc liên hệ ngay nếu cần gấp:</p>
        <div class="bm-contact-btns">
          <a href="tel:0968987311" class="bm-contact-btn bm-btn-call">📞 Gọi ngay</a>
          <a href="https://zalo.me/0968987311" class="bm-contact-btn bm-btn-zalo" target="_blank" rel="noopener">💬 Nhắn Zalo</a>
        </div>
        <button class="bm-back" onclick="bmBackToForm()">← Chỉnh sửa thông tin</button>
      </div>
```

- [ ] **Step 5: Rewrite `submitBooking()`, add the live availability check**

Find `function submitBooking()` (around line 3835):

```js
    function submitBooking() {
      const checkIn = document.getElementById('bmCheckIn').value;
      const checkOut = document.getElementById('bmCheckOut').value;
      const guests = document.getElementById('bmGuests').value;
      const room = document.getElementById('bmRoom').value;

      if (!checkIn || !checkOut) { alert('Vui lòng chọn ngày đến và ngày đi.'); return; }
      if (new Date(checkOut) <= new Date(checkIn)) { alert('Ngày đi phải sau ngày đến.'); return; }

      const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
      const fmt = s => new Date(s).toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'});

      const rows = [
        ['Ngày đến', fmt(checkIn)],
        ['Ngày đi', fmt(checkOut)],
        ['Số đêm', nights + ' đêm'],
        ['Số người', guests + (guests === '6+' ? ' người' : ' người')],
        ['Loại phòng', room || 'Chưa chọn'],
      ];

      document.getElementById('bmSummary').innerHTML = rows.map(([k,v]) =>
        `<div class="bm-summary-row"><span>${k}</span><span>${v}</span></div>`
      ).join('');

      document.getElementById('bmFormState').classList.add('hide');
      document.getElementById('bmConfirmState').classList.add('show');
    }
```

Replace with:

```js
    const BM_ROOM_TYPE_NAMES = {
      triangle: 'Triangle House',
      circle: 'Circle House',
      ede_cozy: 'Ê Đê Cozy House',
      vip: 'VIP House',
      bungalow: 'Bungalow Gia Đình',
      dormitory: 'Phòng Tập Thể',
    };

    async function updateAvailabilityHint() {
      const checkIn = document.getElementById('bmCheckIn').value;
      const checkOut = document.getElementById('bmCheckOut').value;
      const room = document.getElementById('bmRoom').value;
      const hint = document.getElementById('bmAvailability');
      hint.textContent = '';
      hint.classList.remove('sold-out');

      if (!checkIn || !checkOut || !room) return;
      if (new Date(checkOut) <= new Date(checkIn)) return;

      const params = new URLSearchParams({ roomType: room, checkIn, checkOut });
      const response = await fetch(`/api/availability?${params.toString()}`);
      if (!response.ok) return;
      const data = await response.json();

      if (data.available === 0) {
        hint.textContent = `Đã hết ${BM_ROOM_TYPE_NAMES[room] || room} trong khoảng ngày này — vui lòng chọn ngày hoặc loại phòng khác.`;
        hint.classList.add('sold-out');
      } else {
        hint.textContent = `Còn ${data.available}/${data.totalRooms} phòng ${BM_ROOM_TYPE_NAMES[room] || room} trống trong khoảng ngày này.`;
      }
    }

    document.getElementById('bmCheckIn').addEventListener('change', updateAvailabilityHint);
    document.getElementById('bmCheckOut').addEventListener('change', updateAvailabilityHint);
    document.getElementById('bmRoom').addEventListener('change', updateAvailabilityHint);

    async function submitBooking() {
      const guestName = document.getElementById('bmGuestName').value.trim();
      const phone = document.getElementById('bmPhone').value.trim();
      const checkIn = document.getElementById('bmCheckIn').value;
      const checkOut = document.getElementById('bmCheckOut').value;
      const guests = document.getElementById('bmGuests').value;
      const room = document.getElementById('bmRoom').value;
      const notes = document.getElementById('bmNotes').value.trim();
      const errorEl = document.getElementById('bmSubmitError');
      errorEl.textContent = '';

      if (!guestName) { errorEl.textContent = 'Vui lòng nhập họ tên.'; return; }
      if (!phone) { errorEl.textContent = 'Vui lòng nhập số điện thoại.'; return; }
      if (!checkIn || !checkOut) { errorEl.textContent = 'Vui lòng chọn ngày đến và ngày đi.'; return; }
      if (new Date(checkOut) <= new Date(checkIn)) { errorEl.textContent = 'Ngày đi phải sau ngày đến.'; return; }
      if (!room) { errorEl.textContent = 'Vui lòng chọn loại phòng.'; return; }

      const guestsCount = guests === '6+' ? 6 : Number(guests);

      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestName, phone, roomType: room, checkIn, checkOut, guestsCount, notes: notes || undefined }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        errorEl.textContent = body.error || 'Có lỗi khi gửi yêu cầu, vui lòng thử lại.';
        return;
      }

      const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
      const fmt = s => new Date(s).toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'});

      const rows = [
        ['Ngày đến', fmt(checkIn)],
        ['Ngày đi', fmt(checkOut)],
        ['Số đêm', nights + ' đêm'],
        ['Số người', guests + ' người'],
        ['Loại phòng', BM_ROOM_TYPE_NAMES[room] || room],
      ];

      document.getElementById('bmSummary').innerHTML = rows.map(([k,v]) =>
        `<div class="bm-summary-row"><span>${k}</span><span>${v}</span></div>`
      ).join('');

      document.getElementById('bmFormState').classList.add('hide');
      document.getElementById('bmConfirmState').classList.add('show');
    }
```

`rows` here is built entirely from fixed Vietnamese labels and values that can only come from a `<select>`'s own enumerated options or a computed date/number — never from the new free-text `guestName`/`phone`/`notes` fields, which are deliberately excluded from this summary. This matches the pre-existing file's own choice (unchanged risk profile), not a new interpolation this task introduces.

- [ ] **Step 6: Manual verification (reasoning-trace)**

Read the full diff together and trace every path:
- Page load: `#bmAvailability` and `#bmSubmitError` start empty (no `textContent` set in HTML).
- Bar → modal: `handleBooking()` opens the modal and only overwrites `bmCheckIn`/`bmCheckOut` when the bar's fields were filled — otherwise the modal's own defaulting in `openBookingModal()` applies.
- Picking dates/room in the modal fires `updateAvailabilityHint()`, which calls `GET /api/availability` and shows either the "Còn N/M" or "Đã hết" message — never touches `bmSubmitError`.
- Submitting with a missing required field shows the specific Vietnamese message in `bmSubmitError` and does not advance to `bmConfirmState`.
- Submitting successfully calls `POST /api/bookings`, checks `response.ok`, and only then builds the summary and switches states — mirrors the `response.ok`-check convention established across every admin page in the CRM plan.
- A failed submission (e.g. a validation 400 from the backend) shows `body.error` inline and leaves the form state visible for correction.
- `bmFormState`/`bmConfirmState` continue to toggle via `.hide`/`.show` classes exactly as before — this task didn't touch that mechanism, so no risk of the `hidden`-attribute/`classList` mismatch recurring here.

- [ ] **Step 7: Run the full test suite to confirm nothing else broke**

Run: `npm test` (from `v4/`) — Expected: unchanged pass count from Task 12 (this task touches only `index.html`, which no test file loads).

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: wire the homepage booking modal to the real booking API"
```

---

### Task 14: `admin/reception.html` becomes the daily operations board

**Files:**
- Modify: `admin/reception.html`
- Modify: `admin/reception.js`
- Modify: `admin/admin.css`

**Interfaces:**
- Consumes: `GET/POST /api/bookings`, `POST /api/bookings/staff`, `POST /api/bookings/:id/{confirm,reject,check-in,check-out}`, `GET /api/rooms`, `POST /api/rooms/:id/clean`, `GET /api/availability` (Tasks 4-12).

No automated test coverage by design, matching every other admin page in this codebase — verify by reading the diff and manually tracing every interactive path (Step 5).

- [ ] **Step 1: Append new CSS classes to `admin/admin.css`**

Append to the end of the file:

```css
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 480px) {
  .form-row { grid-template-columns: 1fr; }
}

.booking-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 8px; }
.booking-card {
  background: rgba(245, 240, 230, 0.06);
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 0.9rem;
}
.booking-card p { margin: 2px 0; }
.booking-actions { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
.booking-actions button { width: auto; padding: 8px 14px; }
.booking-empty { opacity: 0.6; font-size: 0.9rem; }

.status-pending { background: rgba(217,166,92,0.2); color: #D9A65C; }
.status-confirmed { background: rgba(120,200,140,0.2); color: #7FD99A; }
.status-checked_in { background: rgba(120,160,220,0.2); color: #8FB8E8; }
.status-checked_out { background: rgba(200,200,200,0.15); color: #C9C9C9; }
.status-cancelled { background: rgba(220,100,100,0.2); color: #ff8a8a; }

.rooms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.room-card {
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 0.85rem;
  border: 1px solid rgba(245, 240, 230, 0.15);
}
.room-card .room-name { font-weight: 600; margin-bottom: 4px; }
.room-empty { background: rgba(120,200,140,0.08); }
.room-occupied { background: rgba(120,160,220,0.08); }
.room-needs_cleaning { background: rgba(217,166,92,0.12); }
.room-card button { margin-top: 8px; width: auto; padding: 6px 10px; font-size: 0.8rem; }

.confirm-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px;
}
.confirm-box {
  background: var(--dark-green); border: 1px solid rgba(245,240,230,0.15);
  border-radius: 8px; padding: 20px; max-width: 400px; width: 100%;
}
.btn-secondary { background: transparent; border: 1px solid rgba(245,240,230,0.3); color: var(--cream); }
```

- [ ] **Step 2: Rewrite `admin/reception.html`**

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Bảng hôm nay — Hiền Lê Garden CRM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="admin.css" />
</head>
<body>
  <div class="page page-wide">
    <h1>Bảng hôm nay</h1>
    <nav><a href="manager.html">Cấu hình &rarr;</a> <a href="customers.html">Danh sách khách hàng &rarr;</a></nav>
    <p id="opsError" class="error"></p>

    <h2>+ Tạo đặt phòng mới</h2>
    <form id="newBookingForm">
      <div class="form-row">
        <label>Họ tên <input type="text" name="guestName" required /></label>
        <label>Số điện thoại <input type="text" name="phone" required /></label>
      </div>
      <div class="form-row">
        <label>Ngày nhận <input type="date" name="checkIn" required /></label>
        <label>Ngày trả <input type="date" name="checkOut" required /></label>
      </div>
      <div class="form-row">
        <label>Loại phòng
          <select name="roomType" required>
            <option value="">-- Chọn loại phòng --</option>
            <option value="triangle">Triangle House</option>
            <option value="circle">Circle House</option>
            <option value="ede_cozy">Ê Đê Cozy House</option>
            <option value="vip">VIP House</option>
            <option value="bungalow">Bungalow Gia Đình</option>
            <option value="dormitory">Phòng Tập Thể</option>
          </select>
        </label>
        <label>Phòng cụ thể
          <select name="roomId" id="newBookingRoomId" required>
            <option value="">-- Chọn ngày và loại phòng trước --</option>
          </select>
        </label>
      </div>
      <div class="form-row">
        <label>Số khách <input type="number" name="guestsCount" min="1" /></label>
        <label>Nguồn
          <select name="source" required>
            <option value="phone">Điện thoại</option>
            <option value="zalo">Zalo</option>
            <option value="walk_in">Khách vãng lai</option>
          </select>
        </label>
      </div>
      <label>Ghi chú <textarea name="notes" rows="2"></textarea></label>
      <button type="submit">Tạo đặt phòng</button>
      <p id="newBookingError" class="error"></p>
    </form>

    <h2>Cần xử lý</h2>
    <div id="pendingList" class="booking-list"></div>

    <h2>Hôm nay</h2>
    <h3>Khách đến hôm nay</h3>
    <div id="arrivalsList" class="booking-list"></div>
    <h3>Khách đi hôm nay</h3>
    <div id="departuresList" class="booking-list"></div>

    <h2>Đang ở</h2>
    <div id="inhouseList" class="booking-list"></div>

    <h2>Trạng thái phòng</h2>
    <div id="roomsGrid" class="rooms-grid"></div>

    <h2>Tra cứu &amp; đổi mã ưu đãi</h2>
    <form id="lookupForm">
      <label>Mã ưu đãi <input type="text" name="code" required autocapitalize="characters" /></label>
      <button type="submit">Tra cứu</button>
    </form>
    <p id="lookupError" class="error"></p>

    <section id="result" class="hidden">
      <p>Khách: <strong id="guestName"></strong></p>
      <p>Giảm giá: <strong id="discountPercent"></strong>%</p>
      <p>Hạn dùng: <span id="expiresAt"></span></p>
      <p>Trạng thái: <span id="status"></span></p>
      <button id="redeemBtn">Đánh dấu đã dùng</button>
      <button id="claimGiftBtn">Đã phát quà</button>
      <p id="actionError" class="error"></p>
    </section>
  </div>

  <div id="confirmOverlay" class="confirm-overlay hidden">
    <div class="confirm-box">
      <h3>Xác nhận đặt phòng</h3>
      <label>Chọn phòng
        <select id="confirmRoomSelect"></select>
      </label>
      <button id="confirmSubmitBtn">Xác nhận</button>
      <button id="confirmCancelBtn" class="btn-secondary">Huỷ</button>
      <p id="confirmError" class="error"></p>
    </div>
  </div>

  <script src="reception.js"></script>
  <script src="change-password.js"></script>
</body>
</html>
```

- [ ] **Step 3: Rewrite `admin/reception.js`**

```js
// admin/reception.js
let confirmingBooking = null;

const ROOM_TYPE_LABELS = {
  triangle: 'Triangle House',
  circle: 'Circle House',
  ede_cozy: 'Ê Đê Cozy House',
  vip: 'VIP House',
  bungalow: 'Bungalow Gia Đình',
  dormitory: 'Phòng Tập Thể',
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('vi-VN');
}

function statusLabel(status) {
  return {
    pending: 'Chờ xử lý',
    confirmed: 'Đã xác nhận',
    checked_in: 'Đang ở',
    checked_out: 'Đã trả phòng',
    cancelled: 'Đã huỷ',
  }[status] || status;
}

function showOpsError(message) {
  document.getElementById('opsError').textContent = message || '';
}

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = 'login.html';
    return;
  }
  await refreshAll();
})();

async function refreshAll() {
  await Promise.all([loadPending(), loadArrivals(), loadDepartures(), loadInhouse(), loadRooms()]);
}

async function fetchBookings(query) {
  const response = await fetch(`/api/bookings?${query}`);
  if (!response.ok) {
    showOpsError('Có lỗi khi tải danh sách đặt phòng');
    return [];
  }
  return response.json();
}

function renderBookingCard(b) {
  const card = document.createElement('div');
  card.className = 'booking-card';

  const nameLine = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = b.guestName;
  nameLine.appendChild(strong);
  nameLine.appendChild(document.createTextNode(` — ${b.phone}`));
  card.appendChild(nameLine);

  const detailLine = document.createElement('p');
  detailLine.textContent = `${ROOM_TYPE_LABELS[b.roomType] || b.roomType} — ${formatDate(b.checkIn)} → ${formatDate(b.checkOut)}${b.guestsCount ? ` — ${b.guestsCount} khách` : ''}`;
  card.appendChild(detailLine);

  if (b.notes) {
    const notesLine = document.createElement('p');
    notesLine.textContent = `Ghi chú: ${b.notes}`;
    card.appendChild(notesLine);
  }

  const statusLine = document.createElement('p');
  const badge = document.createElement('span');
  badge.className = `status-badge status-${b.status}`;
  badge.textContent = statusLabel(b.status);
  statusLine.appendChild(badge);
  card.appendChild(statusLine);

  const actions = document.createElement('div');
  actions.className = 'booking-actions';
  card.appendChild(actions);

  return { card, actions };
}

function renderList(containerId, bookings, emptyText, buildActions) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (bookings.length === 0) {
    const p = document.createElement('p');
    p.className = 'booking-empty';
    p.textContent = emptyText;
    container.appendChild(p);
    return;
  }
  bookings.forEach((b) => {
    const { card, actions } = renderBookingCard(b);
    buildActions(actions, b);
    container.appendChild(card);
  });
}

async function loadPending() {
  const bookings = await fetchBookings('status=pending');
  renderList('pendingList', bookings, 'Không có yêu cầu nào đang chờ.', (actions, b) => {
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Xác nhận';
    confirmBtn.addEventListener('click', () => openConfirmDialog(b));
    actions.appendChild(confirmBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = 'Từ chối';
    rejectBtn.className = 'btn-secondary';
    rejectBtn.addEventListener('click', () => rejectBooking(b.id));
    actions.appendChild(rejectBtn);
  });
}

async function loadArrivals() {
  const bookings = await fetchBookings(`status=confirmed&date=${todayISO()}&view=arrivals`);
  renderList('arrivalsList', bookings, 'Không có khách đến hôm nay.', (actions, b) => {
    const btn = document.createElement('button');
    btn.textContent = 'Check-in';
    btn.addEventListener('click', () => doBookingAction(b.id, 'check-in'));
    actions.appendChild(btn);
  });
}

async function loadDepartures() {
  const bookings = await fetchBookings(`status=checked_in&date=${todayISO()}&view=departures`);
  renderList('departuresList', bookings, 'Không có khách đi hôm nay.', (actions, b) => {
    const btn = document.createElement('button');
    btn.textContent = 'Check-out';
    btn.addEventListener('click', () => doBookingAction(b.id, 'check-out'));
    actions.appendChild(btn);
  });
}

async function loadInhouse() {
  const bookings = await fetchBookings(`status=checked_in&date=${todayISO()}&view=inhouse`);
  renderList('inhouseList', bookings, 'Không có khách đang lưu trú nhiều đêm.', () => {});
}

async function doBookingAction(id, action) {
  const response = await fetch(`/api/bookings/${id}/${action}`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showOpsError(body.error || 'Có lỗi xảy ra');
    return;
  }
  showOpsError('');
  await refreshAll();
}

async function rejectBooking(id) {
  const response = await fetch(`/api/bookings/${id}/reject`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showOpsError(body.error || 'Có lỗi xảy ra');
    return;
  }
  showOpsError('');
  await loadPending();
}

function openConfirmDialog(booking) {
  confirmingBooking = booking;
  document.getElementById('confirmError').textContent = '';
  document.getElementById('confirmOverlay').classList.remove('hidden');
  loadConfirmRoomOptions(booking);
}

function closeConfirmDialog() {
  confirmingBooking = null;
  document.getElementById('confirmOverlay').classList.add('hidden');
}

async function loadConfirmRoomOptions(booking) {
  const select = document.getElementById('confirmRoomSelect');
  select.innerHTML = '';
  const params = new URLSearchParams({ roomType: booking.roomType, checkIn: booking.checkIn, checkOut: booking.checkOut });
  const response = await fetch(`/api/availability?${params.toString()}`);
  if (!response.ok) {
    document.getElementById('confirmError').textContent = 'Có lỗi khi tải danh sách phòng trống';
    return;
  }
  const data = await response.json();
  if (data.availableRooms.length === 0) {
    document.getElementById('confirmError').textContent = 'Không còn phòng trống loại này trong khoảng ngày yêu cầu.';
    return;
  }
  data.availableRooms.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  });
}

document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirmDialog);

document.getElementById('confirmSubmitBtn').addEventListener('click', async () => {
  const roomId = Number(document.getElementById('confirmRoomSelect').value);
  const errorEl = document.getElementById('confirmError');
  if (!roomId) {
    errorEl.textContent = 'Vui lòng chọn phòng';
    return;
  }
  const response = await fetch(`/api/bookings/${confirmingBooking.id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi xảy ra';
    return;
  }
  closeConfirmDialog();
  showOpsError('');
  await refreshAll();
});

async function loadRooms() {
  const response = await fetch('/api/rooms');
  const container = document.getElementById('roomsGrid');
  if (!response.ok) {
    showOpsError('Có lỗi khi tải trạng thái phòng');
    return;
  }
  const rooms = await response.json();
  container.innerHTML = '';
  rooms.forEach((r) => {
    const card = document.createElement('div');
    card.className = `room-card room-${r.status}`;

    const nameEl = document.createElement('div');
    nameEl.className = 'room-name';
    nameEl.textContent = r.name;
    card.appendChild(nameEl);

    const statusEl = document.createElement('div');
    statusEl.textContent = { empty: 'Trống', occupied: 'Đang có khách', needs_cleaning: 'Cần dọn' }[r.status] || r.status;
    card.appendChild(statusEl);

    if (r.status === 'needs_cleaning') {
      const btn = document.createElement('button');
      btn.textContent = 'Đã dọn xong';
      btn.addEventListener('click', async () => {
        const cleanResponse = await fetch(`/api/rooms/${r.id}/clean`, { method: 'POST' });
        if (!cleanResponse.ok) {
          showOpsError('Có lỗi khi cập nhật trạng thái dọn phòng');
          return;
        }
        showOpsError('');
        await loadRooms();
      });
      card.appendChild(btn);
    }

    container.appendChild(card);
  });
}

async function refreshNewBookingRoomOptions() {
  const form = document.getElementById('newBookingForm');
  const roomType = form.roomType.value;
  const checkIn = form.checkIn.value;
  const checkOut = form.checkOut.value;
  const roomIdSelect = document.getElementById('newBookingRoomId');
  roomIdSelect.innerHTML = '';

  if (!roomType || !checkIn || !checkOut) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Chọn ngày và loại phòng trước --';
    roomIdSelect.appendChild(opt);
    return;
  }

  const params = new URLSearchParams({ roomType, checkIn, checkOut });
  const response = await fetch(`/api/availability?${params.toString()}`);
  if (!response.ok) return;
  const data = await response.json();

  if (data.availableRooms.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Hết phòng loại này trong khoảng ngày đã chọn';
    roomIdSelect.appendChild(opt);
    return;
  }
  data.availableRooms.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    roomIdSelect.appendChild(opt);
  });
}

['roomType', 'checkIn', 'checkOut'].forEach((name) => {
  document.getElementById('newBookingForm')[name].addEventListener('change', refreshNewBookingRoomOptions);
});

document.getElementById('newBookingForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const errorEl = document.getElementById('newBookingError');
  errorEl.textContent = '';

  const roomId = Number(data.get('roomId'));
  if (!roomId) {
    errorEl.textContent = 'Vui lòng chọn phòng cụ thể';
    return;
  }

  const response = await fetch('/api/bookings/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guestName: data.get('guestName'),
      phone: data.get('phone'),
      roomType: data.get('roomType'),
      roomId,
      checkIn: data.get('checkIn'),
      checkOut: data.get('checkOut'),
      guestsCount: data.get('guestsCount') ? Number(data.get('guestsCount')) : null,
      notes: data.get('notes') || null,
      source: data.get('source'),
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tạo đặt phòng';
    return;
  }

  form.reset();
  await refreshAll();
});

/* ---- Existing promo lookup (unchanged behavior) ---- */
let currentCode = null;

document.getElementById('lookupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = new FormData(event.target).get('code');
  const response = await fetch(`/api/promo/${encodeURIComponent(code)}`);
  const errorEl = document.getElementById('lookupError');
  errorEl.textContent = '';

  if (!response.ok) {
    const body = await response.json();
    errorEl.textContent = body.error || 'Có lỗi xảy ra';
    document.getElementById('result').classList.add('hidden');
    return;
  }

  currentCode = code;
  const data = await response.json();
  document.getElementById('guestName').textContent = data.guestName;
  document.getElementById('discountPercent').textContent = data.discountPercent;
  document.getElementById('expiresAt').textContent = new Date(data.expiresAt).toLocaleDateString('vi-VN');
  document.getElementById('status').textContent = data.status;
  document.getElementById('claimGiftBtn').style.display = data.giftOffered && !data.giftClaimed ? 'inline-block' : 'none';
  document.getElementById('result').classList.remove('hidden');
});

document.getElementById('redeemBtn').addEventListener('click', async () => {
  const response = await fetch(`/api/promo/${encodeURIComponent(currentCode)}/redeem`, { method: 'POST' });
  const errorEl = document.getElementById('actionError');
  if (!response.ok) {
    errorEl.textContent = (await response.json()).error;
    return;
  }
  document.getElementById('status').textContent = 'used';
  errorEl.textContent = '';
});

document.getElementById('claimGiftBtn').addEventListener('click', async () => {
  const response = await fetch(`/api/promo/${encodeURIComponent(currentCode)}/claim-gift`, { method: 'POST' });
  const errorEl = document.getElementById('actionError');
  if (!response.ok) {
    errorEl.textContent = (await response.json()).error;
    return;
  }
  document.getElementById('claimGiftBtn').style.display = 'none';
  errorEl.textContent = '';
});
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test` (from `v4/`) — Expected: unchanged pass count (this task touches only `admin/reception.html`/`.js`/`admin.css`, none loaded by any test file).

- [ ] **Step 5: Manual verification (reasoning-trace)**

Trace every interactive path:
- Page load: auth IIFE checks `/api/auth/me`; on success calls `refreshAll()` *inside* the IIFE (not a bare module-scope call) — matches the fixed `admin/users.js` pattern, no load-order race.
- `confirmOverlay` starts with `class="hidden"` in the HTML (never the `hidden` attribute); `openConfirmDialog`/`closeConfirmDialog` toggle it via `classList` only — consistent mechanism throughout.
- Every list-rendering function (`renderBookingCard`, `loadRooms`) builds nodes via `createElement`/`textContent`; the only `innerHTML` uses are `container.innerHTML = ''` and `select.innerHTML = ''` (clears, no interpolation).
- Every mutating fetch (`doBookingAction`, `rejectBooking`, the confirm-submit handler, the clean-room handler, the new-booking submit handler) checks `response.ok` and writes into `#opsError`, `#confirmError`, or `#newBookingError` on failure — never `alert()`.
- Confirming a pending request opens the dialog, loads only the rooms actually free for that request's exact dates via `GET /api/availability`, and posts `{roomId}` to `/confirm` — a 409 conflict surfaces inline in `#confirmError` without closing the dialog.
- The "+ Tạo đặt phòng mới" form's room-type/date changes repopulate the room picker the same way the confirm dialog does, so staff can't submit against a room that isn't actually free.
- The pre-existing promo-lookup section's markup and JS are copied verbatim from the original file — behavior unchanged.

- [ ] **Step 6: Commit**

```bash
git add admin/reception.html admin/reception.js admin/admin.css
git commit -m "feat: replace reception.html's promo-lookup home with the daily operations board"
```

---

### Task 15: Playwright e2e — homepage booking modal

**Files:**
- Create: `tests/e2e/booking-modal.spec.js` (in the `hien-le-garden-landing` repo root, not this `v4` repo)

**Interfaces:**
- Consumes: the `v4` Playwright project already configured in `playwright.config.js` (baseURL served from `v4/`); mocks every `/api/*` call via `page.route()`, following the exact pattern in `tests/e2e/crm-admin.spec.js`.

- [ ] **Step 1: Write `tests/e2e/booking-modal.spec.js`**

```js
// tests/e2e/booking-modal.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Homepage booking modal', () => {
  test('shows live availability and submits a booking request', async ({ page }) => {
    await page.route('**/api/availability**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roomType: 'circle', totalRooms: 5, bookedCount: 2, available: 3, availableRooms: [] }) })
    );
    await page.route('**/api/bookings', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 42 }) });
      }
      return route.continue();
    });

    await page.goto('/');
    await page.click('.nav-btn-book');
    await expect(page.locator('#bmOverlay')).toHaveClass(/open/);

    await page.fill('#bmGuestName', 'Nguyễn Văn A');
    await page.fill('#bmPhone', '0900000001');
    await page.selectOption('#bmRoom', 'circle');
    await expect(page.locator('#bmAvailability')).toContainText('Còn 3/5 phòng');

    await page.click('.bm-submit');
    await expect(page.locator('#bmConfirmState')).toHaveClass(/show/);
    await expect(page.locator('.bm-contact-title')).toContainText('Yêu cầu đã được gửi');
  });

  test('shows an inline error when the request fails', async ({ page }) => {
    await page.route('**/api/availability**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roomType: 'circle', totalRooms: 5, bookedCount: 5, available: 0, availableRooms: [] }) })
    );
    await page.route('**/api/bookings', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Thiếu thông tin bắt buộc' }) });
      }
      return route.continue();
    });

    await page.goto('/');
    await page.click('.nav-btn-book');
    await page.fill('#bmGuestName', 'Nguyễn Văn A');
    await page.fill('#bmPhone', '0900000001');
    await page.selectOption('#bmRoom', 'circle');
    await expect(page.locator('#bmAvailability')).toContainText('Đã hết');

    await page.click('.bm-submit');
    await expect(page.locator('#bmSubmitError')).toContainText('Thiếu thông tin bắt buộc');
    await expect(page.locator('#bmConfirmState')).not.toHaveClass(/show/);
  });
});
```

- [ ] **Step 2: Run the spec against a locally served `v4`**

From the `hien-le-garden-landing` repo root: `npx playwright test --project=v4 booking-modal.spec.js` — Expected: both tests pass. **Caveat:** if this task is executed from an isolated worktree of the `v4` repo (as the sibling CRM admin management plan was), `playwright.config.js`'s `webServer` serves `hien-le-garden-landing/v4/` — the repo's own primary checkout, on `main`, which won't have Task 13's changes until that worktree's branch is merged. In that case, don't rely on the auto-started `webServer`: start a static server yourself pointed at the worktree's `v4/` directory on the port `playwright.config.js` expects (`V4_PORT`, currently 4174 — check the file for the current value), so Playwright's `reuseExistingServer` picks it up instead of starting its own against the stale checkout. Tear that server down after the run.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/booking-modal.spec.js
git commit -m "test: add e2e coverage for the homepage booking modal"
```

---

### Task 16: Playwright e2e — reception ops board

**Files:**
- Create: `tests/e2e/reception-ops-board.spec.js` (in the `hien-le-garden-landing` repo root)

- [ ] **Step 1: Write `tests/e2e/reception-ops-board.spec.js`**

```js
// tests/e2e/reception-ops-board.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Reception daily ops board', () => {
  test('lists a pending request and confirms it into a chosen room', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'le_tan_a', role: 'reception' }) }));
    await page.route('**/api/bookings?status=pending', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 7, guestName: 'Nguyễn Văn A', phone: '0900000001', roomType: 'circle', checkIn: '2099-01-01', checkOut: '2099-01-03', status: 'pending' }]) })
    );
    await page.route('**/api/bookings?status=confirmed*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/bookings?status=checked_in*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/rooms', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/availability**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roomType: 'circle', totalRooms: 5, bookedCount: 1, available: 4, availableRooms: [{ id: 3, name: 'Circle House 3' }] }) })
    );

    let confirmed = false;
    await page.route('**/api/bookings/7/confirm', (route) => {
      confirmed = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/admin/reception.html');
    await expect(page.locator('#pendingList')).toContainText('Nguyễn Văn A');

    await page.click('#pendingList >> text=Xác nhận');
    await expect(page.locator('#confirmOverlay')).toBeVisible();
    await page.selectOption('#confirmRoomSelect', '3');
    await page.click('#confirmSubmitBtn');

    await expect(page.locator('#confirmOverlay')).toBeHidden();
    expect(confirmed).toBe(true);
  });

  test('redirects to login.html when not authenticated', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401 }));
    await page.goto('/admin/reception.html');
    await page.waitForURL('**/admin/login.html');
  });
});
```

- [ ] **Step 2: Run the spec against a locally served `v4`**

From the `hien-le-garden-landing` repo root: `npx playwright test --project=v4 reception-ops-board.spec.js` — Expected: both tests pass. Same worktree-staleness caveat as Task 15 Step 2 applies here.

- [ ] **Step 3: Run the full v4 Playwright project**

Run: `npx playwright test --project=v4` — Expected: all pass, including these 4 new tests (this task's 2 plus Task 15's 2) alongside every pre-existing spec. If running against a manually-started server per the Task 15 caveat, keep it up for this run too, then tear it down.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/reception-ops-board.spec.js
git commit -m "test: add e2e coverage for the reception daily ops board"
```
