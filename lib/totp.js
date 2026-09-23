const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const DEFAULT_WINDOW = 1;

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  while (output.length % 8 !== 0) {
    output += '=';
  }
  return output;
}

export function base32Decode(input) {
  const cleaned = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

export function generateSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return base32Encode(bytes).replace(/=+$/, '');
}

async function hotp(secretBase32, counter, digits) {
  const keyBytes = base32Decode(secretBase32);
  const counterBytes = new Uint8Array(8);
  let remaining = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));

  const offset = signature[signature.length - 1] & 0xf;
  const code =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);

  return String(code % 10 ** digits).padStart(digits, '0');
}

export async function generateTOTP(secretBase32, options = {}) {
  const step = options.step ?? DEFAULT_STEP_SECONDS;
  const digits = options.digits ?? DEFAULT_DIGITS;
  const time = options.time ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / step);
  return hotp(secretBase32, counter, digits);
}

export async function verifyTOTP(secretBase32, token, options = {}) {
  const step = options.step ?? DEFAULT_STEP_SECONDS;
  const digits = options.digits ?? DEFAULT_DIGITS;
  const window = options.window ?? DEFAULT_WINDOW;
  const time = options.time ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / step);

  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = await hotp(secretBase32, counter + errorWindow, digits);
    if (candidate === token) return true;
  }
  return false;
}

export function buildOtpauthUrl({ secret, accountName, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const query = [
    `secret=${encodeURIComponent(secret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    `algorithm=SHA1`,
    `digits=${DEFAULT_DIGITS}`,
    `period=${DEFAULT_STEP_SECONDS}`,
  ].join('&');
  return `otpauth://totp/${label}?${query}`;
}
