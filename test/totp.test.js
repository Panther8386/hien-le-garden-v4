import { describe, it, expect } from 'vitest';
import { generateSecret, generateTOTP, verifyTOTP, buildOtpauthUrl } from '../lib/totp.js';

const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('generateTOTP', () => {
  it('matches RFC 6238 test vectors (SHA1, 6-digit truncation)', async () => {
    const vectors = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [time, expected] of vectors) {
      const code = await generateTOTP(RFC_SECRET_BASE32, { time });
      expect(code).toBe(expected);
    }
  });
});

describe('verifyTOTP', () => {
  it('accepts the code for the current time step', async () => {
    const time = 1111111109;
    const code = await generateTOTP(RFC_SECRET_BASE32, { time });
    expect(await verifyTOTP(RFC_SECRET_BASE32, code, { time })).toBe(true);
  });

  it('accepts a code from one step earlier (clock drift tolerance)', async () => {
    const time = 1111111109;
    const codeOneStepEarlier = await generateTOTP(RFC_SECRET_BASE32, { time: time - 30 });
    expect(await verifyTOTP(RFC_SECRET_BASE32, codeOneStepEarlier, { time })).toBe(true);
  });

  it('rejects a code from two steps earlier', async () => {
    const time = 1111111109;
    const codeTwoStepsEarlier = await generateTOTP(RFC_SECRET_BASE32, { time: time - 60 });
    expect(await verifyTOTP(RFC_SECRET_BASE32, codeTwoStepsEarlier, { time })).toBe(false);
  });

  it('rejects a wrong code', async () => {
    const time = 1111111109;
    expect(await verifyTOTP(RFC_SECRET_BASE32, '000000', { time })).toBe(false);
  });
});

describe('generateSecret', () => {
  it('returns a base32 string with no padding', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it('returns a different secret each call', () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

describe('buildOtpauthUrl', () => {
  it('builds a Google Authenticator compatible otpauth URI', () => {
    const url = buildOtpauthUrl({
      secret: RFC_SECRET_BASE32,
      accountName: 'le_tan_a',
      issuer: 'Hiền Lê Garden',
    });
    expect(url).toBe(
      'otpauth://totp/Hi%E1%BB%81n%20L%C3%AA%20Garden:le_tan_a?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Hi%E1%BB%81n%20L%C3%AA%20Garden&algorithm=SHA1&digits=6&period=30'
    );
  });
});
