// Reconcile display state only; never repair a session or financial record on GET.
export function withGioXanhPaymentStatus(session) {
  const { receiptId, receiptType, receiptCategory, receiptAmount, receiptStatus, receiptVoidedAt, ...visible } = session;
  if (session.status !== 'closed') return visible;
  const issues = [];
  if (receiptId == null) issues.push('Không tìm thấy chứng từ thu liên kết.');
  else {
    if (receiptVoidedAt) issues.push('Chứng từ thu đã bị huỷ.');
    if (receiptType !== 'income') issues.push('Chứng từ liên kết không phải khoản thu.');
    if (receiptCategory !== 'gio_xanh_hien_le') issues.push('Chứng từ không thuộc Giờ Xanh Hiền Lê.');
    if (!['confirmed', 'paid'].includes(receiptStatus)) issues.push('Chứng từ thu chưa được xác nhận.');
    if (receiptAmount !== session.totalAmount) issues.push('Số tiền chứng từ khác số tiền đã chốt.');
  }
  if (session.currentTotal !== session.totalAmount) issues.push('Tổng dịch vụ hiện tại khác số tiền đã chốt.');
  if (!['cash', 'transfer'].includes(session.paymentMethod)) issues.push('Thiếu hình thức thanh toán hợp lệ.');
  return {
    ...visible,
    paymentStatus: issues.length ? 'needs_review' : 'paid',
    paymentReviewNote: issues.join(' '),
  };
}
