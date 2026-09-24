export async function setOverride(db, staffId, permission, effect = 'grant') {
  await db.prepare(
    `INSERT INTO user_permission_overrides (staff_id, permission, effect) VALUES (?, ?, ?)
     ON CONFLICT (staff_id, permission) DO UPDATE SET effect = excluded.effect`
  ).bind(staffId, permission, effect).run();
}

export async function setRolePermissions(db, role, permissions) {
  await db.prepare('DELETE FROM role_permissions WHERE role = ?').bind(role).run();
  for (const p of permissions) {
    await db.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)').bind(role, p).run();
  }
}
