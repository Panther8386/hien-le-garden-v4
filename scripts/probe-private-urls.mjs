#!/usr/bin/env node
// Post-deploy R-1 probe: proves private repo files are NOT served by a deployment.
// Run by the operator AFTER a production deploy (never from CI, never before):
//
//   node scripts/probe-private-urls.mjs https://hienlegarden.vn https://hien-le-garden-v4.pages.dev
//   node scripts/probe-private-urls.mjs https://<hash>.hien-le-garden-v4.pages.dev   # optional: an old deployment
//   node scripts/probe-private-urls.mjs --self-test                                 # local fixtures only
//
// Why bodies, not status codes: dist/ has no top-level 404.html, so Cloudflare
// Pages treats the site as a SPA and answers unknown paths with 200 + index.html.
// A private URL is PASS only when it answers 404/410, or 200 with a body identical
// (sha256) to the home page "/" (the SPA fallback) — i.e. not the file. Redirects are
// not followed. 3xx, 401/403/429 (e.g. WAF/Access/rate limit), any other 4xx, 5xx,
// network errors, timeouts, or an unusable "/" baseline are INCONCLUSIVE, never PASS.
//
// Exit: 0 = all PASS; 1 = at least one FAIL; 3 = no FAIL but something INCONCLUSIVE.
// Node >= 18 (global fetch), no dependencies. GET requests only; sends no credentials.

import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRIVATE_PATHS = [
  '/wrangler.toml', '/BACKEND.md', '/package.json', '/package-lock.json', '/vitest.config.js',
  '/.assetsignore', '/.gitignore', '/.env.example', '/.dev.vars',
  '/migrations/0001_init.sql', '/migrations/0042_permissions.sql',
  '/lib/auth.js', '/lib/permissions.js', '/test/auth.test.js',
  '/scripts/seed-manager.js', '/scripts/build-static.mjs', '/scripts/dist-policy.mjs',
  '/docs/releases/admin-permissions-release-runbook.md', '/docs/releases/staging-isolation.md',
  '/docs/superpowers/plans/2026-08-21-manager-dashboard-plan.md',
  '/functions/api/auth/login.js', '/.github/workflows/deploy.yml',
  '/.superpowers/', '/graphify-out/', '/images/.DS_Store',
];

// Public pages that must still work: [path, expectation]
export const PUBLIC_CHECKS = [
  ['/manifest.json', 'distinct'],
  ['/sw.js', 'distinct'],
  ['/robots.txt', 'distinct'],
  ['/admin/admin.css', 'distinct'],
  ['/tri-an-khach-hang/', 'distinct'],
  ['/api/public-config', 'json'],
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function get(url, timeoutMs, redirect = 'follow') {
  try {
    const res = await fetch(url, { redirect, signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'hlg-r1-probe' } });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type') || '', hash: sha256(body), size: body.length };
  } catch (err) {
    return { error: (err && (err.cause?.code || err.name || err.message)) || 'error' };
  }
}

export async function probe(base, { timeoutMs = 15000, log = console.log } = {}) {
  const origin = base.replace(/\/+$/, '');
  const counts = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
  const emit = (result, what, detail) => { counts[result]++; log(`${result.padEnd(12)} ${origin}${what}  ${detail}`); };

  const home = await get(`${origin}/`, timeoutMs);
  if (home.error || home.status !== 200 || home.size === 0) {
    emit('INCONCLUSIVE', '/', `baseline unusable (${home.error || `status ${home.status}, ${home.size} B`}) — cannot judge any path`);
    return counts;
  }
  log(`baseline     ${origin}/  200 ${home.type} ${home.size} B sha256=${home.hash.slice(0, 16)}…`);

  for (const p of PRIVATE_PATHS) {
    // redirects are NOT followed for private paths: a 3xx is reported, not trusted
    const r = await get(`${origin}${p}`, timeoutMs, 'manual');
    if (r.error) emit('INCONCLUSIVE', p, `network error: ${r.error}`);
    else if (r.status === 404 || r.status === 410) emit('PASS', p, `status ${r.status}`);
    else if (r.status !== 200) emit('INCONCLUSIVE', p, `status ${r.status} (only 404/410 or 200 = fallback count as PASS; 3xx/401/403/429/other 4xx/5xx may hide the file)`);
    else if (r.hash === home.hash) emit('PASS', p, '200 = SPA fallback (home page body)');
    else emit('FAIL', p, `200 ${r.type} ${r.size} B — body differs from home page: file may be served`);
  }
  for (const [p, kind] of PUBLIC_CHECKS) {
    const r = await get(`${origin}${p}`, timeoutMs);
    if (r.error) { emit('INCONCLUSIVE', p, `network error: ${r.error}`); continue; }
    if (r.status >= 500) { emit('INCONCLUSIVE', p, `status ${r.status}`); continue; }
    const okStatus = r.status === 200;
    const ok = kind === 'json' ? okStatus && /json/i.test(r.type)
      : kind === 'distinct' ? okStatus && r.hash !== home.hash
        : okStatus;
    emit(ok ? 'PASS' : 'FAIL', p, `public ${kind}: ${r.status} ${r.type}`);
  }
  return counts;
}

