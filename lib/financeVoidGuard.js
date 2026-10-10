// Used in both the preflight and the guarded write: a new link cannot race the check.
export const blockedFinanceLinks = `
  finance_transactions.checkout_booking_id IS NOT NULL
  OR EXISTS (SELECT 1 FROM audit_log a WHERE a.action_type = 'booking_checkout'
    AND a.entity_type = 'booking' AND a.actor = finance_transactions.created_by
    AND a.created_at = finance_transactions.created_at
    AND CASE WHEN json_valid(a.new_value) THEN (
      (finance_transactions.type = 'income' AND finance_transactions.category = 'dich_vu'
        AND finance_transactions.note = 'Tiền phòng — ' || a.entity_label
        AND finance_transactions.amount = json_extract(a.new_value, '$.roomDue'))
      OR (finance_transactions.type = 'income' AND finance_transactions.category = 'ban_hang'
        AND finance_transactions.note = 'Dịch vụ lưu trú — ' || a.entity_label
        AND finance_transactions.amount = json_extract(a.new_value, '$.servicesDue'))
      OR (finance_transactions.type = 'expense' AND finance_transactions.category = 'hoan_coc'
        AND finance_transactions.note = 'Hoàn cọc dư — ' || a.entity_label
        AND finance_transactions.amount = json_extract(a.new_value, '$.refundAmount'))
    ) ELSE 0 END)
  OR EXISTS (SELECT 1 FROM dine_in_orders WHERE finance_transaction_id = finance_transactions.id)
  OR EXISTS (SELECT 1 FROM gio_xanh_sessions WHERE finance_transaction_id = finance_transactions.id)
  OR EXISTS (SELECT 1 FROM booking_service_items WHERE finance_transaction_id = finance_transactions.id)
  OR EXISTS (SELECT 1 FROM bookings WHERE refund_finance_transaction_id = finance_transactions.id)
  OR EXISTS (SELECT 1 FROM booking_deposits d JOIN bookings b ON b.id = d.booking_id
    WHERE d.finance_transaction_id = finance_transactions.id
      AND (b.status <> 'cancelled' OR b.refund_finance_transaction_id IS NOT NULL))`;

export const cancelledDepositLink = `EXISTS (
  SELECT 1 FROM booking_deposits d JOIN bookings b ON b.id = d.booking_id
  WHERE d.finance_transaction_id = finance_transactions.id AND d.voided_at IS NULL
    AND b.status = 'cancelled' AND b.refund_finance_transaction_id IS NULL)`;
