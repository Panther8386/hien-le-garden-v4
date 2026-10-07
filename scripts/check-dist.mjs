#!/usr/bin/env node
// Boundary check for dist/ before `wrangler pages deploy dist` (release item R-1).
//
//   node scripts/check-dist.mjs              check <repo>/dist
//   node scripts/check-dist.mjs <dir>        check another directory
//   node scripts/check-dist.mjs --self-test  prove the check FAILS on planted
//                                            private / non-allowlisted files
//                                            and PASSES on a clean copy of dist/
//
// Two independent gates, both must pass (exit 1 otherwise, offending paths listed):
//   1. denylist  — no private path (case-insensitive: LIB/, Wrangler.toml, .ENV ...)
//   2. allowlist — every file is a PUBLIC_FILES entry, or lives in a PUBLIC_DIRS
//                  directory with an extension allowed for that directory
//                  (scripts/dist-policy.mjs, shared with build-static.mjs)
// plus: every REQUIRED public asset is present; no symlinks (never followed).

import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED, allowlistReason } from './dist-policy.mjs';

export { REQUIRED };

// All comparisons below are on lowercased segments/basenames.
// Private top-level directories (top level only: admin/lib/qrcode.min.js is a
// legitimate public file, so "lib/**" means <dist>/lib/**).
const PRIVATE_TOP_DIRS = new Set(['functions', 'lib', 'migrations', 'test', 'scripts', 'docs', '.github']);
// Private directory names at ANY depth.
const PRIVATE_ANY_DIRS = new Set(['.superpowers', 'graphify-out', '.git', 'node_modules', 'test-results', '.wrangler', '.claude']);
// Private file basenames at any depth.
const PRIVATE_BASENAMES = new Set([
  'wrangler.toml', 'package.json', 'package-lock.json', 'backend.md',
  '.assetsignore', '.gitignore', 'vitest.config.js',
]);

export function privateReason(relPosix) {
  const segs = relPosix.toLowerCase().split('/');
  const base = segs[segs.length - 1];
  if (segs.length > 1 && PRIVATE_TOP_DIRS.has(segs[0])) return `private top-level dir ${segs[0]}/`;
  for (const s of segs) {
    if (PRIVATE_ANY_DIRS.has(s)) return `private dir ${s}/`;
    if (s.startsWith('.env')) return 'segment starts with .env';
    if (s.startsWith('.dev.vars')) return 'segment starts with .dev.vars';
  }
  if (PRIVATE_BASENAMES.has(base)) return `private file ${base}`;
  if (base.startsWith('readme')) return 'README*';
  for (const ext of ['.md', '.map', '.lock', '.log', '.sql', '.test.js']) {
    if (base.endsWith(ext)) return `*${ext}`;
  }
  return null;
}

function walk(root) {
  const files = [];
  const symlinks = [];
  const stack = [''];
  while (stack.length) {
    const relDir = stack.pop();
    for (const ent of readdirSync(path.join(root, relDir), { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) { symlinks.push(rel); continue; }
      if (ent.isDirectory()) stack.push(rel); else files.push(rel);
    }
  }
  return { files: files.sort(), symlinks: symlinks.sort() };
}

export function checkDir(dir) {
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) {
    return { ok: false, violations: [], missing: [], symlinks: [], error: `not a directory: ${dir}`, count: 0 };
  }
  const { files, symlinks } = walk(dir);
  const violations = [];
  for (const f of files) {
    const reason = privateReason(f) || allowlistReason(f);
    if (reason) violations.push({ path: f, reason });
  }
  const present = new Set(files);
  const missing = REQUIRED.filter((r) => !present.has(r));
  return { ok: !violations.length && !missing.length && !symlinks.length, violations, missing, symlinks, count: files.length };
}

function report(label, res) {
  if (res.error) { console.error(`${label}: FAIL ${res.error}`); return; }
  if (res.ok) { console.log(`${label}: PASS (${res.count} files, 0 private/non-allowlisted paths, ${REQUIRED.length}/${REQUIRED.length} required assets present)`); return; }
  console.error(`${label}: FAIL`);
  for (const v of res.violations) console.error(`  not allowed: ${v.path}  [${v.reason}]`);
  for (const m of res.missing) console.error(`  missing required: ${m}`);
  for (const s of res.symlinks) console.error(`  symlink: ${s}`);
}

