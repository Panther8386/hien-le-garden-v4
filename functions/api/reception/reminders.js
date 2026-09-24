import { requireAuth } from '../../../lib/requireAuth.js';
import { getReminders } from '../../../lib/receptionReminders.js';
import { redactContact } from '../../../lib/redactContact.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, 'bookings.view');
  if (auth instanceof Response) return auth;

  const result = await getReminders(env);
  redactContact(auth, result.pendingNoDeposit);
  redactContact(auth, result.arrivingToday);
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
