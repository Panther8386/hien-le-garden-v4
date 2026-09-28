// Cloudflare Turnstile server-side verification for public forms.
// Fails closed: anything other than a definite `success: true` from
// siteverify whose `hostname` is in TURNSTILE_ALLOWED_HOSTNAMES returns false.
// Never logs the secret or the token.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MAX_TOKEN_LENGTH = 2048;

function normalizeHostname(value) {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

// TURNSTILE_ALLOWED_HOSTNAMES: comma-separated exact hostnames (no scheme,
// port, path or wildcard), e.g. "hienlegarden.vn" or
// "staging.hien-le-garden-v4.pages.dev". Set per Pages environment.
// Returns null when unset/empty/invalid — callers must fail closed.
export function parseAllowedHostnames(raw) {
  if (typeof raw !== 'string') return null;
  const hosts = raw.split(',').map(normalizeHostname).filter((h) => h !== '');
  if (hosts.length === 0) return null;
  if (hosts.some((h) => !/^[a-z0-9.-]+$/.test(h) || h.startsWith('.') || h.includes('..'))) return null;
  return new Set(hosts);
}

export async function verifyTurnstile(env, token, remoteIp) {
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
    if (typeof data.hostname !== 'string' || !allowedHostnames.has(normalizeHostname(data.hostname))) {
      console.error('Turnstile hostname not allowed', typeof data.hostname === 'string' ? data.hostname.slice(0, 253) : typeof data.hostname);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Turnstile siteverify failed', err && err.name);
    return false;
  }
}
