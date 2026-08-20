import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPromoEmail } from '../lib/email.js';

describe('sendPromoEmail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the Brevo API with the given recipient, subject, and HTML body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendPromoEmail(
      { BREVO_API_KEY: 'test-key' },
      { to: 'khach@example.com', toName: 'Nguyễn Văn A', subject: 'Mã ưu đãi', html: '<p>xin chào</p>' }
    );

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.headers['api-key']).toBe('test-key');
    const body = JSON.parse(options.body);
    expect(body.to).toEqual([{ email: 'khach@example.com', name: 'Nguyễn Văn A' }]);
    expect(body.subject).toBe('Mã ưu đãi');
    expect(body.htmlContent).toBe('<p>xin chào</p>');
  });

  it('returns false and does not throw when the Brevo API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));
    const result = await sendPromoEmail({ BREVO_API_KEY: 'test-key' }, { to: 'x@example.com', toName: 'X', subject: 's', html: 'h' });
    expect(result).toBe(false);
  });

  it('returns false and does not throw when fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await sendPromoEmail({ BREVO_API_KEY: 'test-key' }, { to: 'x@example.com', toName: 'X', subject: 's', html: 'h' });
    expect(result).toBe(false);
  });
});
