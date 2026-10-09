// Identifiers are selected only from this server-owned allowlist.
const SALES = {
  dine_in: { parent: 'dine_in_orders', items: 'dine_in_order_items', key: 'order_id', entity: 'dine_in_order', category: 'khach_vang_lai' },
  gio_xanh: { parent: 'gio_xanh_sessions', items: 'gio_xanh_session_items', key: 'session_id', entity: 'gio_xanh_session', category: 'gio_xanh_hien_le' },
};

export async function atomicSaleClose(db, { kind, id, total, count, label, note, actor, now, paymentMethod }) {
  const sale = SALES[kind];
  if (!sale) throw new Error('Unknown settlement kind');
  const settlement = JSON.stringify({ key: crypto.randomUUID(), total, paymentMethod });
  const gate = `EXISTS (SELECT 1 FROM audit_log WHERE action_type = 'sale_close'
    AND entity_type = ? AND entity_id = ? AND new_value = ?)`;
  // The audit entry authorizes only this request, and only while the amount and
  // parent state still match. All three statements commit or roll back together.
  const results = await db.batch([
    db.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
      SELECT 'sale_close', ?, ?, ?, 'open', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM ${sale.parent} WHERE id = ? AND status = 'open')
        AND (SELECT COALESCE(SUM(amount), 0) FROM ${sale.items} WHERE ${sale.key} = ? AND status = 'posted') = ?
        AND (SELECT COUNT(*) FROM ${sale.items} WHERE ${sale.key} = ? AND status = 'posted') = ?`)
      .bind(sale.entity, id, label, settlement, actor, now, id, id, total, id, count),
    db.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
      SELECT 'income', ?, ?, ?, ?, 'confirmed', ?, ? WHERE ${gate}`)
      .bind(sale.category, total, note, now.slice(0, 10), actor, now, sale.entity, id, settlement),
    // This immediately follows the receipt INSERT in the same SQLite transaction.
    // A lost gate cannot write the parent or use another request's receipt id.
    db.prepare(`UPDATE ${sale.parent} SET status = 'closed', closed_by = ?, closed_at = ?, payment_method = ?, total_amount = ?, finance_transaction_id = last_insert_rowid()
      WHERE id = ? AND status = 'open' AND ${gate}`)
      .bind(actor, now, paymentMethod, total, id, sale.entity, id, settlement),
  ]);
  return { closed: results[2].meta.changes === 1, financeTransactionId: results[1].meta.last_row_id };
}