const PLANTS = [
  // private paths (denylist)
  'lib/auth.js', 'docs/x.md', '.dev.vars', 'nested/.env.local', 'a/b/c.sql',
  'functions/api/auth/login.js', 'migrations/0001_init.sql', 'test/auth.test.js',
  'scripts/seed-manager.js', '.github/workflows/deploy.yml', '.superpowers/notes.txt',
  'graphify-out/graph.json', '.git/config', 'wrangler.toml', 'package.json',
  'package-lock.json', 'yarn.lock', 'BACKEND.md', 'README.txt', 'admin/notes.md',
  'admin/admin.js.map', 'test-results/out.json', 'logs/debug.log', '.assetsignore',
  '.gitignore', 'vitest.config.js', 'admin/x.test.js', 'node_modules/pkg/index.js',
  'images/.env', 'deep/.dev.vars.production',
  // uppercase / mixed-case variants
  'Wrangler.toml', 'PACKAGE.JSON', 'LIB/auth.js', 'Functions/api/x.js', '.ENV', '.Env.local',
  '.DEV.VARS', 'Docs/a.txt', '.GIT/config', 'NODE_MODULES/x.js', 'vitest.config.JS', '.GITIGNORE',
  'Migrations/0001.txt', 'admin/README.html', 'admin/Notes.MD', 'images/DUMP.SQL',
  // allowlist-only violations (no private pattern)
  'random.txt', 'newdir/x.png', 'images/x.html', 'images/y.js', 'videos/a.js',
  'videos/b.html', 'admin/data.json', 'assets/x.php', 'images/noext',
];

function selfTest(distDir) {
  const base = checkDir(distDir);
  if (base.error) { console.error(`self-test: ${base.error} — run node scripts/build-static.mjs first`); return false; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'check-dist-selftest-'));
  let failures = 0;
  try {
    const copy = path.join(tmp, 'dist');
    cpSync(distDir, copy, { recursive: true, verbatimSymlinks: true });
    const clean = checkDir(copy);
    if (clean.ok) console.log(`self-test: clean copy PASS as expected (${clean.count} files)`);
    else { failures++; console.error('self-test: clean copy unexpectedly FAILED'); report('  clean copy', clean); }

    for (const plant of PLANTS) {
      const abs = path.join(copy, ...plant.split('/'));
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, 'planted by check-dist self-test\n');
      const res = checkDir(copy);
      const hit = res.violations.find((v) => v.path === plant);
      if (!res.ok && hit) console.log(`self-test: planted ${plant} -> FAIL as expected [${hit.reason}]`);
      else { failures++; console.error(`self-test: planted ${plant} -> NOT DETECTED`); }
      // remove the plant's top-level entry, then restore it from dist/ if it is a real one (e.g. admin/)
      const top = plant.split('/')[0];
      rmSync(path.join(copy, top), { recursive: true, force: true });
      if (existsSync(path.join(distDir, top))) cpSync(path.join(distDir, top), path.join(copy, top), { recursive: true });
    }

    for (const req of ['index.html', 'admin/login.html', '_redirects', 'admin/tabs.js']) {
      const abs = path.join(copy, ...req.split('/'));
      rmSync(abs, { force: true });
      const res = checkDir(copy);
      if (!res.ok && res.missing.includes(req)) console.log(`self-test: removed ${req} -> FAIL as expected`);
      else { failures++; console.error(`self-test: removed ${req} -> NOT DETECTED`); }
      cpSync(path.join(distDir, ...req.split('/')), abs);
    }

    const final = checkDir(copy);
    if (final.ok) console.log('self-test: restored copy PASS as expected');
    else { failures++; console.error('self-test: restored copy unexpectedly FAILED'); report('  restored copy', final); }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures
    ? `self-test: FAILED (${failures} problem(s))`
    : `self-test: OK (${PLANTS.length} planted paths + 4 missing-asset cases detected; clean copy passes)`);
  return failures === 0;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const defaultDist = path.resolve(scriptDir, '..', 'dist');
  if (args.includes('--self-test')) {
    process.exit(selfTest(defaultDist) ? 0 : 1);
  }
  const target = path.resolve(args[0] || defaultDist);
  const res = checkDir(target);
  report(`check-dist ${path.relative(process.cwd(), target) || '.'}`, res);
  process.exit(res.ok ? 0 : 1);
}
