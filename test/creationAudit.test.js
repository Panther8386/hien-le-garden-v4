import {beforeEach,describe,it,expect,vi} from 'vitest';
import {env} from 'cloudflare:test';
import {onRequestPost as website} from '../functions/api/bookings/index.js';
import {onRequestPost as staff} from '../functions/api/bookings/staff.js';
import {onRequestPost as user} from '../functions/api/users/index.js';
import {onRequestGet as audit} from '../functions/api/audit-log/index.js';
import {createSession} from '../lib/auth.js';
import {envWithHookBefore} from './helpers/raceEnv.js';

let token,roomId;
const booking={guestName:'private-guest-sentinel',phone:'private-phone-sentinel',email:'private@example.test',notes:'private-note-sentinel',roomType:'circle',checkIn:'2099-04-01',checkOut:'2099-04-02',turnstileToken:'private-challenge-sentinel',actor:'spoofed-actor'};
const account={username:'private-login-sentinel',password:'private-password-sentinel',role:'observer'};
const testEnv=()=>({...env,TURNSTILE_SECRET_KEY:'private-secret-sentinel',TURNSTILE_ALLOWED_HOSTNAMES:'hienlegarden.vn'});
const request=(path,data,authenticated=true)=>new Request('https://hienlegarden.vn'+path,{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Cookie:`session=${token}`}:{})},body:JSON.stringify(data)});
const callWebsite=(data=booking)=>website({request:request('/api/bookings',data,false),env:testEnv()});
const callStaff=(source='phone',extra={})=>staff({request:request('/api/bookings/staff',{...booking,roomId,source,...extra}),env});
const callUser=(data=account,override=env)=>user({request:request('/api/users',data),env:override});
const audits=async()=>(await env.DB.prepare('SELECT * FROM audit_log ORDER BY id').all()).results;
const failAudit=()=>env.DB.exec("CREATE TRIGGER sec7_fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
const count=async table=>(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;

beforeEach(async()=>{
 await env.DB.exec('DROP TRIGGER IF EXISTS sec7_fail_audit');
 await env.DB.batch(['audit_log','bookings','notification_settings','login_rate_limits','sessions','staff_accounts'].map(t=>env.DB.prepare(`DELETE FROM ${t}`)));
 await env.DB.prepare("INSERT INTO staff_accounts(id,username,password_hash,role,created_at) VALUES(1,'sec7_admin','synthetic','admin','2026-10-10')").run();token=await createSession(env.DB,1);
 roomId=(await env.DB.prepare("SELECT id FROM rooms WHERE room_type='circle' AND is_active=1 LIMIT 1").first()).id;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({success:true,hostname:'hienlegarden.vn',action:'booking'})));
});

function privateFree(rows){const text=JSON.stringify(rows);for(const value of [...Object.values(booking).filter(v=>String(v).startsWith('private')),account.username,account.password,token,'private-secret-sentinel'])expect(text).not.toContain(value);}

