#!/usr/bin/env node
// Misconfiguration guard for staging/preview (docs/releases/staging-isolation.md §5).
// MANDATORY before any test against a preview/staging deployment.
//
//   node scripts/check-staging-bindings.mjs [path/to/wrangler.toml]
//   node scripts/check-staging-bindings.mjs --self-test
//
// Reads the config with wrangler's own loader (no regex/grep on the TOML):
//   - experimental_readRawConfig -> is there a real [env.preview] table?
//   - unstable_readConfig({ env: undefined })  -> production (top-level) bindings
//   - unstable_readConfig({ env: "preview" })  -> what a preview deployment gets
// (both exported by wrangler 3.114.17, wrangler-dist/cli.js ~79181 / ~89756 / ~89825;
// d1_databases / r2_buckets are non-inheritable, so the preview result is exactly
// the [env.preview] tables, or the top-level ones when [env.preview] is absent.)
//
// Exit codes:
//   0 = preview is isolated (every production D1/R2 binding exists in preview,
//       and no preview database_id / database_name / bucket_name equals production)
//   1 = MISMATCH: preview would touch production, or a binding is missing
//   2 = NOT CONFIGURED: no [env.preview] -> preview uses PRODUCTION bindings
// Never calls the network, never prints secrets (wrangler.toml holds none).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const REQUIRED_D1 = ['DB'];
const REQUIRED_R2 = ['RECEIPTS'];

export function checkStagingBindings(configPath) {
  const wrangler = require('wrangler');
  const lines = [];
  let raw;
  try {
    ({ rawConfig: raw } = wrangler.experimental_readRawConfig({ config: configPath }));
  } catch (err) {
    return { code: 1, lines: [`FAIL: cannot parse ${configPath}: ${err.message}`] };
  }
  const hasPreview = raw && raw.env && typeof raw.env === 'object' && raw.env.preview && typeof raw.env.preview === 'object';
  if (!hasPreview) {
    return { code: 2, lines: ['NOT CONFIGURED: no [env.preview] in wrangler.toml — preview uses PRODUCTION bindings (D1/R2). Do not run preview/staging tests.'] };
  }
  let prod;
  let prev;
  try {
    prod = wrangler.unstable_readConfig({ config: configPath }, { hideWarnings: true });
    prev = wrangler.unstable_readConfig({ config: configPath, env: 'preview' }, { hideWarnings: true });
  } catch (err) {
    return { code: 1, lines: [`FAIL: wrangler rejected the config: ${err.message}`] };
  }
  const prodD1 = prod.d1_databases || [];
  const prodR2 = prod.r2_buckets || [];
  const prevD1 = prev.d1_databases || [];
  const prevR2 = prev.r2_buckets || [];
  const prodIds = new Set(prodD1.map((d) => d.database_id).filter(Boolean));
  const prodNames = new Set(prodD1.map((d) => d.database_name).filter(Boolean));
  const prodBuckets = new Set(prodR2.flatMap((b) => [b.bucket_name, b.preview_bucket_name]).filter(Boolean));
  const problems = [];

  const d1Bindings = new Set([...REQUIRED_D1, ...prodD1.map((d) => d.binding)]);
  for (const b of d1Bindings) {
    const p = prevD1.find((d) => d.binding === b);
    if (!p) { problems.push(`preview D1 binding ${b} is missing`); continue; }
    if (!p.database_id) problems.push(`preview D1 ${b} has no database_id`);
  }
  for (const p of prevD1) {
    if (p.database_id && prodIds.has(p.database_id)) problems.push(`preview D1 ${p.binding} database_id equals PRODUCTION (${p.database_id})`);
    if (p.preview_database_id && prodIds.has(p.preview_database_id)) problems.push(`preview D1 ${p.binding} preview_database_id equals PRODUCTION`);
    if (p.database_name && prodNames.has(p.database_name)) problems.push(`preview D1 ${p.binding} database_name equals PRODUCTION (${p.database_name})`);
  }
  const r2Bindings = new Set([...REQUIRED_R2, ...prodR2.map((b) => b.binding)]);
  for (const b of r2Bindings) {
    const p = prevR2.find((x) => x.binding === b);
    if (!p) { problems.push(`preview R2 binding ${b} is missing`); continue; }
    if (!p.bucket_name) problems.push(`preview R2 ${b} has no bucket_name`);
  }
  for (const p of prevR2) {
    if (p.bucket_name && prodBuckets.has(p.bucket_name)) problems.push(`preview R2 ${p.binding} bucket_name equals PRODUCTION (${p.bucket_name})`);
  }

  if (problems.length) {
    return { code: 1, lines: ['FAIL: preview bindings are not isolated from production:', ...problems.map((x) => `  - ${x}`)] };
  }
  lines.push('OK: preview is isolated from production');
  for (const d of prevD1) lines.push(`  D1 ${d.binding} -> ${d.database_name} (${d.database_id})`);
  for (const b of prevR2) lines.push(`  R2 ${b.binding} -> ${b.bucket_name}`);
  return { code: 0, lines };
}

