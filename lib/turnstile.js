// Cloudflare Turnstile server-side verification for public forms.
// Fails closed: anything other than a definite `success: true` from
// siteverify returns false. Never logs the secret or the token.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MAX_TOKEN_LENGTH = 2048;

export async function verifyTurnstile(env, token, remoteIp) {
  const secret = env && env.TURNSTILE_SECRET_KEY;
  if (typeof secret !== 'string' || secret === '') return false;
  if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH) return false;

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
    return !!data && data.success === true;
  } catch (err) {
    console.error('Turnstile siteverify failed', err && err.name);
    return false;
  }
}
