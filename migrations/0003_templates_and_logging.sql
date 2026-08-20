CREATE TABLE message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'telegram')),
  subject TEXT,
  body TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_templates_channel_active ON message_templates(channel, is_active);

CREATE TABLE message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id TEXT NOT NULL,
  template_id INTEGER,
  channel TEXT NOT NULL,
  sent_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error TEXT,
  sent_at TEXT NOT NULL
);

CREATE INDEX idx_message_log_feedback ON message_log(feedback_id);

INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at)
VALUES (
  'Email mặc định',
  'email',
  'Mã ưu đãi từ Hiền Lê Garden Farmstay',
  '<div style="font-family: ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background:#0D1F14; color:#F5F0E6; padding:32px; max-width:480px; margin:0 auto;"><h1 style="color:#C9A84C; font-size:22px;">Hiền Lê Garden Farmstay</h1><p>Xin chào {guestName},</p><p>Cảm ơn bạn đã chia sẻ trải nghiệm tại Hiền Lê Garden. Đây là mã ưu đãi dành riêng cho bạn:</p><p style="font-size:28px; letter-spacing:2px; color:#C9A84C; font-weight:bold;">{promoCode}</p><p>Giảm <strong>{discountPercent}%</strong> cho lần sử dụng dịch vụ tiếp theo, có hiệu lực đến <strong>{expiresAt}</strong>.</p>{giftLine}<p>Hẹn gặp lại bạn tại Hiền Lê Garden!</p></div>',
  1,
  'system',
  '2026-08-20T00:00:00Z'
);

INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at)
VALUES (
  'Telegram mặc định',
  'telegram',
  NULL,
  '🌿 *Hiền Lê Garden Farmstay*

Xin chào {guestName}, cảm ơn bạn đã chia sẻ trải nghiệm!

Mã ưu đãi của bạn: *{promoCode}*
Giảm *{discountPercent}%* cho lần sau, có hiệu lực đến *{expiresAt}*.{giftLine}',
  1,
  'system',
  '2026-08-20T00:00:00Z'
);
