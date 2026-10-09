// Deterministic paths and SHA256 only: no OS paths, mtimes or platform metadata.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

function entries(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const name = prefix + e.name;
    if (e.isDirectory()) return entries(path.join(dir, e.name), name + '/');
    assert.ok(e.isFile(), 'Unexpected non-file: ' + name);
    const bytes = readFileSync(path.join(dir, e.name));
    return [{ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
const [mode, ...args] = process.argv.slice(2);
if (mode === 'write' && args.length === 2) {
  const files = entries(args[0]);
  writeFileSync(args[1], JSON.stringify(files, null, 2) + '\n');
  console.log(`Manifest: ${files.length} files`);
} else if (mode === 'compare' && args.length === 2) {
  const first = JSON.parse(readFileSync(args[0], 'utf8'));
  const second = JSON.parse(readFileSync(args[1], 'utf8'));
  assert.ok(first.length > 0, 'Empty artifact manifest');
  assert.deepEqual(second, first, 'Artifact paths/sizes/SHA256 differ');
  console.log(`Artifact equality: ${first.length}/${first.length} files`);
} else {
  throw new Error('Usage: artifact-manifest.mjs write <dist> <json> | compare <first.json> <second.json>');
}
