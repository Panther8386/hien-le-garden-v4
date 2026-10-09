import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as changePassword } from '../functions/api/auth/change-password.js';
import { createSession, hashPassword, verifyPassword, createPending2FAToken, getSession, getPendingStaffId, consumePendingToken } from '../lib/auth.js';
import { consumePasswordChangeBudget, consumeLoginBudget } from '../lib/loginRateLimit.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestPost as verify2fa } from '../functions/api/auth/verify-2fa.js';
import { generateTOTP } from '../lib/totp.js';

let sharedHash, token;

beforeAll(async () => {
  sharedHash = await hashPassword('MatKhauCu123');
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM pending_2fa_tokens; DELETE FROM audit_log; DELETE FROM login_rate_limits;');
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'le_tan_a', ?, 'reception', '2026-08-01T00:00:00Z')`).bind(sharedHash).run();
  token = await createSession(env.DB, 1);
});

describe('self-password security', () => {
  const body = { currentPassword: 'MatKhauCu123', newPassword: 'MatKhauMoi123' };
  function interceptIssue(before, table) {
    let fired=false;
    return {DB:{batch:env.DB.batch.bind(env.DB),prepare(sql){const stmt=env.DB.prepare(sql);
      if(!sql.includes(`INSERT INTO ${table} (`))return stmt;
      return {bind(...args){const bound=stmt.bind(...args);const invoke=async method=>{if(!fired){fired=true;await before();}return bound[method]();};return {first:()=>invoke('first'),run:()=>invoke('run')};}};
    }}};
  }
  it.each([false,true])('late password login cannot issue credentials after change (2FA=%s)',async twoFactor=>{
    if(twoFactor)await env.DB.prepare('UPDATE staff_accounts SET totp_enabled=1 WHERE id=1').run();
    const isolated=interceptIssue(async()=>{expect((await changePassword({env,request:authedRequest(body)})).status).toBe(200);},twoFactor?'pending_2fa_tokens':'sessions');
    const r=await login({env:isolated,request:new Request('https://x/api/auth/login',{method:'POST',body:JSON.stringify({username:'le_tan_a',password:'MatKhauCu123'})})});
    expect(r.status).toBe(401);expect(r.headers.get('Set-Cookie')).toBeNull();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_2fa_tokens').first()).n).toBe(0);
  });
  it.each([true,false])('late consumed 2FA cannot issue session/rotated token (valid code=%s)',async valid=>{
    const secret='JBSWY3DPEHPK3PXP';await env.DB.prepare('UPDATE staff_accounts SET totp_enabled=1,totp_secret=? WHERE id=1').bind(secret).run();
    const pendingToken=await createPending2FAToken(env.DB,1);
    const isolated=interceptIssue(async()=>{expect((await changePassword({env,request:authedRequest(body)})).status).toBe(200);},valid?'sessions':'pending_2fa_tokens');
    const code=valid?await generateTOTP(secret):'invalid';
    const r=await verify2fa({env:isolated,request:new Request('https://x/api/auth/verify-2fa',{method:'POST',body:JSON.stringify({pendingToken,code})})});
    expect(r.status).toBe(401);expect(r.headers.get('Set-Cookie')).toBeNull();expect((await r.json()).pendingToken).toBeUndefined();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_2fa_tokens').first()).n).toBe(0);
  });
  it('revokes all own sessions/pending tokens, preserves others, clears cookie and audits without secrets', async () => {
    const other = await createSession(env.DB, 1), pending = await createPending2FAToken(env.DB, 1);
    await env.DB.prepare(`INSERT INTO staff_accounts (id,username,password_hash,role,created_at) VALUES (2,'other',?,'observer','2026-08-01')`).bind(sharedHash).run();
    const kept = await createSession(env.DB, 2), keptPending = await createPending2FAToken(env.DB, 2);
    const r = await changePassword({ request: authedRequest(body), env });
    expect(r.status).toBe(200);expect(r.headers.get('Set-Cookie')).toContain('Max-Age=0');expect(await r.json()).toEqual({ok:true,requiresLogin:true});
    expect(await getSession(env.DB, token)).toBeNull();expect(await getSession(env.DB, other)).toBeNull();expect(await getPendingStaffId(env.DB,pending)).toBeNull();
    expect(await getSession(env.DB,kept)).not.toBeNull();expect(await getPendingStaffId(env.DB,keptPending)).toBe(2);
    const audit=await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type='account_password_change'`).first();
    expect(audit.actor).toBe('le_tan_a');expect(audit.entity_id).toBe(1);
    for(const secret of [body.currentPassword,body.newPassword,sharedHash,token,other,pending])expect(JSON.stringify(audit)).not.toContain(secret);
  });
  it('allows five guesses then throttles the sixth with Retry-After and no credential writes', async () => {
    for(let i=0;i<5;i++)expect((await changePassword({env,request:authedRequest({...body,currentPassword:'wrong'})})).status).toBe(400);
    const r=await changePassword({env,request:authedRequest(body)});expect(r.status).toBe(429);expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await env.DB.prepare('SELECT password_hash AS h FROM staff_accounts WHERE id=1').first()).h).toBe(sharedHash);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first()).n).toBe(0);
  });
  it('account budget follows ID across different networks and session cookies', async () => {
    for(let i=0;i<6;i++){const request=authedRequest({...body,currentPassword:'wrong'});request.headers.set('CF-Connecting-IP',`192.0.2.${i+1}`);expect((await changePassword({env,request})).status).toBe(i<5?400:429);}
  });
  it('concurrent budget reservations allow only five; expired budget works again; login is separate', async () => {
    const request=authedRequest(body),now=Date.now();
    const results=await Promise.all(Array.from({length:12},()=>consumePasswordChangeBudget(env.DB,request,1,now)));
    expect(results.filter(x=>x.allowed)).toHaveLength(5);
    expect((await consumeLoginBudget(env.DB,request,'le_tan_a',now)).allowed).toBe(true);
    expect((await consumePasswordChangeBudget(env.DB,request,1,now+300001)).allowed).toBe(true);
  });
  it('two concurrent changes produce only one audit and one winning password', async () => {
    const r=await Promise.all([changePassword({env,request:authedRequest(body)}),changePassword({env,request:authedRequest({...body,newPassword:'AnotherNew123'})})]);
    expect(r.filter(x=>x.status===200)).toHaveLength(1);expect(r.filter(x=>[401,409].includes(x.status))).toHaveLength(1);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type='account_password_change'`).first()).n).toBe(1);
  });
  it('audit failure rolls back hash and session/token revocation', async () => {
    const pending=await createPending2FAToken(env.DB,1);
    await env.DB.exec(`CREATE TRIGGER fail_password_audit BEFORE INSERT ON audit_log WHEN NEW.action_type='account_password_change' BEGIN SELECT RAISE(ABORT,'injected'); END;`);
    try{expect((await changePassword({env,request:authedRequest(body)})).status).toBe(503);
      expect((await env.DB.prepare('SELECT password_hash AS h FROM staff_accounts WHERE id=1').first()).h).toBe(sharedHash);
      expect(await getSession(env.DB,token)).not.toBeNull();expect(await getPendingStaffId(env.DB,pending)).toBe(1);
    }finally{await env.DB.exec('DROP TRIGGER fail_password_audit');}
  });
  it('late old-password session and pending issuance cannot revive access after change', async () => {
    const pending=await createPending2FAToken(env.DB,1),consumed=await consumePendingToken(env.DB,pending);
    expect(consumed.passwordHash).toBe(sharedHash);
    expect((await changePassword({env,request:authedRequest(body)})).status).toBe(200);
    expect(await createSession(env.DB,1,{passwordHash:sharedHash})).toBeNull();
    expect(await createSession(env.DB,1,{passwordHash:consumed.passwordHash})).toBeNull();
    expect(await createPending2FAToken(env.DB,1,{passwordHash:sharedHash})).toBeNull();
    const current=(await env.DB.prepare('SELECT password_hash AS h FROM staff_accounts WHERE id=1').first()).h;
    expect(await createSession(env.DB,1,{passwordHash:current})).not.toBeNull();
  });
  it('oversize and non-object JSON fail before password budget', async () => {
    expect((await changePassword({env,request:authedRequest({...body,newPassword:'x'.repeat(5000)})})).status).toBe(413);
    expect((await changePassword({env,request:authedRequest(null)})).status).toBe(400);
    expect((await changePassword({env,request:authedRequest({...body,newPassword:'x'.repeat(257)})})).status).toBe(400);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM login_rate_limits').first()).n).toBe(0);
  });
  it('budget storage failure fails closed', async () => {
    const broken={DB:{prepare:env.DB.prepare.bind(env.DB),batch:async()=>{throw Error('injected');}}};
    const r=await changePassword({env:broken,request:authedRequest(body)});expect(r.status).toBe(503);expect(r.headers.get('Retry-After')).toBe('60');
    expect((await env.DB.prepare('SELECT password_hash AS h FROM staff_accounts WHERE id=1').first()).h).toBe(sharedHash);
  });
});

function authedRequest(body) {
  return new Request('https://x/api/auth/change-password', { method: 'POST', headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/auth/change-password', () => {
  it('rejects unauthenticated requests', async () => {
    const request = new Request('https://x/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'a', newPassword: 'MatKhauMoi123' }) });
    const response = await changePassword({ request, env });
    expect(response.status).toBe(401);
  });

  it('changes the password when currentPassword is correct', async () => {
    const response = await changePassword({ request: authedRequest({ currentPassword: 'MatKhauCu123', newPassword: 'MatKhauMoi123' }), env });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT password_hash AS passwordHash FROM staff_accounts WHERE id = 1`).first();
    expect(await verifyPassword('MatKhauMoi123', row.passwordHash)).toBe(true);
  });

  it('rejects when currentPassword is wrong (400)', async () => {
    const response = await changePassword({ request: authedRequest({ currentPassword: 'sai-mat-khau', newPassword: 'MatKhauMoi123' }), env });
    expect(response.status).toBe(400);

    const row = await env.DB.prepare(`SELECT password_hash AS passwordHash FROM staff_accounts WHERE id = 1`).first();
    expect(await verifyPassword('MatKhauCu123', row.passwordHash)).toBe(true);
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const response = await changePassword({ request: authedRequest({ currentPassword: 'MatKhauCu123', newPassword: '123' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/auth/change-password', { method: 'POST', headers: { Cookie: `session=${token}` }, body: 'not json' });
    const response = await changePassword({ request, env });
    expect(response.status).toBe(400);
  });
});
