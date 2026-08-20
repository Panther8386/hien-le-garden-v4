// @cloudflare/vitest-pool-workers has known Windows-only infra crashes unrelated
// to any test's own assertions: a SQLite WAL temp-file race while tearing down
// its isolated D1 storage snapshot, and workerd's Node-compat layer occasionally
// misresolving vitest's bare `vite-node/client` import as a relative path
// (`./vite-node/client`) that doesn't exist on disk. Neither ever reports a real
// "N failed" test — only a crash before or during the run, with an "Errors"
// count instead. Both are local-machine-only: GitHub Actions CI runs on Linux,
// where these don't occur, and the deploy workflow doesn't run this test suite
// anyway. Retry on any crash EXCEPT a genuine assertion failure (a real
// "N failed" test), which always surfaces immediately with no retry.
import { spawnSync } from 'node:child_process';

const MAX_ATTEMPTS = 40;
const RETRY_DELAY_MS = 1500;
const REAL_FAILURE_PATTERN = /Tests\s+\d+\s+failed/;

function sleep(ms) {
  spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', [process.platform === 'win32' ? String(Math.ceil(ms / 1000)) : String(ms / 1000)], { shell: true, stdio: 'ignore' });
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const result = spawnSync('npx', ['vitest', 'run'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
    encoding: 'utf8',
  });

  const output = (result.stdout || '') + (result.stderr || '');
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  if (result.status === 0) {
    process.exit(0);
  }

  if (REAL_FAILURE_PATTERN.test(output)) {
    process.exit(result.status ?? 1);
  }

  console.error(`\n[test-with-retry] Known Windows-only infra crash (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying...\n`);
  if (attempt < MAX_ATTEMPTS) sleep(RETRY_DELAY_MS);
}

console.error(`\n[test-with-retry] Still hitting the infra flake after ${MAX_ATTEMPTS} attempts — giving up.\n`);
process.exit(1);
