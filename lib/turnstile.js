// Cloudflare Turnstile server-side verification for public forms.
// Fails closed: anything other than a definite `success: true` from
// siteverify whose `hostname` is in TURNSTILE_ALLOWED_HOSTNAMES returns false.
// Never logs the secret or the token.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MAX_TOKEN_LENGTH = 2048;

// Response hostname (from siteverify). ASCII-only BEFORE any normalization, so
// Unicode case folding can never map a foreign code point onto an allowed name
// (e.g. KELVIN SIGN U+212A lowercases to "k"). Nothing is trimmed: whitespace,
// control characters, non-ASCII, ":", "/", "," etc. are rejected, not cleaned.
// Punycode ("xn--...") is plain ASCII and only matches an identical entry.
// After the check: ASCII lowercase + removal of ONE trailing dot (FQDN form).
const RESPONSE_HOSTNAME_RE = /^[A-Za-z0-9.-]+$/;

function normalizeResponseHostname(value) {
  if (typeof value !== 'string' || !RESPONSE_HOSTNAME_RE.test(value)) return null;
  return value.toLowerCase().replace(/\.$/, '');
}

// Entries that are never a valid allowlist value, even though they are
// structurally hostnames: shared-hosting public suffixes (any tenant can get a
// subdomain there) and local/tunnel names. Minimal and explicit on purpose —
// this is NOT a Public Suffix List.
export const DENIED_HOSTNAMES = new Set(['pages.dev', 'workers.dev', 'localhost', 'trycloudflare.com']);

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isValidAllowlistEntry(h) {
  if (h.length === 0 || h.length > 253) return false;
  if (DENIED_HOSTNAMES.has(h)) return false;
  const labels = h.split('.');
  if (labels.length < 2) return false; // rejects "localhost", "-", single labels
  if (!labels.every((l) => LABEL_RE.test(l))) return false; // empty label, leading/trailing "-", >63, non [a-z0-9-]
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return false; // IP literal such as 1.2.3.4
  return true;
}

// TURNSTILE_ALLOWED_HOSTNAMES: comma-separated exact hostnames (no scheme,
// port, path or wildcard), e.g. "hienlegarden.vn" or
// "staging.hien-le-garden-v4.pages.dev". Set per Pages environment.
// Each entry is trimmed, must be ASCII, is lowercased and may carry ONE
// trailing dot. Fails closed: returns null (callers return 403 without calling
// siteverify) when the value is unset/blank or when ANY entry is invalid —
// including empty entries ("a,,b", a trailing comma), a single label
// ("localhost"), a label starting/ending with "-", an IP literal, a denied
// shared suffix (pages.dev, workers.dev, trycloudflare.com), or > 253 chars.
export function parseAllowedHostnames(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const hosts = [];
  for (const entry of raw.split(',')) {
    const t = entry.trim();
    if (!/^[A-Za-z0-9.-]+$/.test(t)) return null; // empty entry or non-ASCII / forbidden char
    const h = t.toLowerCase().replace(/\.$/, '');
    if (!isValidAllowlistEntry(h)) return null;
    hosts.push(h);
  }
  return new Set(hosts);
}

export async function verifyTurnstile(env, token, remoteIp, { expectedHostname, expectedAction } = {}) {
  const secret = env && env.TURNSTILE_SECRET_KEY;
  if (typeof secret !== 'string' || secret === '') return false;
  if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH) return false;
  // Checked before siteverify so a misconfiguration does not consume the token.
  const allowedHostnames = parseAllowedHostnames(env.TURNSTILE_ALLOWED_HOSTNAMES);
  if (!allowedHostnames) {
    console.error('Turnstile misconfigured: TURNSTILE_ALLOWED_HOSTNAMES missing or invalid');
    return false;
  }

  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (typeof remoteIp === 'string' && remoteIp !== '' && remoteIp.length <= 64) {
    form.set('remoteip', remoteIp);
  }

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.error('Turnstile siteverify HTTP error', response.status);
      return false;
    }
    const data = await response.json();
    if (!data || typeof data !== 'object' || data.success !== true) {
      const codes = data && Array.isArray(data['error-codes']) ? data['error-codes'].filter((c) => typeof c === 'string') : [];
      console.error('Turnstile rejected', codes.join(',').slice(0, 200));
      return false;
    }
    const hostname = normalizeResponseHostname(data.hostname);
    if (hostname === null || !allowedHostnames.has(hostname)) {
      console.error('Turnstile hostname not allowed', typeof data.hostname === 'string' ? data.hostname.slice(0, 253) : typeof data.hostname);
      return false;
    }
    if (expectedHostname !== undefined && hostname !== normalizeResponseHostname(expectedHostname)) return false;
    if (expectedAction !== undefined && data.action !== expectedAction) return false;
    return true;
  } catch (err) {
    console.error('Turnstile siteverify failed', err && err.name);
    return false;
  }
}
