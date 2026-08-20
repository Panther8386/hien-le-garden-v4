import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../lib/templates.js';

const baseVars = {
  guestName: 'Nguyễn Văn A',
  promoCode: 'HLG-4F7K9P',
  discountPercent: 15,
  expiresAt: new Date('2027-02-19T00:00:00Z'),
  giftOffered: false,
};

describe('renderTemplate', () => {
  it('substitutes variables into an email template and renders a subject', () => {
    const result = renderTemplate(
      { channel: 'email', subject: 'Chào {guestName}', body: 'Mã của bạn: {promoCode}, giảm {discountPercent}%, hết hạn {expiresAt}' },
      baseVars
    );
    expect(result.subject).toBe('Chào Nguyễn Văn A');
    expect(result.body).toBe('Mã của bạn: HLG-4F7K9P, giảm 15%, hết hạn 19/02/2027');
  });

  it('escapes HTML in guestName and promoCode for the email channel', () => {
    const result = renderTemplate(
      { channel: 'email', subject: 'x', body: '{guestName} {promoCode}' },
      { ...baseVars, guestName: '<script>alert(1)</script>', promoCode: '"><img src=x onerror=alert(2)>' }
    );
    expect(result.body).not.toContain('<script>alert(1)</script>');
    expect(result.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.body).not.toContain('<img src=x onerror=alert(2)>');
  });

  it('escapes Markdown special characters for the telegram channel and never renders a subject', () => {
    const result = renderTemplate(
      { channel: 'telegram', subject: null, body: 'Xin chào {guestName}, mã: {promoCode}' },
      { ...baseVars, guestName: 'A_B*C', promoCode: 'HLG-[X]' }
    );
    expect(result.subject).toBeUndefined();
    expect(result.body).toBe('Xin chào A\\_B\\*C, mã: HLG-\\[X]');
  });

  it('renders an empty giftLine when giftOffered is false', () => {
    const result = renderTemplate({ channel: 'email', subject: '', body: 'x{giftLine}y' }, { ...baseVars, giftOffered: false });
    expect(result.body).toBe('xy');
  });

  it('renders the gift sentence when giftOffered is true, HTML for email', () => {
    const result = renderTemplate({ channel: 'email', subject: '', body: '{giftLine}' }, { ...baseVars, giftOffered: true });
    expect(result.body).toContain('<p>Mang mã này đến quầy lễ tân');
  });

  it('renders the gift sentence when giftOffered is true, plain text with emoji for telegram', () => {
    const result = renderTemplate({ channel: 'telegram', subject: null, body: '{giftLine}' }, { ...baseVars, giftOffered: true });
    expect(result.body).toContain('🎁 Mang mã này đến quầy lễ tân');
  });

  it('leaves an unknown placeholder as literal text instead of stripping it', () => {
    const result = renderTemplate({ channel: 'email', subject: '', body: 'x{notAVariable}y' }, baseVars);
    expect(result.body).toBe('x{notAVariable}y');
  });
});
