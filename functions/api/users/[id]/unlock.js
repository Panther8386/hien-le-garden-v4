import { requireAuth } from '../../../../lib/requireAuth.js';
import { loadTarget, guardTarget, guardAdminLock } from '../../../../lib/staffGuards.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;
  const target = await loadTarget(env.DB, params.id);
  const denied = guardTarget(auth, target);
  if (denied) return denied;
  if (!target.lockedAt) return json({ error: 'Tài khoản không bị khoá' }, 400);
  const adminLocked = await guardAdminLock(env.DB, auth, target.id);
  if (adminLocked) return adminLocked;

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE staff_accounts SET locked_at = NULL, locked_by = NULL WHERE id = ?').bind(target.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('account_unlock', 'staff_account', ?, ?, 'Đã khoá', 'Đang hoạt động', ?, ?)`
    ).bind(target.id, target.username, auth.username, now),
  ]);
  return json({ ok: true });
}
