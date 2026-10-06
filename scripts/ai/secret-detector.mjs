// Shared high-confidence secret detector (ADR-AI-008 scope, ADR-AI-009 ownership).
//
// One implementation for every caller: TaskSpec policy (parsed strings) and, later, the
// TaskSpec composer's whole-Markdown scan. Conservative, high-confidence credential formats
// only (distinctive prefix + fixed structure): no PII, entropy or bare-word matching.
//
// Boolean only: never returns, logs or throws match material. Pure: no filesystem, network,
// environment or logging; strings are only read.
//
// Complexity: linear in the input length. The fixed-length patterns are bounded per attempt.
// The variable-length patterns (fine-grained GitHub token, Authorization header, PEM header)
// start only at a literal prefix and stop at a character outside their class, so attempts do
// not rescan each other's input. The `sk-` rule is a prefix search plus a single token-run scan
// (hasSkKey), replacing a regex whose lookaheads rescanned one long run for every embedded
// `sk-` (quadratic, finding F3).

// Built from fragments so this source file contains no credential-shaped literal.
const DASH5 = '-'.repeat(5);
const TOKEN_CHARS = 'A-Za-z0-9._~+/-';
const PATTERNS = [
  // PEM private key header (any key type).
  new RegExp(`${DASH5}BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY${DASH5}`),
  // GitHub classic tokens (ghp_, gho_, ghu_, ghs_, ghr_ + 36 alphanumerics).
  new RegExp('(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36}(?![A-Za-z0-9])'),
  // GitHub fine-grained personal access tokens.
  new RegExp('(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{80,}'),
  // Brevo API / SMTP keys (BREVO_API_KEY, lib/email.js).
  new RegExp('(?<![A-Za-z0-9_])x(?:key|smtp)sib-[0-9a-f]{64}-[A-Za-z0-9]{16}(?![A-Za-z0-9])'),
  // Telegram bot token (TELEGRAM_BOT_TOKEN).
  new RegExp('(?<![0-9])[0-9]{8,10}:AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])'),
  // Authorization header carrying a credential value (needs a digit and a letter).
  new RegExp(
    `Authorization:[ \\t]*Bearer[ \\t]+(?=[${TOKEN_CHARS}]*[0-9])(?=[${TOKEN_CHARS}]*[A-Za-z])[${TOKEN_CHARS}]{20,}`,
    'i',
  ),
];

// ---- OpenAI / Anthropic style secret keys: `sk-` + a token run of [A-Za-z0-9_-] that is at
// least 40 characters long and contains a digit and an uppercase letter. The `sk-` must not
// follow [A-Za-z0-9_]. Same observable result as the former regex
//   (?<![A-Za-z0-9_])sk-(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{40,}

const SK_PREFIX = 'sk-';
const SK_MIN_RUN = 40;

function isWordChar(c) {
  // [A-Za-z0-9_]
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;
}

function isSkRunChar(c) {
  // [A-Za-z0-9_-]
  return isWordChar(c) || c === 45;
}

// Linear: indexOf only moves forward, and each token run is scanned at most once. After a
// candidate with a valid boundary fails, every other `sk-` inside the same run starts later
// in that run, so its remainder is a suffix of the remainder just scanned: shorter, with a
// subset of its digits and uppercase letters. It cannot succeed, so the search resumes at the
// end of the run.
function hasSkKey(text) {
  let from = 0;
  for (;;) {
    const start = text.indexOf(SK_PREFIX, from);
    if (start === -1) return false;
    if (start > 0 && isWordChar(text.charCodeAt(start - 1))) {
      from = start + 1;
      continue;
    }
    let end = start + SK_PREFIX.length;
    let hasDigit = false;
    let hasUpper = false;
    while (end < text.length) {
      const c = text.charCodeAt(end);
      if (!isSkRunChar(c)) break;
      if (c >= 48 && c <= 57) hasDigit = true;
      else if (c >= 65 && c <= 90) hasUpper = true;
      end++;
    }
    if (end - (start + SK_PREFIX.length) >= SK_MIN_RUN && hasDigit && hasUpper) return true;
    from = end;
  }
}

// Boolean only: never returns match material.
export function containsHighConfidenceSecret(text) {
  if (typeof text !== 'string') throw new TypeError('containsHighConfidenceSecret: text must be a string');
  return PATTERNS.some((re) => re.test(text)) || hasSkKey(text);
}
