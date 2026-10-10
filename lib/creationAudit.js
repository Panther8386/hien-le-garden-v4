// Both statements execute in one D1 transaction. last_insert_rowid() belongs
// to this batch/connection; never query a global MAX(id) across requests.
const TYPES = {
  booking: { action: 'booking_create', label: 'Booking #' },
  staff_account: { action: 'account_create', label: 'Tài khoản #' },
};

export async function insertWithCreationAudit(db, insert, type, actor, timestamp, summary) {
  const config = TYPES[type];
  if (!config) throw new Error('Unknown creation audit type');
  const results = await db.batch([
    insert,
    db.prepare(`INSERT INTO audit_log(action_type,entity_type,entity_id,entity_label,old_value,new_value,actor,created_at)
      VALUES(?,?,last_insert_rowid(),? || last_insert_rowid(),NULL,?,?,?)`)
      .bind(config.action, type, config.label, JSON.stringify(summary), actor, timestamp),
  ]);
  return results[0].results[0].id;
}
