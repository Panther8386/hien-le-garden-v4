import {beforeAll,beforeEach,describe,it,expect} from 'vitest';
import {env} from 'cloudflare:test';
import {onRequestPost as login} from '../functions/api/auth/login.js';
import {hashPassword} from '../lib/auth.js';
import {consumeLoginBudget,LOGIN_WINDOW_MS} from '../lib/loginRateLimit.js';

let hash;
beforeAll(async()=>{hash=await hashPassword('sec3-valid-password');});
beforeEach(async()=>{
  await env.DB.batch(['login_rate_limits','sessions','pending_2fa_tokens','staff_accounts'].map(t=>env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.prepare("INSERT INTO staff_accounts(id,username,password_hash,role,created_at) VALUES(1,'sec3_admin',?,'admin','2026-10-08T00:00:00Z')").bind(hash).run();
});
function req(username='sec3_admin',password='wrong',ip='192.0.2.1',extra={}){
  return new Request('https://sec3.invalid/api/auth/login',{method:'POST',headers:{...(ip?{'CF-Connecting-IP':ip}:{}),...extra},body:JSON.stringify({username,password})});
}
const attempt=(...args)=>login({env,request:req(...args)});
const budget=(ip,username='sec3_admin',now=1000)=>consumeLoginBudget(env.DB,req(username,'wrong',ip),username,now);

describe('SEC-3 login rate limits on real local D1',()=>{
  it('allows five attempts then returns 429 with retry information and no auth tokens',async()=>{
    for(let i=0;i<5;i++)expect((await attempt()).status).toBe(401);
    // Even valid credentials cannot bypass the reserved budget.
    const r=await attempt('sec3_admin','sec3-valid-password');expect(r.status).toBe(429);
    const body=await r.json();expect(body.retryAfter).toBeGreaterThan(0);expect(body.retryAfter).toBeLessThanOrEqual(300);
    expect(r.headers.get('Retry-After')).toBe(String(body.retryAfter));expect(r.headers.get('Cache-Control')).toBe('no-store');expect(r.headers.get('Set-Cookie')).toBeNull();expect(body.pendingToken).toBeUndefined();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_2fa_tokens').first()).n).toBe(0);
  });
  it('reserves slots atomically across concurrent requests',async()=>{
    const responses=await Promise.all(Array.from({length:15},()=>attempt()));
    expect(responses.filter(r=>r.status===401)).toHaveLength(5);expect(responses.filter(r=>r.status===429)).toHaveLength(10);
  });
  it('limits username rotation to thirty attempts from one IP',async()=>{
    for(let i=0;i<30;i++)expect((await attempt(`missing_${i}`)).status).toBe(401);
    expect((await attempt('missing_31')).status).toBe(429);
    for(let i=0;i<10;i++)expect((await attempt(`blocked_new_${i}`)).status).toBe(429);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM login_rate_limits').first()).n).toBe(31);
  });
  it('does not lock the same account on another network',async()=>{
    for(let i=0;i<6;i++)await attempt();
    expect((await attempt('sec3_admin','sec3-valid-password','192.0.2.2')).status).toBe(200);
    expect((await env.DB.prepare('SELECT locked_at FROM staff_accounts WHERE id=1').first()).locked_at).toBeNull();
  });
  it('keeps separate account budgets on a shared IP until the IP limit',async()=>{
    for(let i=0;i<6;i++)await attempt();
    expect((await attempt('another_account')).status).toBe(401);
  });
  it('uses identical limits for unknown and known usernames',async()=>{
    for(let i=0;i<5;i++)expect((await attempt('absent')).status).toBe(401);
    expect((await attempt('absent')).status).toBe(429);
  });
  it('does not reset successful password/2FA attempts to grant unlimited challenges',async()=>{
    await env.DB.prepare('UPDATE staff_accounts SET totp_enabled=1,totp_secret=? WHERE id=1').bind('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').run();
    for(let i=0;i<5;i++){const r=await attempt('sec3_admin','sec3-valid-password');expect(r.status).toBe(200);expect((await r.json()).requires2fa).toBe(true);}
    const r=await attempt('sec3_admin','sec3-valid-password');expect(r.status).toBe(429);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_2fa_tokens').first()).n).toBe(5);
  });
  it('resets at expiration without extending a blocked window',async()=>{
    for(let i=0;i<5;i++)expect((await budget('192.0.2.1')).allowed).toBe(true);
    expect(await budget('192.0.2.1','sec3_admin',1000+LOGIN_WINDOW_MS-1000)).toEqual({allowed:false,retryAfter:1});
    expect((await budget('192.0.2.1','sec3_admin',1000+LOGIN_WINDOW_MS)).allowed).toBe(true);
  });
  it('ignores spoofed forwarding headers',async()=>{
    for(let i=0;i<5;i++)await attempt();
    expect((await attempt('sec3_admin','wrong','192.0.2.1',{'X-Forwarded-For':'192.0.2.123','X-Real-IP':'192.0.2.124'})).status).toBe(429);
  });
  it('uses a restrictive shared fallback for missing or invalid IP metadata',async()=>{
    for(let i=0;i<5;i++)await attempt('sec3_admin','wrong',null,{'X-Forwarded-For':`192.0.2.${i}`});
    expect((await attempt('sec3_admin','wrong','garbage')).status).toBe(429);
  });
  it('canonicalizes IPv6 and groups privacy addresses in one /64',async()=>{
    for(let i=0;i<5;i++)await budget('2001:0db8:0001:0002:0000:0000:0000:0001');
    expect((await budget('2001:db8:1:2::ffff')).allowed).toBe(false);
    expect((await budget('2001:db8:1:3::1')).allowed).toBe(true);
  });
  it('maps IPv4-mapped IPv6 to the same IPv4 budget',async()=>{
    for(let i=0;i<5;i++)await budget('192.0.2.1');
    expect((await budget('::ffff:192.0.2.1')).allowed).toBe(false);
  });
  it('fails closed with a generic 503 if rate limit storage is unavailable',async()=>{
    const r=await login({request:req(),env:{DB:{batch:async()=>{throw Error('private detail');},prepare:()=>({bind:()=>({})})}}});
    expect(r.status).toBe(503);expect(r.headers.get('Retry-After')).toBe('60');expect(r.headers.get('Set-Cookie')).toBeNull();expect((await r.text()).includes('private detail')).toBe(false);
  });
  it('rejects invalid body before touching rate limit storage',async()=>{
    const r=await login({request:new Request('https://sec3.invalid',{method:'POST',body:'bad json'}),env:{DB:{}}});expect(r.status).toBe(400);
  });
  it('stores only digest keys and removes at most 100 expired rows per request',async()=>{
    await env.DB.batch(Array.from({length:105},(_,i)=>env.DB.prepare('INSERT INTO login_rate_limits VALUES(?,1,?)').bind(`expired_${i}`,1)));
    await budget('192.0.2.1');
    const rows=(await env.DB.prepare('SELECT bucket_key FROM login_rate_limits WHERE expires_at>1').all()).results;
    expect(rows).toHaveLength(2);expect(rows.every(r=>/^[a-f0-9]{64}$/.test(r.bucket_key))).toBe(true);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM login_rate_limits WHERE expires_at=1').first()).n).toBe(5);
  });
});
