// Đọc body JSON với giới hạn kích thước cứng, TRƯỚC khi parse.
// Không tin Content-Length (có thể thiếu hoặc sai với body chunked): đọc stream
// từng phần và dừng ngay khi vượt maxBytes.
// Trả về { ok: true, body } (body luôn là object thường) hoặc { ok: false, response }.

const TOO_LARGE = 'Dữ liệu gửi lên quá lớn';
const INVALID = 'Dữ liệu không hợp lệ';

function errorResponse(message, status, headers) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...(headers || {}), 'Content-Type': 'application/json' },
  });
}

export async function readJsonBody(request, { maxBytes, headers } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError('readJsonBody: maxBytes must be a non-negative integer');
  }
  const fail = (message, status) => ({ ok: false, response: errorResponse(message, status, headers) });

  const declared = request.headers.get('Content-Length');
  if (declared !== null && declared.trim() !== '' && Number(declared) > maxBytes) {
    return fail(TOO_LARGE, 413);
  }

  if (!request.body) return fail(INVALID, 400);

  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        reader.cancel().catch(() => {});
        return fail(TOO_LARGE, 413);
      }
      chunks.push(value);
    }
  } catch (err) {
    return fail(INVALID, 400);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch (err) {
    return fail(INVALID, 400);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return fail(INVALID, 400);
  }
  return { ok: true, body };
}
