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
