// Xác thực webhook Telegram bằng cơ chế chính thức của Bot API: khi gọi
// setWebhook với `secret_token`, Telegram gửi kèm header
// X-Telegram-Bot-Api-Secret-Token trong mọi update.

export const TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

const encoder = new TextEncoder();

// So sánh hai chuỗi trong thời gian không phụ thuộc vào vị trí ký tự khác nhau
// đầu tiên: luôn duyệt hết max(độ dài) byte, gộp mọi khác biệt (kể cả khác độ
// dài) vào một biến rồi mới kết luận. Chỉ độ dài có thể lộ qua thời gian chạy.
// Chuỗi rỗng / không phải chuỗi luôn trả false (fail closed).
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) {
    diff |= (i < x.length ? x[i] : 0) ^ (i < y.length ? y[i] : 0);
  }
  return diff === 0 && len > 0;
}

// true chỉ khi env.TELEGRAM_WEBHOOK_SECRET có giá trị và header khớp đúng.
// Không đọc body, không log gì.
export function isAuthorizedTelegramWebhook(request, env) {
  const expected = env && env.TELEGRAM_WEBHOOK_SECRET;
  if (typeof expected !== 'string' || expected.length === 0) return false;
  const provided = request.headers.get(TELEGRAM_SECRET_HEADER);
  if (provided === null) return false;
  return constantTimeEqual(provided, expected);
}
