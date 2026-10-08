// Derive display state from the linked receipt; never mutate orders or finance.
export function withDineInPaymentStatus(order) {
  const { receiptType, receiptAmount, receiptStatus, ...visible } = order;
  if (order.status !== 'closed') return visible;
  const paid = receiptType === 'income' && ['confirmed', 'paid'].includes(receiptStatus)
    && receiptAmount === order.totalAmount && ['cash', 'transfer'].includes(order.paymentMethod);
  return { ...visible, paymentStatus: paid ? 'paid' : 'needs_review' };
}
