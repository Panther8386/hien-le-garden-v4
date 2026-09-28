import { describe, it, expect, vi } from 'vitest';
import { verifyTurnstile, parseAllowedHostnames } from '../lib/turnstile.js';

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
      const e = { TURNSTILE_SECRET_KEY: 'test-secret', TURNSTILE_ALLOWED_HOSTNAMES: ' HienLeGarden.vn , www.hienlegarden.vn. ' };
      for (const hostname of ['hienlegarden.vn', 'WWW.HIENLEGARDEN.VN', 'hienlegarden.vn.']) {
        stub(async () => Response.json({ ...OK, hostname }));
        expect(await verifyTurnstile(e, 'tok')).toBe(true);
      }
      stub(async () => Response.json({ ...OK, hostname: 'staging.hien-le-garden-v4.pages.dev' }));
      expect(await verifyTurnstile(e, 'tok')).toBe(false);
    });

    describe('response hostname is ASCII-only before normalization (L-1)', () => {
      const e = { TURNSTILE_SECRET_KEY: 'test-secret', TURNSTILE_ALLOWED_HOSTNAMES: 'hienlegarden.vn,staging.hien-le-garden-v4.pages.dev,ok.test,xn--hinlegarden-yfb.vn' };
      async function check(hostname) {
        stub(async () => Response.json({ ...OK, hostname }));
        return verifyTurnstile(e, 'tok');
      }

      it('accepts the production and staging hosts, ASCII uppercase and one trailing dot', async () => {
        for (const h of ['hienlegarden.vn', 'staging.hien-le-garden-v4.pages.dev', 'HIENLEGARDEN.VN', 'Staging.Hien-Le-Garden-V4.Pages.Dev', 'hienlegarden.vn.', 'ok.test', 'OK.TEST']) {
          expect(await check(h), h).toBe(true);
        }
      });

      it('rejects KELVIN SIGN (U+212A) that toLowerCase() would fold onto an allowed "k"', async () => {
        expect('o\u212A.test'.toLowerCase()).toBe('ok.test'); // the collision this guards against
        expect(await check('o\u212A.test')).toBe(false);
      });

      it('rejects other non-ASCII and lookalikes; punycode only matches as exact ASCII', async () => {
        for (const h of ['hi\u00EAnlegarden.vn', '\uFF48ienlegarden.vn', 'h\u0130enlegarden.vn', 'hienlegarden.vn\u200B', '\uFEFFhienlegarden.vn', 'hienlegarden.v\u0578', 'xn--hienlegarden.vn']) {
          expect(await check(h), JSON.stringify(h)).toBe(false);
        }
        expect(await check('xn--hinlegarden-yfb.vn')).toBe(true);
        expect(await check('XN--HINLEGARDEN-YFB.VN')).toBe(true);
      });

      it('rejects control characters, spaces and separators instead of trimming them', async () => {
        for (const h of ['hienlegarden.vn\n', '\nhienlegarden.vn', 'hienlegarden.vn\u0000', 'hien\tlegarden.vn', ' hienlegarden.vn', 'hienlegarden.vn ', 'hien legarden.vn', 'hienlegarden.vn:443', 'hienlegarden.vn/x', 'hienlegarden.vn,ok.test', 'hienlegarden.vn..']) {
          expect(await check(h), JSON.stringify(h)).toBe(false);
        }
      });

      it('rejects an empty or missing hostname', async () => {
        expect(await check('')).toBe(false);
        expect(await check('.')).toBe(false);
        stub(async () => Response.json({ success: true }));
        expect(await verifyTurnstile(e, 'tok')).toBe(false);
      });
    });

    describe('allowlist validation fails closed on ANY invalid entry (L-2)', () => {
      it('accepts valid exact hostnames', () => {
        expect([...parseAllowedHostnames('hienlegarden.vn')]).toEqual(['hienlegarden.vn']);
        expect([...parseAllowedHostnames('staging.hien-le-garden-v4.pages.dev')]).toEqual(['staging.hien-le-garden-v4.pages.dev']);
        expect([...parseAllowedHostnames('example.com')]).toEqual(['example.com']);
        expect([...parseAllowedHostnames(' Example.COM. , hienlegarden.vn')]).toEqual(['example.com', 'hienlegarden.vn']);
        expect(parseAllowedHostnames(`${'a'.repeat(63)}.vn`)).not.toBeNull();
      });

      it.each([
        ['unset', undefined],
        ['non-string', 123],
        ['blank', '  '],
        ['empty entry between', 'a.com,,b.com'],
        ['trailing comma', 'hienlegarden.vn,'],
        ['leading comma', ',hienlegarden.vn'],
        ['single label localhost', 'localhost'],
        ['single label', 'hienlegarden'],
        ['dash only', '-'],
        ['dot only', '.'],
        ['a..', 'a..'],
        ['double trailing dot', 'hienlegarden.vn..'],
        ['leading dot', '.hienlegarden.vn'],
        ['empty label', 'a..b'],
        ['label starts with -', '-hien.vn'],
        ['label ends with -', 'hien-.vn'],
        ['label > 63', `${'a'.repeat(64)}.vn`],
        ['entry > 253', `${'a.'.repeat(126)}vn`],
        ['wildcard', '*.hienlegarden.vn'],
        ['scheme', 'https://hienlegarden.vn'],
        ['path', 'hienlegarden.vn/path'],
        ['port', 'hienlegarden.vn:443'],
        ['IPv4 literal', '1.2.3.4'],
        ['IPv6 literal', '[::1]'],
        ['underscore', 'hien_le.vn'],
        ['non-ASCII', 'hi\u00EAnlegarden.vn'],
        ['Kelvin sign', 'o\u212A.test'],
        ['internal space', 'hien legarden.vn'],
        ['denied pages.dev', 'pages.dev'],
        ['denied workers.dev', 'workers.dev'],
        ['denied trycloudflare.com', 'trycloudflare.com'],
        ['denied PAGES.DEV. (normalized)', 'PAGES.DEV.'],
        ['one bad entry poisons a good list', 'hienlegarden.vn,pages.dev'],
        ['prototype key', 'constructor'],
      ])('rejects %s', async (_label, value) => {
        expect(parseAllowedHostnames(value)).toBeNull();
        const fetchMock = stub(async () => Response.json(OK));
        const e = { TURNSTILE_SECRET_KEY: 'test-secret' };
        if (value !== undefined) e.TURNSTILE_ALLOWED_HOSTNAMES = value;
        expect(await verifyTurnstile(e, 'tok')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
      });
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
