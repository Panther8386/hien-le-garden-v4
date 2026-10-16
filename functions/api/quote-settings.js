import { requireAuth } from '../../lib/requireAuth.js';
import { hasPermission } from '../../lib/permissions.js';
import { readJsonBody } from '../../lib/readJsonBody.js';
import { loadQuoteSettings, validateQuoteSettings, QUOTE_SETTINGS_MAX_BYTES } from '../../lib/quoteSettings.js';
import { json, jsonError } from '../../lib/serviceOrders.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, null);
  if (auth instanceof Response) return auth;
  if (!hasPermission(auth, 'settings.view') && !hasPermission(auth, 'service_orders.view')) return jsonError('Không đủ quyền', 403);
  return json(await loadQuoteSettings(env.DB));
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAuth(request, env, 'settings.quote_template');
  if (auth instanceof Response) return auth;
  const parsed = await readJsonBody(request, { maxBytes: QUOTE_SETTINGS_MAX_BYTES });
  if (!parsed.ok) return parsed.response;
  const checked = validateQuoteSettings(parsed.body);
  if (checked.error) return jsonError(checked.error, 400);
  const v = checked.value;
  const previous = await loadQuoteSettings(env.DB);
  // Field names only: never copy bank details or contact data into audit.
  const changed = Object.keys(v).filter((k) => v[k] !== previous[k]);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO quote_settings (business_name, address, hotline, email, website, default_valid_days, default_deposit_percent,
        tax_note, cancellation_terms, footer_note, bank_name, bank_account, bank_holder, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(v.businessName, v.address, v.hotline, v.email, v.website, v.defaultValidDays, v.defaultDepositPercent, v.taxNote,
        v.cancellationTerms, v.footerNote, v.bankName, v.bankAccount, v.bankHolder, auth.username, now),
    env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
      VALUES ('quote_settings_update', 'quote_settings', last_insert_rowid(), 'Mẫu phiếu báo giá', NULL, ?, ?, ?)`)
      .bind(JSON.stringify({ changed }), auth.username, now),
  ]);
  return json({ ok: true });
}
