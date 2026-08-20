import { escapeHtml } from './email.js';
import { escapeMarkdown } from './telegram.js';

const GIFT_LINE_HTML = '<p>Mang mã này đến quầy lễ tân — nếu quà lưu niệm vẫn còn, bạn sẽ được nhận thêm nhé!</p>';
const GIFT_LINE_TELEGRAM = '\n🎁 Mang mã này đến quầy lễ tân — nếu quà lưu niệm vẫn còn, bạn sẽ được nhận thêm nhé!';

function formatDate(date) {
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function renderTemplate(template, vars) {
  const isEmail = template.channel === 'email';
  const escape = isEmail ? escapeHtml : escapeMarkdown;

  const values = {
    guestName: escape(vars.guestName),
    promoCode: escape(vars.promoCode),
    discountPercent: String(vars.discountPercent),
    expiresAt: formatDate(vars.expiresAt),
    giftLine: vars.giftOffered ? (isEmail ? GIFT_LINE_HTML : GIFT_LINE_TELEGRAM) : '',
  };

  const substitute = (str) => str.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));

  return {
    subject: isEmail ? substitute(template.subject || '') : undefined,
    body: substitute(template.body),
  };
}
