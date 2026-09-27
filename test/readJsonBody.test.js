import { describe, it, expect } from 'vitest';
import { readJsonBody } from '../lib/readJsonBody.js';

const encoder = new TextEncoder();

function textReq(text, headers = {}) {
  return new Request('https://x/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: text });
}

function streamReq(text, chunkSize = 100, onPull) {
  const bytes = encoder.encode(text);
  let offset = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (onPull) onPull(offset);
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Request('https://x/api/test', { method: 'POST', body: stream, duplex: 'half' });
}

async function expectError(result, status, message) {
  expect(result.ok).toBe(false);
  expect(result.response).toBeInstanceOf(Response);
  expect(result.response.status).toBe(status);
  expect(result.response.headers.get('Content-Type')).toBe('application/json');
  expect(await result.response.json()).toEqual({ error: message });
}

describe('readJsonBody', () => {
  it('parses an object body under the cap', async () => {
    const result = await readJsonBody(textReq('{"a":1,"b":"ký tự"}'), { maxBytes: 100 });
    expect(result).toEqual({ ok: true, body: { a: 1, b: 'ký tự' } });
  });

  it('accepts a body of exactly maxBytes (counted in UTF-8 bytes)', async () => {
    const text = JSON.stringify({ s: 'ệ'.repeat(10) }); // multi-byte chars
    const size = encoder.encode(text).length;
    expect(size).toBeGreaterThan(text.length);
    expect((await readJsonBody(streamReq(text, 7), { maxBytes: size })).ok).toBe(true);
    await expectError(await readJsonBody(streamReq(text, 7), { maxBytes: size - 1 }), 413, 'Dữ liệu gửi lên quá lớn');
  });

  it('rejects early with 413 when Content-Length exceeds the cap', async () => {
    const text = JSON.stringify({ s: 'x'.repeat(500) });
    await expectError(await readJsonBody(textReq(text, { 'Content-Length': String(encoder.encode(text).length) }), { maxBytes: 100 }), 413, 'Dữ liệu gửi lên quá lớn');
  });

  it('rejects with 413 when the stream exceeds the cap even though Content-Length is absent', async () => {
    const request = streamReq(JSON.stringify({ s: 'x'.repeat(5000) }));
    expect(request.headers.get('content-length')).toBeNull();
    await expectError(await readJsonBody(request, { maxBytes: 1000 }), 413, 'Dữ liệu gửi lên quá lớn');
  });

  it('stops reading the stream as soon as the cap is exceeded', async () => {
    let maxOffsetPulled = 0;
    const request = streamReq('x'.repeat(1_000_000), 100, (offset) => { maxOffsetPulled = Math.max(maxOffsetPulled, offset); });
    await expectError(await readJsonBody(request, { maxBytes: 1000 }), 413, 'Dữ liệu gửi lên quá lớn');
    expect(maxOffsetPulled).toBeLessThan(10_000);
  });

  it('rejects invalid JSON with 400', async () => {
    await expectError(await readJsonBody(textReq('not json'), { maxBytes: 100 }), 400, 'Dữ liệu không hợp lệ');
    await expectError(await readJsonBody(textReq(''), { maxBytes: 100 }), 400, 'Dữ liệu không hợp lệ');
  });

  it('rejects a request with no body with 400', async () => {
    const request = new Request('https://x/api/test', { method: 'POST' });
    await expectError(await readJsonBody(request, { maxBytes: 100 }), 400, 'Dữ liệu không hợp lệ');
  });

  it('rejects non-object JSON (array, null, string, number) with 400', async () => {
    for (const text of ['[]', '[{"a":1}]', 'null', '"s"', '1', 'true']) {
      await expectError(await readJsonBody(textReq(text), { maxBytes: 100 }), 400, 'Dữ liệu không hợp lệ');
    }
  });

  it('merges extra response headers (e.g. CORS) into error responses', async () => {
    const result = await readJsonBody(textReq('[]'), { maxBytes: 100, headers: { 'Access-Control-Allow-Origin': 'https://example.com' } });
    expect(result.response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    expect(result.response.headers.get('Content-Type')).toBe('application/json');
  });
});
