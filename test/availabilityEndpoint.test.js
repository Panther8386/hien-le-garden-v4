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
