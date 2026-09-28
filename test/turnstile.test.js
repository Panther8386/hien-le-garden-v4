import { describe, it, expect, vi } from 'vitest';
import { verifyTurnstile } from '../lib/turnstile.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const env = { TURNSTILE_SECRET_KEY: 'test-secret', TURNSTILE_ALLOWED_HOSTNAMES: 'hienlegarden.vn' };
const OK = { success: true, hostname: 'hienlegarden.vn', 'error-codes': [], challenge_ts: '2026-09-28T00:00:00Z' };

function stub(impl) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('verifyTurnstile', () => {
  it('returns true on success:true and posts secret, response and remoteip as a form', async () => {
    const fetchMock = stub(async () => Response.json(OK));
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
    const fetchMock = stub(async () => Response.json(OK));
    expect(await verifyTurnstile(env, 'tok')).toBe(true);
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).has('remoteip')).toBe(false);
  });

  it('returns false without calling fetch when the secret is missing or empty', async () => {
    const fetchMock = stub(async () => Response.json(OK));
    expect(await verifyTurnstile({}, 'tok')).toBe(false);
    expect(await verifyTurnstile({ TURNSTILE_SECRET_KEY: '' }, 'tok')).toBe(false);
    expect(await verifyTurnstile(undefined, 'tok')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false without calling fetch for missing, empty, non-string or oversized tokens', async () => {
    const fetchMock = stub(async () => Response.json(OK));
    for (const token of [undefined, null, '', 123, {}, ['tok'], 'x'.repeat(2049)]) {
      expect(await verifyTurnstile(env, token)).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a token of exactly 2048 chars', async () => {
    stub(async () => Response.json(OK));
    expect(await verifyTurnstile(env, 'x'.repeat(2048))).toBe(true);
  });

  it('returns false on success:false (including timeout-or-duplicate replays)', async () => {
    stub(async () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    expect(await verifyTurnstile(env, 'tok')).toBe(false);
  });

  it('returns false when success is truthy but not exactly true', async () => {
    stub(async () => Response.json({ ...OK, success: 'true' }));
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

  describe('hostname allowlist (TURNSTILE_ALLOWED_HOSTNAMES)', () => {
    it('accepts success + allowed hostname', async () => {
      stub(async () => Response.json(OK));
      expect(await verifyTurnstile(env, 'tok')).toBe(true);
    });

    it('rejects success + a hostname outside the allowlist (incl. testing-key example.com and suffix tricks)', async () => {
      for (const hostname of ['example.com', 'evil.com', 'hienlegarden.vn.evil.com', 'evilhienlegarden.vn', 'www.hienlegarden.vn', '']) {
        stub(async () => Response.json({ ...OK, hostname }));
        expect(await verifyTurnstile(env, 'tok')).toBe(false);
      }
    });

    it('rejects success with a missing or non-string hostname', async () => {
      for (const hostname of [undefined, null, 123, ['hienlegarden.vn'], { h: 1 }]) {
        const body = { ...OK };
        if (hostname === undefined) delete body.hostname; else body.hostname = hostname;
        stub(async () => Response.json(body));
        expect(await verifyTurnstile(env, 'tok')).toBe(false);
      }
    });

    it('rejects malformed responses (array, string, number, success missing)', async () => {
      for (const body of [[OK], 'ok', 1, { hostname: 'hienlegarden.vn' }]) {
        stub(async () => Response.json(body));
        expect(await verifyTurnstile(env, 'tok')).toBe(false);
      }
    });

    it('rejects success:false even when the hostname is allowed', async () => {
      stub(async () => Response.json({ ...OK, success: false, 'error-codes': ['timeout-or-duplicate'] }));
      expect(await verifyTurnstile(env, 'tok')).toBe(false);
    });

    it('fails closed without calling siteverify when the allowlist is missing, empty or invalid', async () => {
      const fetchMock = stub(async () => Response.json(OK));
      for (const value of [undefined, '', ' ', ',', ' , ', 'https://hienlegarden.vn', 'hienlegarden.vn/path', '*.hienlegarden.vn', 'hienlegarden.vn:443', '.hienlegarden.vn', 'a..b', 123]) {
        const e = { TURNSTILE_SECRET_KEY: 'test-secret' };
        if (value !== undefined) e.TURNSTILE_ALLOWED_HOSTNAMES = value;
        expect(await verifyTurnstile(e, 'tok')).toBe(false);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('supports several comma-separated hostnames with whitespace/case/trailing-dot normalization', async () => {
      const e = { TURNSTILE_SECRET_KEY: 'test-secret', TURNSTILE_ALLOWED_HOSTNAMES: ' HienLeGarden.vn , www.hienlegarden.vn. ,' };
      for (const hostname of ['hienlegarden.vn', 'WWW.HIENLEGARDEN.VN', 'hienlegarden.vn.']) {
        stub(async () => Response.json({ ...OK, hostname }));
        expect(await verifyTurnstile(e, 'tok')).toBe(true);
      }
      stub(async () => Response.json({ ...OK, hostname: 'staging.hien-le-garden-v4.pages.dev' }));
      expect(await verifyTurnstile(e, 'tok')).toBe(false);
    });

    it('does not log the secret or token on hostname or config rejection', async () => {
      const spies = ['log', 'error', 'warn', 'info'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
      stub(async () => Response.json({ ...OK, hostname: 'evil.com' }));
      await verifyTurnstile(env, 'tok-sensitive');
      await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'test-secret' }, 'tok-sensitive');
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls.map((args) => args.map(String))));
      expect(logged.includes('test-secret')).toBe(false);
      expect(logged.includes('tok-sensitive')).toBe(false);
      spies.forEach((s) => s.mockRestore());
    });
  });
});