// ---------- self-test: local fixture servers on 127.0.0.1, no real hosts ----------
function fixtureServer(mode) {
  const HOME = '<!doctype html><title>home</title>';
  return http.createServer((req, res) => {
    const url = req.url || '/';
    if (mode === 'home500' && url === '/') { res.writeHead(500); res.end('err'); return; }
    if (url === '/manifest.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"name":"x"}'); return; }
    if (url === '/sw.js' || url === '/robots.txt' || url === '/admin/admin.css') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`file ${url}`); return; }
    if (url === '/tri-an-khach-hang/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>feedback</title>'); return; }
    if (url === '/api/public-config') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"turnstileSiteKey":null}'); return; }
    if (mode === 'leak' && url === '/wrangler.toml') { res.writeHead(200, { 'content-type': 'application/toml' }); res.end('name = "x"'); return; }
    if (mode === 'notfound' && url !== '/' && url !== '/tri-an-khach-hang/') { res.writeHead(404); res.end('nf'); return; }
    if (mode === 'err5xx' && url === '/lib/auth.js') { res.writeHead(502); res.end('bad gateway'); return; }
    if (mode.startsWith('status') && url === '/lib/auth.js') {
      const code = Number(mode.slice(6));
      res.writeHead(code, code >= 300 && code < 400 ? { location: '/' } : {}); res.end('x'); return;
    }
    if (mode === 'drop' && url === '/BACKEND.md') { req.socket.destroy(); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(HOME); // SPA fallback
  });
}

async function withServer(mode, fn) {
  const srv = fixtureServer(mode);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { await new Promise((r) => srv.close(r)); }
}

async function selfTest() {
  const quiet = () => {};
  const cases = [
    ['SPA fallback for every private path', 'spa', (c) => c.FAIL === 0 && c.INCONCLUSIVE === 0 && c.PASS > 0],
    ['404 for every private path', 'notfound', (c) => c.FAIL === 0 && c.INCONCLUSIVE === 0],
    ['one private file served (/wrangler.toml)', 'leak', (c) => c.FAIL === 1],
    ['502 on one private path', 'err5xx', (c) => c.FAIL === 0 && c.INCONCLUSIVE === 1],
    ['410 on one private path (PASS)', 'status410', (c) => c.FAIL === 0 && c.INCONCLUSIVE === 0],
    ...[301, 302, 308, 400, 401, 403, 405, 429].map((code) => [`${code} on one private path (INCONCLUSIVE)`, `status${code}`, (c) => c.FAIL === 0 && c.INCONCLUSIVE === 1]),
    ['connection dropped on one private path', 'drop', (c) => c.FAIL === 0 && c.INCONCLUSIVE === 1],
    ['home page returns 500', 'home500', (c) => c.PASS === 0 && c.INCONCLUSIVE === 1],
  ];
  let failures = 0;
  for (const [label, mode, expect] of cases) {
    const c = await withServer(mode, (base) => probe(base, { timeoutMs: 5000, log: quiet }));
    const ok = expect(c);
    if (!ok) failures++;
    console.log(`self-test: ${ok ? 'ok  ' : 'BAD '} ${label} -> PASS=${c.PASS} FAIL=${c.FAIL} INCONCLUSIVE=${c.INCONCLUSIVE}`);
  }
  // unreachable host: a port nothing listens on (bind then close)
  const dead = await withServer('spa', async (base) => base);
  const c = await probe(dead, { timeoutMs: 3000, log: quiet });
  const ok = c.PASS === 0 && c.FAIL === 0 && c.INCONCLUSIVE === 1;
  if (!ok) failures++;
  console.log(`self-test: ${ok ? 'ok  ' : 'BAD '} unreachable host (connection refused) -> PASS=${c.PASS} FAIL=${c.FAIL} INCONCLUSIVE=${c.INCONCLUSIVE}`);
  console.log(failures ? `self-test: FAILED (${failures} case(s))` : `self-test: OK (${cases.length + 1} cases)`);
  return failures === 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    process.exit((await selfTest()) ? 0 : 1);
  }
  if (!args.length || args.some((a) => !/^https?:\/\//.test(a))) {
    console.error('usage: node scripts/probe-private-urls.mjs <base-url> [<base-url> ...] | --self-test');
    process.exit(64);
  }
  const total = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
  for (const base of args) {
    const c = await probe(base);
    for (const k of Object.keys(total)) total[k] += c[k];
  }
  console.log(`\nSUMMARY PASS=${total.PASS} FAIL=${total.FAIL} INCONCLUSIVE=${total.INCONCLUSIVE}`);
  process.exit(total.FAIL ? 1 : total.INCONCLUSIVE ? 3 : 0);
}
