import { describe, it, expect } from 'vitest';
import { constantTimeEqual, isAuthorizedTelegramWebhook } from '../lib/telegramWebhookAuth.js';

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('test-secret', 'test-secret')).toBe(true);
  });

  it('returns false for unequal strings of the same length', () => {
    expect(constantTimeEqual('test-secret', 'test-secreT')).toBe(false);
    expect(constantTimeEqual('aaaaaaaaaaa', 'baaaaaaaaaa')).toBe(false);
  });

  it('returns false for strings of different lengths (including prefixes)', () => {
    expect(constantTimeEqual('test-secret', 'test-secret-longer')).toBe(false);
    expect(constantTimeEqual('test-secret-longer', 'test-secret')).toBe(false);
    expect(constantTimeEqual('test', 'test-secret')).toBe(false);
  });

  it('returns false for empty or non-string input', () => {
    expect(constantTimeEqual('', '')).toBe(false);
    expect(constantTimeEqual('', 'test-secret')).toBe(false);
    expect(constantTimeEqual('test-secret', '')).toBe(false);
    expect(constantTimeEqual(undefined, 'test-secret')).toBe(false);
    expect(constantTimeEqual('test-secret', undefined)).toBe(false);
    expect(constantTimeEqual(undefined, undefined)).toBe(false);
    expect(constantTimeEqual(null, null)).toBe(false);
  });

  it('compares multi-byte characters by their UTF-8 bytes', () => {
    expect(constantTimeEqual('bí-mật', 'bí-mật')).toBe(true);
    expect(constantTimeEqual('bí-mật', 'bi-mat')).toBe(false);
  });
});

describe('isAuthorizedTelegramWebhook', () => {
  const req = (headers) => new Request('https://x/api/telegram/webhook', { method: 'POST', headers });

  it('accepts the correct secret header', () => {
    expect(isAuthorizedTelegramWebhook(req({ 'X-Telegram-Bot-Api-Secret-Token': 'test-secret' }), { TELEGRAM_WEBHOOK_SECRET: 'test-secret' })).toBe(true);
  });

  it('rejects a missing or wrong header', () => {
    expect(isAuthorizedTelegramWebhook(req({}), { TELEGRAM_WEBHOOK_SECRET: 'test-secret' })).toBe(false);
    expect(isAuthorizedTelegramWebhook(req({ 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }), { TELEGRAM_WEBHOOK_SECRET: 'test-secret' })).toBe(false);
  });

  it('fails closed when the env secret is unset or empty', () => {
    const r = () => req({ 'X-Telegram-Bot-Api-Secret-Token': 'test-secret' });
    expect(isAuthorizedTelegramWebhook(r(), {})).toBe(false);
    expect(isAuthorizedTelegramWebhook(r(), { TELEGRAM_WEBHOOK_SECRET: '' })).toBe(false);
    expect(isAuthorizedTelegramWebhook(req({ 'X-Telegram-Bot-Api-Secret-Token': '' }), { TELEGRAM_WEBHOOK_SECRET: '' })).toBe(false);
  });
});
