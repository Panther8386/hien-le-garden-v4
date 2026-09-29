// Chạy từng file Vitest riêng, chỉ chạy lại một file khi gặp crash hạ tầng
// Windows (không có dòng "failed" — xem scripts/test-with-retry.js). Lỗi
// assertion thật báo ngay. Dùng: npm run test:each [-- test/a.test.js ...]
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const MAX_ATTEMPTS = 15;
const REAL_FAILURE = /(Tests|Test Files)\s+\d+\s+failed/;
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);

const counts = { pass: 0, fail: 0, crash: 0 };
for (const file of files) {
  let outcome = 'crash';
  let detail = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = spawnSync('npx', ['vitest', 'run', file], { shell: true, encoding: 'utf8' });
    const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
    if (REAL_FAILURE.test(out)) {
      outcome = 'fail';
      detail = '\n' + out.split('\n').filter((l) => /FAIL|×|AssertionError|Error:/.test(l)).slice(0, 15).join('\n');
      break;
    }
    if (r.status === 0 && /Tests\s+\d+\s+passed/.test(out)) {
      outcome = 'pass';
      detail = `(${out.match(/Tests\s+(\d+)\s+passed/)[1]} tests, attempt ${attempt})`;
      break;
    }
  }
  counts[outcome]++;
  console.log(`${outcome.toUpperCase()} ${file} ${detail}`);
}
console.log(`\nSUMMARY pass=${counts.pass} fail=${counts.fail} crash=${counts.crash} total=${files.length}`);
process.exit(counts.fail || counts.crash ? 1 : 0);
