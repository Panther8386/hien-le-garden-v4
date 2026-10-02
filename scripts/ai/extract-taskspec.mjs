// Lexical extractor for the TaskSpec machine block (ADR-AI-004; grammar in
// docs/ai/specs/README.md).
//
// Finds exactly one line equal to TASKSPEC_MARKER and returns a copy of the raw bytes
// between that line and the closing fence line. Byte-oriented: no Markdown parsing, no
// JSON parsing and no validation of the payload. The payload is handed to
// validateContractBytes (ADR-AI-007) by a later layer; passing extraction says nothing
// about schema validity, approval or SHA freshness.
//
// Whole-file byte rules mirror ADR-AI-007: size cap, no UTF-8 BOM, no NUL byte, fatal
// UTF-8 decoding (used only to validate; extraction works on the bytes).
// Lines end at LF. For marker and fence comparison only, one trailing CR is ignored, so
// LF, CRLF and mixed files are accepted. Payload bytes are never normalized.
//
// Result: { ok: true, bytes, startLine, endLine } where bytes is a copy, startLine is the
// marker line and endLine the closing fence line (both 1-based), or
// { ok: false, code, line? }. Failures never include input text.

export const TASKSPEC_MARKER = '```json hlg-taskspec';
export const TASKSPEC_FENCE = '```';
export const MAX_TASKSPEC_MARKDOWN_BYTES = 2_097_152;
export const MAX_TASKSPEC_BLOCK_BYTES = 1_048_576;

const LF = 0x0a;
const CR = 0x0d;

function failure(code, line) {
  return line === undefined ? { ok: false, code } : { ok: false, code, line };
}

// Splits on LF. Each line: { start, end, next } where [start, end) is the content without
// the LF and without one trailing CR, and next is the offset of the following line.
function splitLines(bytes) {
  const lines = [];
  let start = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === LF) {
      if (i === bytes.length && start === i) break; // no empty line after a final LF
      const end = i > start && bytes[i - 1] === CR ? i - 1 : i;
      lines.push({ start, end, next: Math.min(i + 1, bytes.length) });
      start = i + 1;
    }
  }
  return lines;
}

// A line that looks like an attempt at the marker but is not exactly it: after trimming,
// it starts with a backtick or tilde fence and mentions hlg-taskspec in any case.
function isNearMissMarker(text) {
  const t = text.trim();
  return (t.startsWith('```') || t.startsWith('~~~')) && t.toLowerCase().includes('hlg-taskspec');
}

export function extractTaskSpecBlock(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('extractTaskSpecBlock: bytes must be a Uint8Array');
  if (bytes.length > MAX_TASKSPEC_MARKDOWN_BYTES) return failure('E_TOO_LARGE');
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return failure('E_ENCODING');
  if (bytes.includes(0)) return failure('E_ENCODING');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  try {
    decoder.decode(bytes);
  } catch {
    return failure('E_ENCODING');
  }

  // LF never occurs inside a multi-byte UTF-8 sequence, so each line decodes on its own.
  const lines = splitLines(bytes);
  const text = (line) => decoder.decode(bytes.subarray(line.start, line.end));

  let markerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = text(lines[i]);
    if (t === TASKSPEC_MARKER) {
      if (markerIndex !== -1) return failure('E_TASKSPEC_MULTIPLE_BLOCKS', i + 1);
      markerIndex = i;
    } else if (isNearMissMarker(t)) {
      return failure('E_TASKSPEC_MARKER_MALFORMED', i + 1);
    }
  }
  if (markerIndex === -1) return failure('E_TASKSPEC_NO_BLOCK');

  let closeIndex = -1;
  for (let i = markerIndex + 1; i < lines.length; i++) {
    const t = text(lines[i]);
    if (t === TASKSPEC_FENCE) {
      closeIndex = i;
      break;
    }
    if (t.replace(/[ \t]+$/, '') === TASKSPEC_FENCE) return failure('E_TASKSPEC_FENCE_MALFORMED', i + 1);
  }
  if (closeIndex === -1) return failure('E_TASKSPEC_UNCLOSED_BLOCK', markerIndex + 1);
  if (closeIndex === markerIndex + 1) return failure('E_TASKSPEC_EMPTY_BLOCK', markerIndex + 1);

  const from = lines[markerIndex].next;
  const to = lines[closeIndex].start;
  if (to - from > MAX_TASKSPEC_BLOCK_BYTES) return failure('E_TASKSPEC_BLOCK_TOO_LARGE', markerIndex + 1);

  return { ok: true, bytes: bytes.slice(from, to), startLine: markerIndex + 1, endLine: closeIndex + 1 };
}
