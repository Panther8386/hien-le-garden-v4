import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { createSession } from '../lib/auth.js';
import { onRequestPost as reject } from '../functions/api/bookings/[id]/reject.js';
import { onRequestPost as cancel } from '../functions/api/bookings/[id]/cancel.js';
import { envWithHookBefore } from './helpers/raceEnv.js';

let token;
beforeEach(async () => {
  for (const table of ['booking_service_items','booking_deposits','bookings','audit_log','finance_transactions','sessions','staff_accounts','cancellation_policy_tier']) await env.DB.exec(`DELETE FROM ${table}`);
  await env.DB.prepare(`INSERT INTO staff_accounts (id,username,password_hash,role,created_at) VALUES (1,'refund_staff','x','manager','2026-01-01')`).run();
  token = await createSession(env.DB, 1);
  for (const [days,percent] of [[7,100],[3,50],[0,0]]) await env.DB.prepare(`INSERT INTO cancellation_policy_tier (min_days_before_checkin,refund_percent,updated_at) VALUES (?,?,?)`).bind(days,percent,new Date().toISOString()).run();
});
async function booking(days=8, deposit=50000) {
  const start = new Date(); start.setUTCDate(start.getUTCDate()+days);
  const end = new Date(start); end.setUTCDate(end.getUTCDate()+1);
  const r=await env.DB.prepare(`INSERT INTO bookings (guest_name,phone,room_type,check_in,check_out,status,source,deposit_amount,created_at) VALUES ('Refund regression','0900000000','triangle',?,?,'pending','website',?,?)`).bind(start.toISOString().slice(0,10),end.toISOString().slice(0,10),deposit,new Date().toISOString()).run();
  return r.meta.last_row_id;
}
function call(id, body={}, context=env) {
  return reject({request:new Request(`https://x/api/bookings/${id}/reject`,{method:'POST',headers:{Cookie:`session=${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env:context,params:{id:String(id)}});
}
const row = id => env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
const refunds = () => env.DB.prepare("SELECT * FROM finance_transactions WHERE category='hoan_coc'").all();
function guestCall(id, body, context=env) {
  return cancel({request:new Request(`https://x/api/bookings/${id}/cancel`,{method:'POST',headers:{Cookie:`session=${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env:context,params:{id:String(id)}});
}
async function guestFixture(days) {
  const id=await booking(days);
  await env.DB.prepare("UPDATE bookings SET created_at='2020-01-01T00:00:00Z' WHERE id=?").bind(id).run();
  return id;
}
const guestBody = () => ({reason:'Khách thay đổi kế hoạch',requestSource:'zalo',requestedAt:new Date().toISOString(),paymentMethod:'cash'});

describe('guest requested cancellation',()=>{
  it.each([[8,100],[7,100],[6,50],[3,50],[2,0]])('pending guest cancellation %i days before arrival refunds %i percent',async(days,percent)=>{
    const id=await guestFixture(days),body=guestBody();
    const response=await guestCall(id,body);expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ok:true,refundPercentApplied:percent,refundAmount:50000*percent/100});
    expect(await row(id)).toMatchObject({cancellation_origin:'guest',cancellation_request_source:'zalo',cancellation_requested_at:body.requestedAt,cancelled_by:'refund_staff',cancel_reason:body.reason});
    expect((await env.DB.prepare("SELECT * FROM audit_log WHERE action_type='booking_cancel'").all()).results).toHaveLength(1);
  });
  it('uses the received date rather than the processing date',async()=>{
    const id=await guestFixture(2),body=guestBody();body.requestedAt=new Date(Date.now()-6*86400000).toISOString();
    const response=await guestCall(id,body);expect(response.status).toBe(200);expect((await response.json()).refundPercentApplied).toBe(100);
  });
  it('uses Vietnam calendar days at midnight rather than UTC days',async()=>{
    const id=await guestFixture(8);
    await env.DB.prepare("UPDATE bookings SET check_in='2026-09-08' WHERE id=?").bind(id).run();
    const response=await guestCall(id,{...guestBody(),requestedAt:'2026-09-01T17:00:00.000Z'});
    expect(response.status).toBe(200);expect((await response.json()).refundPercentApplied).toBe(50);
  });
  it.each([{requestedAt:'bad'},{requestedAt:'2099-01-01T00:00:00Z'},{requestedAt:'2019-01-01T00:00:00Z'},{requestSource:'email'},{reason:''}])('rejects invalid request metadata %j without writes',async patch=>{
    const id=await guestFixture(8);expect((await guestCall(id,{...guestBody(),...patch})).status).toBe(400);
    expect((await row(id)).status).toBe('pending');expect((await refunds()).results).toHaveLength(0);
  });
  it('repeated guest cancellation does not refund twice',async()=>{
    const id=await guestFixture(8);expect((await guestCall(id,guestBody())).status).toBe(200);expect((await guestCall(id,guestBody())).status).toBe(400);expect((await refunds()).results).toHaveLength(1);
  });
});

describe('pending booking with deposit',()=>{
  it.each([[8,100],[7,100],[6,100],[3,100],[2,100]])('reject %i days before arrival refunds %i percent',async(days,percent)=>{
    const id=await booking(days);const response=await call(id,{paymentMethod:'transfer'});
    expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,refundPercentApplied:percent,refundAmount:50000*percent/100});
    const b=await row(id);expect(b.status).toBe('cancelled');expect(b.deposit_amount).toBe(50000);expect(b.refund_percent_applied).toBe(percent);
    const tx=(await refunds()).results;expect(tx).toHaveLength(percent>0?1:0);
    if(percent>0){expect(b.refund_finance_transaction_id).toBe(tx[0].id);expect(tx[0]).toMatchObject({type:'expense',amount:50000*percent/100,status:'confirmed'});expect(b.cancel_refund_payment_method).toBe('transfer');}
    expect((await env.DB.prepare("SELECT * FROM audit_log WHERE action_type='booking_reject'").all()).results).toHaveLength(1);
  });
  it('requires a payment method without changing booking or finance',async()=>{
    const id=await booking();expect((await call(id)).status).toBe(400);expect((await row(id)).status).toBe('pending');expect((await refunds()).results).toHaveLength(0);
  });
  it('allows no-deposit rejection without a payment method',async()=>{
    const id=await booking(8,0);expect((await call(id)).status).toBe(200);expect((await refunds()).results).toHaveLength(0);
  });
  it('two concurrent rejections create exactly one refund and audit',async()=>{
    const id=await booking();const responses=await Promise.all([call(id,{paymentMethod:'cash'}),call(id,{paymentMethod:'transfer'})]);
    expect(responses.filter(r=>r.status===200)).toHaveLength(1);expect((await refunds()).results).toHaveLength(1);
    expect((await env.DB.prepare("SELECT * FROM audit_log WHERE action_type='booking_reject'").all()).results).toHaveLength(1);
  });
  it('rejects a stale deposit snapshot without creating an orphan refund',async()=>{
    const id=await booking();const raced=envWithHookBefore(/UPDATE bookings SET status = 'cancelled'/,()=>env.DB.prepare('UPDATE bookings SET deposit_amount=75000 WHERE id=?').bind(id).run());
    expect((await call(id,{paymentMethod:'cash'},raced)).status).toBe(409);expect((await row(id)).status).toBe('pending');expect((await refunds()).results).toHaveLength(0);
  });
  it('rolls back refund and status when writing the audit fails',async()=>{
    const id=await booking();await env.DB.exec("CREATE TRIGGER fail_refund_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END");
    try {expect((await call(id,{paymentMethod:'cash'})).status).toBe(500);expect((await row(id)).status).toBe('pending');expect((await refunds()).results).toHaveLength(0);}
    finally {await env.DB.exec('DROP TRIGGER fail_refund_audit');}
  });
});
