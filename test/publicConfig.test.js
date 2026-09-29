import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet } from '../functions/api/public-config.js';

describe('GET /api/public-config', () => {
  it('returns only the Turnstile site key', async () => {
    const response = await onRequestGet({
      request: new Request('https://x/api/public-config'),
      env: { ...env, TURNSTILE_SITE_KEY: 'dummy-site-key', TURNSTILE_SECRET_KEY: 'test-secret', BREVO_API_KEY: 'test-key' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/application\/json/);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ turnstileSiteKey: 'dummy-site-key' });
    expect(text.includes('test-secret')).toBe(false);
  });

  it('returns null when the site key is not configured', async () => {
    const { TURNSTILE_SITE_KEY, ...rest } = env;
    const response = await onRequestGet({ request: new Request('https://x/api/public-config'), env: rest });
    expect(await response.json()).toEqual({ turnstileSiteKey: null });
  });
});
