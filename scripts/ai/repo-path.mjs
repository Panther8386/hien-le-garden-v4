// Common repository path policy, layer L0 (lexical) — ADR-AI-010.
//
// Pure and deterministic: no filesystem, Git, network, environment, platform or working-directory
// access, and no imports. The same string gives the same result on every OS.
//
// Accept/reject only: a path is never trimmed, lower-cased or otherwise rewritten. Callers get
// the list of violated rules; an empty list means the path passes L0. Rules:
//
//   PATH-GRAMMAR       The V1 contract grammar (RepoFilePath, or ScopePath when `directory`
//                      is allowed): 1-240 characters of [A-Za-z0-9_.-] in "/"-separated
//                      segments, no leading slash, no empty, "." or ".." segment. The patterns
//                      below must stay identical to common.schema.json (a test checks this).
//   PATH-TRAILING-DOT  A segment ends in "." (Windows strips trailing dots, so it would alias
//                      another path).
//   PATH-DEVICE-NAME   A segment whose stem (text before the first ".") is a Windows reserved
//                      device name, case-insensitively, with or without an extension:
//                      CON, PRN, AUX, NUL, COM0-COM9, LPT0-LPT9.
//   PATH-GIT-SEGMENT   A segment equal to ".git", case-insensitively, at any depth.
//   PATH-LEADING-DASH  A segment starting with "-" (option injection). Process invocations must
//                      still pass paths as argv after "--".
//
// Case ambiguity with protected paths depends on the protected registry and is checked there
// (taskspec-policy-registry.mjs), not here.

export const REPO_PATH_MAX_LENGTH = 240;
export const REPO_FILE_PATH_PATTERN = '^(?!.*(?:^|/)\\.{1,2}(?:/|$))[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$';
export const SCOPE_PATH_PATTERN = '^(?!.*(?:^|/)\\.{1,2}(?:/|$))[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*/?$';

const FILE_PATH = new RegExp(REPO_FILE_PATH_PATTERN);
const SCOPE_PATH = new RegExp(SCOPE_PATH_PATTERN);
const DEVICE_STEM = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;

// Returns the sorted list of violated L0 rules (empty when the path passes). `directory: true`
// accepts the ScopePath form, where one trailing "/" marks a directory prefix.
export function repoPathViolations(path, { directory = false } = {}) {
  if (typeof path !== 'string') throw new TypeError('repoPathViolations: path must be a string');
  const pattern = directory ? SCOPE_PATH : FILE_PATH;
  if (path.length < 1 || path.length > REPO_PATH_MAX_LENGTH || !pattern.test(path)) {
    return ['PATH-GRAMMAR'];
  }
  const body = directory && path.endsWith('/') ? path.slice(0, -1) : path;
  const found = new Set();
  for (const segment of body.split('/')) {
    if (segment.endsWith('.')) found.add('PATH-TRAILING-DOT');
    if (DEVICE_STEM.test(segment.split('.')[0])) found.add('PATH-DEVICE-NAME');
    if (segment.toLowerCase() === '.git') found.add('PATH-GIT-SEGMENT');
    if (segment.startsWith('-')) found.add('PATH-LEADING-DASH');
  }
  return [...found].sort();
}

export function isSafeRepoPath(path, options) {
  return repoPathViolations(path, options).length === 0;
}