describe('SEC-7 atomic creation audits on real local D1',()=>{
 it('website creates exactly one anonymous audit for its returned ID without guest/contact/secret data',async()=>{
  const r=await callWebsite();expect(r.status).toBe(201);const {id}=await r.json();const rows=await audits();expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({action_type:'booking_create',entity_type:'booking',entity_id:id,entity_label:`Booking #${id}`,actor:'website:anonymous',old_value:null});
  expect(JSON.parse(rows[0].new_value)).toMatchObject({source:'website',status:'pending'});privateFree(rows);
 });
 it.each(['phone','zalo','walk_in'])('staff source %s records trusted operator and matching booking ID',async source=>{
  const r=await callStaff(source);expect(r.status).toBe(201);const {id}=await r.json();const rows=await audits();expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({action_type:'booking_create',entity_id:id,actor:'sec7_admin'});expect(JSON.parse(rows[0].new_value)).toMatchObject({source,status:'confirmed',roomId});privateFree(rows);
 });
 it('account creation records target ID/role and operator, without login/password/hash',async()=>{
  const r=await callUser();expect(r.status).toBe(201);const {id}=await r.json();const rows=await audits();expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({action_type:'account_create',entity_type:'staff_account',entity_id:id,actor:'sec7_admin',entity_label:`Tài khoản #${id}`});expect(JSON.parse(rows[0].new_value)).toEqual({role:'observer'});privateFree(rows);
  const target=await env.DB.prepare('SELECT password_hash FROM staff_accounts WHERE id=?').bind(id).first();expect(JSON.stringify(rows)).not.toContain(target.password_hash);
 });
 it.each(['website','staff','user'])('audit failure rolls back %s creation and prevents notification',async type=>{
  await env.DB.prepare("INSERT INTO notification_settings(booking_notify_chat_id,updated_at) VALUES('synthetic-chat','2026-10-10')").run();await failAudit();
  const beforeUsers=await count('staff_accounts');const r=type==='website'?await callWebsite():type==='staff'?await callStaff():await callUser();expect(r.status).toBe(503);
  expect(await count('bookings')).toBe(0);expect(await count('staff_accounts')).toBe(beforeUsers);expect(await audits()).toHaveLength(0);
  const calls=fetch.mock.calls;expect(calls.every(([url])=>url==='https://challenges.cloudflare.com/turnstile/v0/siteverify')).toBe(true);
 });
 it('concurrent website inserts retain distinct correct IDs/audits',async()=>{
  const responses=await Promise.all([callWebsite(),callWebsite({...booking,guestName:'private-second-guest'})]);const ids=await Promise.all(responses.map(async r=>{expect(r.status).toBe(201);return(await r.json()).id;}));
  expect(new Set(ids).size).toBe(2);const rows=await audits();expect(rows.map(r=>r.entity_id).sort()).toEqual(ids.sort());expect(await count('bookings')).toBe(2);
 });
 it('concurrent account inserts never attach an audit to the wrong account',async()=>{
  const responses=await Promise.all([callUser(),callUser({...account,username:'private-second-login'})]);const ids=await Promise.all(responses.map(async r=>{expect(r.status).toBe(201);return(await r.json()).id;}));
  expect(new Set(ids).size).toBe(2);expect((await audits()).map(r=>r.entity_id).sort()).toEqual(ids.sort());
 });
 it('racing duplicate username returns 409 and leaves only the winning account/audit',async()=>{
  const hooked=envWithHookBefore(/INSERT INTO staff_accounts/,async()=>{expect((await callUser()).status).toBe(201);});expect((await callUser(account,hooked)).status).toBe(409);
  expect(await count('staff_accounts')).toBe(2);expect(await audits()).toHaveLength(1);
 });
 it('invalid/unauthorized attempts write no success audit',async()=>{
  expect((await callWebsite({...booking,guestName:''})).status).toBe(400);
  expect((await staff({request:request('/api/bookings/staff',booking,false),env})).status).toBe(401);
  expect((await user({request:request('/api/users',account,false),env})).status).toBe(401);expect(await audits()).toHaveLength(0);
 });
 it('notification failure keeps the committed booking and audit',async()=>{
  await env.DB.prepare("INSERT INTO notification_settings(booking_notify_chat_id,updated_at) VALUES('synthetic-chat','2026-10-10')").run();
  vi.stubGlobal('fetch',vi.fn(async url=>{if(String(url).includes('siteverify'))return Response.json({success:true,hostname:'hienlegarden.vn',action:'booking'});throw new Error('synthetic telegram outage');}));
  const r=await website({request:request('/api/bookings',booking,false),env:{...testEnv(),TELEGRAM_BOT_TOKEN:'synthetic-bot'}});expect(r.status).toBe(201);expect(await count('bookings')).toBe(1);expect(await audits()).toHaveLength(1);
 });
 it('new action filters expose only their matching entries under existing audit permission',async()=>{
  await callWebsite();await callUser();for(const type of ['booking_create','account_create']){const r=await audit({request:new Request('https://hienlegarden.vn/api/audit-log?type='+type,{headers:{Cookie:`session=${token}`}}),env});expect(r.status).toBe(200);const rows=await r.json();expect(rows).toHaveLength(1);expect(rows[0].actionType).toBe(type);}
 });
});
