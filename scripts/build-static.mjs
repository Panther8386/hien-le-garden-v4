#!/usr/bin/env node
// Build dist/: the ONLY directory that may be uploaded with `wrangler pages deploy`.
//
// Why (release item R-1): `wrangler pages deploy <dir>` publishes every file in
// <dir> except a tiny hard-coded list (_worker.js, _redirects, _headers,
// _routes.json, functions, .DS_Store, node_modules, .git). It ignores
// .gitignore and .assetsignore. Deploying the repo root therefore published
// wrangler.toml, migrations, lib/, test/, docs/ ... as public files.
//
// Rules:
// - Source = git-TRACKED files only (`git ls-files -z`), read from the working
//   tree. Untracked/ignored local files (.dev.vars, graphify-out/, stray
//   images, ...) can never enter dist/.
// - Every tracked top-level entry must be classified as PUBLIC or PRIVATE in
//   scripts/dist-policy.mjs; an unclassified entry fails the build (a new top-level folder must
//   be decided on explicitly, never silently published or silently dropped).
// - Inside public directories only the extensions allowlisted for that
//   directory are copied; anything else is reported and excluded.
// - dist/ is wiped first; nothing is written outside <repo>/dist; symlinks are
//   never followed (a tracked symlink fails the build).
//
// Pages Functions are NOT copied: wrangler builds them from <cwd>/functions
// (importing ../../lib/*.js) at deploy time, so run wrangler from the repo root.
//
// Usage: node scripts/build-static.mjs      (Node >= 18, no dependencies)

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES, PUBLIC_DIRS, PRIVATE_ENTRIES, allowlistReason } from './dist-policy.mjs';

// Allowlists live in scripts/dist-policy.mjs (shared with check-dist.mjs).
export { PUBLIC_FILES, PUBLIC_DIRS, PRIVATE_ENTRIES } from './dist-policy.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function repoRoot() {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: scriptDir, encoding: 'utf8' }).trim();
  return path.resolve(top);
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function assertNoSymlinkOnPath(root, relPosix) {
  let cur = root;
  for (const seg of relPosix.split('/')) {
    cur = path.join(cur, seg);
    if (existsSync(cur) && lstatSync(cur).isSymbolicLink()) {
      throw new Error(`refusing symlink: ${path.relative(root, cur)}`);
    }
  }
}

export function build({ quiet = false } = {}) {
  const root = repoRoot();
  const dist = path.resolve(root, 'dist');
  if (!isInside(root, dist)) throw new Error(`dist resolves outside repo: ${dist}`);
  if (existsSync(dist) && lstatSync(dist).isSymbolicLink()) throw new Error('dist is a symlink; refusing');

  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--full-name'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const tracked = out.split('\0').filter(Boolean).sort();

  // Tracked symlinks (mode 120000) are refused outright.
  const stage = execFileSync('git', ['ls-files', '-z', '-s'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const links = stage.split('\0').filter((l) => l.startsWith('120000 ')).map((l) => l.split('\t')[1]);
  if (links.length) throw new Error(`tracked symlinks are not allowed:\n  ${links.join('\n  ')}`);

  const unclassified = new Set();
  const selected = [];
  const excluded = [];
  for (const rel of tracked) {
    const top = rel.split('/')[0];
    const isNested = rel.includes('/');
    if (PRIVATE_ENTRIES.has(top)) continue;
    if (!isNested && PUBLIC_FILES.has(top)) { selected.push(rel); continue; }
    if (isNested && PUBLIC_DIRS.has(top)) {
      const reason = allowlistReason(rel);
      if (reason) { excluded.push({ rel, reason }); continue; }
      selected.push(rel);
      continue;
    }
    unclassified.add(isNested ? `${top}/` : top);
  }
  if (unclassified.size) {
    throw new Error(
      'unclassified tracked top-level entries (add each to PUBLIC_FILES/PUBLIC_DIRS or PRIVATE_ENTRIES in scripts/dist-policy.mjs):\n  '
      + [...unclassified].sort().join('\n  '),
    );
  }

  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  const perTop = new Map();
  let totalBytes = 0;
  for (const rel of selected) {
    const src = path.resolve(root, rel);
    const dest = path.resolve(dist, rel);
    if (!isInside(root, src)) throw new Error(`source outside repo: ${rel}`);
    if (!isInside(dist, dest)) throw new Error(`destination outside dist: ${rel}`);
    assertNoSymlinkOnPath(root, rel);
    if (!existsSync(src)) throw new Error(`tracked file missing from working tree: ${rel}`);
    const st = lstatSync(src);
    if (!st.isFile()) throw new Error(`not a regular file: ${rel}`);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    totalBytes += st.size;
    const key = rel.includes('/') ? `${rel.split('/')[0]}/` : '(top-level files)';
    const agg = perTop.get(key) || { files: 0, bytes: 0 };
    agg.files++; agg.bytes += st.size;
    perTop.set(key, agg);
  }

  if (!quiet) {
    console.log(`build-static: wrote ${selected.length} files, ${totalBytes} bytes (${(totalBytes / 1048576).toFixed(2)} MiB) to dist/`);
    for (const key of [...perTop.keys()].sort()) {
      const { files, bytes } = perTop.get(key);
      console.log(`  ${key.padEnd(22)} ${String(files).padStart(4)} files ${String(bytes).padStart(12)} bytes`);
    }
    if (excluded.length) {
      console.log(`build-static: excluded ${excluded.length} tracked file(s) inside public dirs:`);
      for (const { rel, reason } of excluded) console.log(`  - ${rel}: ${reason}`);
    }
  }
  return { root, dist, files: selected, totalBytes, excluded, perTop };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    build();
  } catch (err) {
    console.error(`build-static: FAILED: ${err.message}`);
    process.exit(1);
  }
}
