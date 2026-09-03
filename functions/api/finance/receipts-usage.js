// functions/api/finance/receipts-usage.js
import { requireAuth } from '../../../lib/requireAuth.js';

const THRESHOLD_BYTES = 9 * 1024 * 1024 * 1024; // 9GB — warn before the 10GB R2 free-tier storage limit

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  let totalBytes = 0;
  let cursor;
  do {
    const page = await env.RECEIPTS.list(cursor ? { cursor } : {});
    for (const obj of page.objects) totalBytes += obj.size;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return new Response(
    JSON.stringify({ totalBytes, thresholdBytes: THRESHOLD_BYTES, overThreshold: totalBytes > THRESHOLD_BYTES }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
