import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendTelegramMessage } from '../lib/telegram.js';

describe('sendTelegramMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the given text to the Telegram sendMessage API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTelegramMessage({ TELEGRAM_BOT_TOKEN: 'test-token' }, { chatId: '123', text: 'Xin chào' });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    const body = JSON.parse(options.body);
    expect(body).toEqual({ chat_id: '123', text: 'Xin chào', parse_mode: 'Markdown' });
  });

  it('returns false and does not throw when the Telegram API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));
    const result = await sendTelegramMessage({ TELEGRAM_BOT_TOKEN: 'x' }, { chatId: '1', text: 't' });
    expect(result).toBe(false);
  });
});
