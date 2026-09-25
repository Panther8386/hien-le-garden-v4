import { describe, it, expect, vi } from 'vitest';
import { verifyTurnstile } from '../lib/turnstile.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const env = { TURNSTILE_SECRET_KEY: 'test-secret' };

function stub(impl) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('verifyTurnstile', () => {
  it('returns true on success:true and posts secret, response and remoteip as a form', async () => {
    const fetchMock = stub(async () => Response.json({ success: true }));
    expect(await verifyTurnstile(env, 'tok', '198.51.100.1')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(init.body);
    expect(form.get('secret') === 'test-secret').toBe(true);
    expect(form.get('response') === 'tok').toBe(true);
    expect(form.get('remoteip')).toBe('198.51.100.1');
  });

  it('omits remoteip when not provided', async () => {
    const fetchMock = stub(async () => Response.json({ success: true }));
    expect(await verifyTurnstile(env, 'tok')).toBe(true);
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).has('remoteip')).toBe(false);
  });

  it('returns false without calling fetch when the secret is missing or empty', async () => {
    const fetchMock = stub(async () => Response.json({ success: true }));
    expect(await verifyTurnstile({}, 'tok')).toBe(false);
    expect(await verifyTurnstile({ TURNSTILE_SECRET_KEY: '' }, 'tok')).toBe(false);
    expect(await verifyTurnstile(undefined, 'tok')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false without calling fetch for missing, empty, non-string or oversized tokens', async () => {
    const fetchMock = stub(async () => Response.json({ success: true }));
    for (const token of [undefined, null, '', 123, {}, ['tok'], 'x'.repeat(2049)]) {
      expect(await verifyTurnstile(env, token)).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a token of exactly 2048 chars', async () => {
    stub(async () => Response.json({ success: true }));
    expect(await verifyTurnstile(env, 'x'.repeat(2048))).toBe(true);
  });

  it('returns false on success:false (including timeout-or-duplicate replays)', async () => {
    stub(async () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    expect(await verifyTurnstile(env, 'tok')).toBe(false);
  });

  it('returns false when success is truthy but not exactly true', async () => {
    stub(async () => Response.json({ success: 'true' }));
    expect(await verifyTurnstile(env, 'tok')).toBe(false);
  });

  it('returns false on non-2xx, invalid JSON, null JSON and network errors', async () => {
    stub(async () => new Response('err', { status: 500 }));
    expect(await verifyTurnstile(env, 'tok')).toBe(false);
    stub(async () => new Response('not json', { status: 200 }));
    expect(await verifyTurnstile(env, 'tok')).toBe(false);
    stub(async () => new Response('null', { status: 200 }));
    expect(await verifyTurnstile(env, 'tok')).toBe(false);
    stub(async () => {
      throw new TypeError('network');
    });
    expect(await verifyTurnstile(env, 'tok')).toBe(false);
  });

  it('never logs the secret or token', async () => {
    const spies = ['log', 'error', 'warn', 'info'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    stub(async () => {
      throw new TypeError('network');
    });
    await verifyTurnstile(env, 'tok-sensitive');
    stub(async () => new Response('err', { status: 500 }));
    await verifyTurnstile(env, 'tok-sensitive');
    stub(async () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }));
    await verifyTurnstile(env, 'tok-sensitive');
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls.map((args) => args.map(String))));
    expect(logged.includes('test-secret')).toBe(false);
    expect(logged.includes('tok-sensitive')).toBe(false);
  });
});
