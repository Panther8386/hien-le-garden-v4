import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('migration 0003', () => {
  it('creates message_templates with two active seed rows', async () => {
    const { results } = await env.DB.prepare(
      `SELECT channel, is_active FROM message_templates ORDER BY channel`
    ).all();
    expect(results).toEqual([
      { channel: 'email', is_active: 1 },
      { channel: 'telegram', is_active: 1 },
    ]);
  });

  it('creates an empty message_log table', async () => {
    const { results } = await env.DB.prepare(`SELECT * FROM message_log`).all();
    expect(results).toEqual([]);
  });
});
