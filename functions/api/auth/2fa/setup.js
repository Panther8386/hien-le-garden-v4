import { requireAuth } from '../../../../lib/requireAuth.js';
import { generateSecret, buildOtpauthUrl } from '../../../../lib/totp.js';

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, null);
  if (auth instanceof Response) return auth;

  const secret = generateSecret();
  await env.DB.prepare(`UPDATE staff_accounts SET totp_secret = ? WHERE id = ?`).bind(secret, auth.staffId).run();

  const otpauthUrl = buildOtpauthUrl({
    secret,
    accountName: auth.username,
    issuer: 'Hiền Lê Garden CRM',
  });

  return new Response(JSON.stringify({ secret, otpauthUrl }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
