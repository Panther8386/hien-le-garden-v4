// Public, unauthenticated config for the static site. Only values that are
// safe to expose belong here (the Turnstile SITE key is public by design).
export async function onRequestGet({ env }) {
  const siteKey = typeof env.TURNSTILE_SITE_KEY === 'string' && env.TURNSTILE_SITE_KEY !== '' ? env.TURNSTILE_SITE_KEY : null;
  return new Response(JSON.stringify({ turnstileSiteKey: siteKey }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