function selfTest() {
  const base = readFileSync(path.resolve(scriptDir, '..', 'wrangler.toml'), 'utf8');
  const PROD_ID = 'bf3ed73c-96de-494c-a3f9-e905f2bf8c48';
  const S_ID = '11111111-2222-3333-4444-555555555555';
  const goodPreview = `
[env.preview]

[[env.preview.d1_databases]]
binding = "DB"
database_name = "hien_le_garden_crm_staging"
database_id = "${S_ID}"
migrations_dir = "migrations"

[[env.preview.r2_buckets]]
binding = "RECEIPTS"
bucket_name = "hien-le-garden-finance-receipts-staging"
`;
  const cases = [
    ['current wrangler.toml (no [env.preview])', '', 2],
    ['commented-out # [env.preview] with staging ids', `
# [env.preview]
# [[env.preview.d1_databases]]
# binding = "DB"
# database_id = "${S_ID}"
# bucket_name = "some-staging"
`, 2],
    ['valid isolated [env.preview]', goodPreview, 0],
    ['preview DB = production id as single-quoted literal + second DB double-quoted staging', `
[env.preview]

[[env.preview.d1_databases]]
binding = 'DB'
database_name = 'hien_le_garden_crm_x'
database_id = '${PROD_ID}'

[[env.preview.d1_databases]]
binding = "DB2"
database_name = "hien_le_garden_crm_staging"
database_id = "${S_ID}"

[[env.preview.r2_buckets]]
binding = "RECEIPTS"
bucket_name = "hien-le-garden-finance-receipts-staging"
`, 1],
    ['preview R2 bucket = production (single-quoted)', goodPreview.replace('"hien-le-garden-finance-receipts-staging"', "'hien-le-garden-finance-receipts'"), 1],
    ['preview D1 database_name = production name, different id', goodPreview.replace('"hien_le_garden_crm_staging"', '"hien_le_garden_crm"'), 1],
    ['preview without r2_buckets (RECEIPTS missing)', goodPreview.split('[[env.preview.r2_buckets]]')[0], 1],
    ['preview D1 under another binding name (DB missing)', goodPreview.replace('binding = "DB"', 'binding = "STAGING_DB"'), 1],
    ['inline-table form with production id', `
[env.preview]
d1_databases = [ { binding = 'DB', database_name = 'x', database_id = '${PROD_ID}' } ]
r2_buckets = [ { binding = 'RECEIPTS', bucket_name = 'hien-le-garden-finance-receipts-staging' } ]
`, 1],
  ];
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'staging-guard-selftest-'));
  let failures = 0;
  try {
    cases.forEach(([label, extra, want], i) => {
      const file = path.join(tmp, `case${i}`, 'wrangler.toml');
      require('node:fs').mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, base + extra);
      const { code, lines } = checkStagingBindings(file);
      const ok = code === want;
      if (!ok) failures++;
      console.log(`self-test: ${ok ? 'ok  ' : 'BAD '} ${label} -> exit ${code} (expected ${want}) | ${lines[0]}${lines[1] ? ' ' + lines[1].trim() : ''}`);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `self-test: FAILED (${failures} case(s))` : `self-test: OK (${cases.length} cases)`);
  return failures === 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
  const configPath = path.resolve(args[0] || path.resolve(scriptDir, '..', 'wrangler.toml'));
  const { code, lines } = checkStagingBindings(configPath);
  for (const l of lines) (code === 0 ? console.log : console.error)(l);
  process.exit(code);
}
