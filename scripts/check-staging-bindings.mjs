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
//   (--self-test: 0 = every fixture case produced its expected reason, else 1)
// Also exit 1 when wrangler.json / wrangler.jsonc / .wrangler/deploy/config.json
// (this dir or any ancestor) would make wrangler read a different config.
// Ids, names and buckets are compared after trim().toLowerCase().
// Every result also carries a machine-checkable REASON (printed as the last
// line `REASON: <code>`): PASS (0), MISMATCH (1, preview touches production or
// a binding is missing), NOT_CONFIGURED (2), SHADOW (1, another config file
// would be read), MALFORMED (1, the TOML cannot be parsed), INVALID (1, the TOML
// parses but wrangler's own validation rejects it, e.g. an upper-case bucket name).
// The self-test asserts the reason, so a parse error can never stand in for a
// MISMATCH / NOT_CONFIGURED / SHADOW / INVALID result.
// Never calls the network, never prints secrets (wrangler.toml holds none).

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const REQUIRED_D1 = ['DB'];
const REQUIRED_R2 = ['RECEIPTS'];

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

// wrangler resolves its config with findUp: wrangler.json, then wrangler.jsonc,
// then wrangler.toml (any ancestor dir), and pages commands follow a
// .wrangler/deploy/config.json redirect (cli.js findWranglerConfig ~84277,
// findRedirectedWranglerConfig ~84285). If any of those shadow the toml we
// check, wrangler would read a different file -> refuse.
function shadowingConfigs(configPath) {
  const found = [];
  let dir = path.dirname(path.resolve(configPath));
  for (;;) {
    for (const name of ['wrangler.json', 'wrangler.jsonc', path.join('.wrangler', 'deploy', 'config.json')]) {
      const f = path.join(dir, name);
      if (existsSync(f)) found.push(f);
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return found;
}

export function checkStagingBindings(configPath) {
  const wrangler = require('wrangler');
  const lines = [];
  const shadows = shadowingConfigs(configPath);
  if (shadows.length) {
    return { code: 1, reason: 'SHADOW', lines: ['FAIL: another wrangler config would be used instead of this wrangler.toml:', ...shadows.map((f) => `  - ${f}`)] };
  }
  let raw;
  try {
    ({ rawConfig: raw } = wrangler.experimental_readRawConfig({ config: configPath }));
  } catch (err) {
    return { code: 1, reason: 'MALFORMED', lines: [`FAIL: cannot parse ${configPath}: ${err.message}`] };
  }
  const hasPreview = raw && raw.env && typeof raw.env === 'object' && raw.env.preview && typeof raw.env.preview === 'object';
  if (!hasPreview) {
    return { code: 2, reason: 'NOT_CONFIGURED', lines: ['NOT CONFIGURED: no [env.preview] in wrangler.toml — preview uses PRODUCTION bindings (D1/R2). Do not run preview/staging tests.'] };
  }
  let prod;
  let prev;
  try {
    prod = wrangler.unstable_readConfig({ config: configPath }, { hideWarnings: true });
    prev = wrangler.unstable_readConfig({ config: configPath, env: 'preview' }, { hideWarnings: true });
  } catch (err) {
    return { code: 1, reason: 'INVALID', lines: [`FAIL: wrangler rejected the config: ${err.message}`] };
  }
  const prodD1 = prod.d1_databases || [];
  const prodR2 = prod.r2_buckets || [];
  const prevD1 = prev.d1_databases || [];
  const prevR2 = prev.r2_buckets || [];
  const prodIds = new Set(prodD1.flatMap((d) => [d.database_id, d.preview_database_id]).filter(Boolean).map(norm));
  const prodNames = new Set(prodD1.map((d) => d.database_name).filter(Boolean).map(norm));
  const prodBuckets = new Set(prodR2.flatMap((b) => [b.bucket_name, b.preview_bucket_name]).filter(Boolean).map(norm));
  const problems = [];

  const d1Bindings = new Set([...REQUIRED_D1, ...prodD1.map((d) => d.binding)]);
  for (const b of d1Bindings) {
    const p = prevD1.find((d) => d.binding === b);
    if (!p) { problems.push(`preview D1 binding ${b} is missing`); continue; }
    if (!norm(p.database_id)) problems.push(`preview D1 ${b} has no database_id`);
  }
  for (const p of prevD1) {
    if (p.database_id && prodIds.has(norm(p.database_id))) problems.push(`preview D1 ${p.binding} database_id equals PRODUCTION (${p.database_id})`);
    if (p.preview_database_id && prodIds.has(norm(p.preview_database_id))) problems.push(`preview D1 ${p.binding} preview_database_id equals PRODUCTION`);
    if (p.database_name && prodNames.has(norm(p.database_name))) problems.push(`preview D1 ${p.binding} database_name equals PRODUCTION (${p.database_name})`);
  }
  const r2Bindings = new Set([...REQUIRED_R2, ...prodR2.map((b) => b.binding)]);
  for (const b of r2Bindings) {
    const p = prevR2.find((x) => x.binding === b);
    if (!p) { problems.push(`preview R2 binding ${b} is missing`); continue; }
    if (!norm(p.bucket_name)) problems.push(`preview R2 ${b} has no bucket_name`);
  }
  for (const p of prevR2) {
    if (p.bucket_name && prodBuckets.has(norm(p.bucket_name))) problems.push(`preview R2 ${p.binding} bucket_name equals PRODUCTION (${p.bucket_name})`);
  }

  if (problems.length) {
    return { code: 1, reason: 'MISMATCH', problems, lines: ['FAIL: preview bindings are not isolated from production:', ...problems.map((x) => `  - ${x}`)] };
  }
  lines.push('OK: preview is isolated from production');
  for (const d of prevD1) lines.push(`  D1 ${d.binding} -> ${d.database_name} (${d.database_id})`);
  for (const b of prevR2) lines.push(`  R2 ${b.binding} -> ${b.bucket_name}`);
  return { code: 0, reason: 'PASS', lines };
}

// ---------------------------------------------------------------------------
// Self-test. Independent of the real wrangler.toml (never read here): every
// case is BASELINE (a fixed, production-only fixture config) + a case-specific
// block, written to a temp dir. Each case asserts an outcome CLASS (reason +
// exit code) and, for MISMATCH, the specific problem, so a TOML parse error can
// only ever satisfy the case that is explicitly about malformed TOML.
const FIXTURE_PROD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const FIXTURE_PROD_DB = 'fixture_crm_prod';
const FIXTURE_PROD_BUCKET = 'fixture-receipts-prod';
const FIXTURE_STAGING_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002';
const FIXTURE_STAGING_DB = 'fixture_crm_staging';
const FIXTURE_STAGING_BUCKET = 'fixture-receipts-staging';

const BASELINE = `name = "fixture-app"
compatibility_date = "2024-09-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "${FIXTURE_PROD_DB}"
database_id = "${FIXTURE_PROD_ID}"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "RECEIPTS"
bucket_name = "${FIXTURE_PROD_BUCKET}"
`;

const EXIT_FOR = { PASS: 0, MISMATCH: 1, NOT_CONFIGURED: 2, SHADOW: 1, MALFORMED: 1, INVALID: 1 };

function selfTestCases() {
  const P = FIXTURE_PROD_ID;
  const S = FIXTURE_STAGING_ID;
  const good = `
[env.preview]

[[env.preview.d1_databases]]
binding = "DB"
database_name = "${FIXTURE_STAGING_DB}"
database_id = "${S}"
migrations_dir = "migrations"

[[env.preview.r2_buckets]]
binding = "RECEIPTS"
bucket_name = "${FIXTURE_STAGING_BUCKET}"
`;
  const swap = (from, to) => {
    if (!good.includes(from)) throw new Error(`self-test fixture bug: "${from}" not in the good preview block`);
    return good.replace(from, () => to);
  };
  const TQ = '"""';
  const TL = "'''";
  // [label, extra TOML, expected reason, expected detail (a MISMATCH problem, else a substring of the output), sidecar files]
  return [
    ['baseline only (no [env.preview])', '', 'NOT_CONFIGURED'],
    ['commented-out # [env.preview] with staging ids', `
# [env.preview]
# [[env.preview.d1_databases]]
# binding = "DB"
# database_id = "${S}"
# bucket_name = "some-staging"
`, 'NOT_CONFIGURED'],
    ['valid isolated [env.preview]', good, 'PASS'],
    ['preview DB = production id as single-quoted literal + second DB double-quoted staging', `
[env.preview]

[[env.preview.d1_databases]]
binding = 'DB'
database_name = 'fixture_crm_x'
database_id = '${P}'

[[env.preview.d1_databases]]
binding = "DB2"
database_name = "${FIXTURE_STAGING_DB}"
database_id = "${S}"

[[env.preview.r2_buckets]]
binding = "RECEIPTS"
bucket_name = "${FIXTURE_STAGING_BUCKET}"
`, 'MISMATCH', 'D1 DB database_id equals PRODUCTION'],
    ['preview R2 bucket = production (single-quoted)', swap(`"${FIXTURE_STAGING_BUCKET}"`, `'${FIXTURE_PROD_BUCKET}'`), 'MISMATCH', 'R2 RECEIPTS bucket_name equals PRODUCTION'],
    ['preview D1 database_name = production name, different id', swap(`"${FIXTURE_STAGING_DB}"`, `"${FIXTURE_PROD_DB}"`), 'MISMATCH', 'D1 DB database_name equals PRODUCTION'],
    ['preview without r2_buckets (RECEIPTS missing)', good.split('[[env.preview.r2_buckets]]')[0], 'MISMATCH', 'R2 binding RECEIPTS is missing'],
    ['preview D1 under another binding name (DB missing)', swap('binding = "DB"', 'binding = "STAGING_DB"'), 'MISMATCH', 'D1 binding DB is missing'],
    ['preview DB = production id in UPPER CASE', swap(`"${S}"`, `"${P.toUpperCase()}"`), 'MISMATCH', 'D1 DB database_id equals PRODUCTION'],
    ['preview DB = production id with leading/trailing whitespace', swap(`"${S}"`, `"  ${P} "`), 'MISMATCH', 'D1 DB database_id equals PRODUCTION'],
    // wrangler itself refuses upper-case bucket names, so a mixed-case copy of the
    // production bucket can never be deployed; the guard must refuse it as INVALID
    // (before 2026-09-28 this case "passed" without reaching the comparison).
    ['preview R2 bucket = production in mixed case (wrangler rejects it)', swap(`"${FIXTURE_STAGING_BUCKET}"`, '"Fixture-Receipts-PROD"'), 'INVALID', 'bucket_name="Fixture-Receipts-PROD" is invalid'],
    ['preview DB = production id as multiline basic string', swap(`"${S}"`, `${TQ}\n${P}${TQ}`), 'MISMATCH', 'D1 DB database_id equals PRODUCTION'],
    ['preview R2 bucket = production as multiline literal string', swap(`"${FIXTURE_STAGING_BUCKET}"`, `${TL}\n${FIXTURE_PROD_BUCKET}${TL}`), 'MISMATCH', 'R2 RECEIPTS bucket_name equals PRODUCTION'],
    ['empty [env.preview] table', '\n[env.preview]\n', 'MISMATCH', 'D1 binding DB is missing'],
    ['inline-table form with production id', `
[env.preview]
d1_databases = [ { binding = 'DB', database_name = 'x', database_id = '${P}' } ]
r2_buckets = [ { binding = 'RECEIPTS', bucket_name = '${FIXTURE_STAGING_BUCKET}' } ]
`, 'MISMATCH', 'D1 DB database_id equals PRODUCTION'],
    ['valid preview but wrangler.json next to wrangler.toml', good, 'SHADOW', null, { 'wrangler.json': '{"name":"x"}' }],
    ['valid preview but wrangler.jsonc next to wrangler.toml', good, 'SHADOW', null, { 'wrangler.jsonc': '{"name":"x"}' }],
    ['valid preview but .wrangler/deploy/config.json redirect', good, 'SHADOW', null, { '.wrangler/deploy/config.json': '{"configPath":"../../wrangler.toml"}' }],
    ['MALFORMED: duplicate [env.preview] table (explicit parse-error case)', good + good, 'MALFORMED'],
  ];
}

function selfTest() {
  const wrangler = require('wrangler');
  const cases = selfTestCases();
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'staging-guard-selftest-'));
  let failures = 0;
  let parsed = 0;
  const fail = (msg) => { failures++; console.log(`self-test: BAD  ${msg}`); };
  try {
    // The harness itself must not sit under a shadowing config.
    const hostShadows = shadowingConfigs(path.join(tmp, 'wrangler.toml'));
    if (hostShadows.length) fail(`temp dir is shadowed by ${hostShadows.join(', ')}; cannot run the self-test here`);

    cases.forEach(([label, extra, want, detail = null, sidecars = {}], i) => {
      const file = path.join(tmp, `case${i}`, 'wrangler.toml');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, BASELINE + extra);

      // Regression guard (H-1): every non-MALFORMED fixture must parse, and the
      // MALFORMED one must not. Checked before any sidecar file exists.
      let parseError = null;
      try { wrangler.experimental_readRawConfig({ config: file }); } catch (err) { parseError = err; }
      if (want === 'MALFORMED') {
        if (!parseError) { fail(`${label} -> fixture unexpectedly parses (a MALFORMED case must be a parse error)`); return; }
      } else if (parseError) {
        fail(`${label} -> fixture does not parse (${String(parseError.message).split('\n')[0]}); a parse error cannot stand in for ${want}`);
        return;
      } else {
        parsed++;
      }

      for (const [rel, body] of Object.entries(sidecars)) {
        const f = path.join(path.dirname(file), ...rel.split('/'));
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(f, body);
      }
      const res = checkStagingBindings(file);
      const wantCode = EXIT_FOR[want];
      const detailOk = !detail || (res.reason === 'MISMATCH' ? (res.problems || []) : res.lines).some((x) => x.includes(detail));
      const ok = res.reason === want && res.code === wantCode && detailOk;
      const summary = `${res.lines[0]}${res.lines[1] ? ' ' + res.lines[1].trim() : ''}`;
      if (ok) console.log(`self-test: ok   ${label} -> ${res.reason}/exit ${res.code} | ${summary}`);
      else fail(`${label} -> ${res.reason}/exit ${res.code} (expected ${want}/exit ${wantCode}${detail ? `, detail "${detail}"` : ''}) | ${summary}`);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const nonMalformed = cases.filter((c) => c[2] !== 'MALFORMED').length;
  if (parsed !== nonMalformed) fail(`only ${parsed}/${nonMalformed} non-MALFORMED fixtures parsed`);
  else console.log(`self-test: ok   all ${parsed} non-MALFORMED fixtures parse (no duplicate [env.preview])`);
  console.log(failures ? `self-test: FAILED (${failures} problem(s))` : `self-test: OK (${cases.length} cases)`);
  return failures === 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
  const configPath = path.resolve(args[0] || path.resolve(scriptDir, '..', 'wrangler.toml'));
  const { code, reason, lines } = checkStagingBindings(configPath);
  for (const l of lines) (code === 0 ? console.log : console.error)(l);
  (code === 0 ? console.log : console.error)(`REASON: ${reason}`);
  process.exit(code);
}
