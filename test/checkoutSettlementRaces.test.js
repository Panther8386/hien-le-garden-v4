import { it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSession } from '../lib/auth.js';
import { onRequestPost as closeGX } from '../functions/api/gio-xanh-sessions/[id]/close.js';
import { onRequestPost as checkout } from '../functions/api/bookings/[id]/check-out.js';
import { onRequestPost as addGX } from '../functions/api/gio-xanh-sessions/[id]/items/index.js';
import { onRequestPatch as voidGX } from '../functions/api/gio-xanh-sessions/[id]/items/[itemId].js';
import { onRequestPost as addService } from '../functions/api/bookings/[id]/services/index.js';
import { onRequestPatch as voidService } from '../functions/api/bookings/[id]/services/[itemId].js';
import { envWithHookBefore } from './helpers/raceEnv.js';
let token;
beforeEach(async () => {
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM gio_xanh_session_items');
  await env.DB.exec('DELETE FROM gio_xanh_sessions');
  await env.DB.exec('DELETE FROM booking_service_items');
  await env.DB.exec('DELETE FROM booking_deposits');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('DELETE FROM audit_log');
  await env.DB.exec('DELETE FROM finance_transactions');
  await env.DB.exec('UPDATE rooms SET needs_cleaning=0, needs_cleaning_since=NULL');
  await env.DB.prepare("INSERT INTO staff_accounts(id,username,password_hash,role,created_at) VALUES(1,'audit','x','admin','2026-10-09')").run();
  token = await createSession(env.DB, 1);
});
for (const kind of ['gx', 'booking']) {
  for (const operation of ['add', 'void']) {
    it(`${kind} ${operation} cannot write after a concurrent close`, async () => {
      const gx=kind==='gx';
      const parent=gx?'gio_xanh_sessions':'bookings';
      const table=gx?'gio_xanh_session_items':'booking_service_items';
      const inserted=await env.DB.prepare(gx
        ? "INSERT INTO gio_xanh_sessions(room_id,guest_name,status,opened_by,opened_at) VALUES(1,'Audit','open','audit','2026-10-09')"
        : "INSERT INTO bookings(guest_name,phone,room_type,room_id,check_in,check_out,status,source,created_at) VALUES('Audit','0000000000','triangle',1,'2026-09-10','2026-09-11','checked_in','phone','2026-10-09')").run();
      const id=inserted.meta.last_row_id;
      const menu=await env.DB.prepare("INSERT INTO dine_in_menu_items(name,category,price,updated_at) VALUES('Audit drink','do_uong',25000,'2026-10-09')").run();
      const item=await env.DB.prepare(gx
        ? "INSERT INTO gio_xanh_session_items(session_id,source,source_id,name,unit_price,quantity,amount,status,created_by,created_at) VALUES(?,'mon_an_uong',1,'Audit',25000,1,25000,'posted','audit','2026-10-09')"
        : "INSERT INTO booking_service_items(booking_id,name,unit_price,quantity,amount,status,created_by,created_at,payment_status) VALUES(?,'Audit',25000,1,25000,'posted','audit','2026-10-09','pending')").bind(id).run();
      const hook=operation==='add'?new RegExp(`INSERT INTO ${table}`):/INSERT INTO audit_log/;
      const raced=envWithHookBefore(hook,()=>env.DB.prepare(`UPDATE ${parent} SET status=? WHERE id=?`).bind(gx?'closed':'checked_out',id).run());
      const body=gx?{source:'mon_an_uong',sourceId:menu.meta.last_row_id,quantity:1}:{dineInMenuItemId:menu.meta.last_row_id,unitPrice:25000,quantity:1,paid:true,paymentMethod:'cash'};
      const req=new Request('https://audit.invalid',{method:operation==='add'?'POST':'PATCH',headers:{Cookie:`session=${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const handler=gx?(operation==='add'?addGX:voidGX):(operation==='add'?addService:voidService);
      const response=await handler({request:req,env:raced,params:{id:String(id),itemId:String(item.meta.last_row_id)}});
      expect(response.status).toBe(409);
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE status='posted'`).first()).n).toBe(1);
      expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM finance_transactions').first()).n).toBe(0);
      expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action_type='service_void'").first()).n).toBe(0);
    });
  }
}
function request() { return new Request('https://audit.invalid', {method:'POST',headers:{Cookie:`session=${token}`,'Content-Type':'application/json'},body:JSON.stringify({paymentMethod:'cash'})}); }
function interleave(callback) { return envWithHookBefore(/INSERT INTO finance_transactions/, callback); }
it.each(['add', 'void'])('Giờ Xanh rejects a stale total after concurrent %s, then retries correctly', async mutation => {
  const session=await env.DB.prepare("INSERT INTO gio_xanh_sessions(room_id,guest_name,status,opened_by,opened_at) VALUES(1,'Audit','open','audit','2026-10-09')").run();
  const id=session.meta.last_row_id;
  const add=amount=>env.DB.prepare("INSERT INTO gio_xanh_session_items(session_id,source,source_id,name,unit_price,quantity,amount,status,created_by,created_at) VALUES(?,'gio_combo',1,'Audit',?,1,?,'posted','audit','2026-10-09')").bind(id,amount,amount).run();
  await add(130000);
  const other=await add(25000);
  const response=await closeGX({request:request(),params:{id:String(id)},env:interleave(()=>mutation==='add'?add(25000):env.DB.prepare("UPDATE gio_xanh_session_items SET status='voided' WHERE id=?").bind(other.meta.last_row_id).run())});
  expect(response.status).toBe(409);
  expect((await env.DB.prepare('SELECT status FROM gio_xanh_sessions WHERE id=?').bind(id).first()).status).toBe('open');
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM finance_transactions WHERE category='gio_xanh_hien_le'").first()).n).toBe(0);
  expect((await closeGX({request:request(),params:{id:String(id)},env})).status).toBe(200);
  const row=await env.DB.prepare('SELECT total_amount AS collected,(SELECT SUM(amount) FROM gio_xanh_session_items WHERE session_id=? AND status=\'posted\') AS due FROM gio_xanh_sessions WHERE id=?').bind(id,id).first();
  expect(row.collected).toBe(row.due);
});
it.each(['add', 'void'])('Booking rejects a stale service snapshot after concurrent %s, then retries correctly', async mutation => {
  const booking=await env.DB.prepare("INSERT INTO bookings(guest_name,phone,room_type,room_id,check_in,check_out,status,source,created_at) VALUES('Audit','0000000000','triangle',1,'2026-09-10','2026-09-11','checked_in','phone','2026-10-09')").run();
  const id=booking.meta.last_row_id;
  const add=amount=>env.DB.prepare("INSERT INTO booking_service_items(booking_id,name,unit_price,quantity,amount,status,created_by,created_at,payment_status) VALUES(?,'Audit',?,1,?,'posted','audit','2026-10-09','pending')").bind(id,amount,amount).run();
  await add(50000);
  const other=await add(25000);
  const response=await checkout({request:request(),params:{id:String(id)},env:interleave(()=>mutation==='add'?add(25000):env.DB.prepare("UPDATE booking_service_items SET status='voided' WHERE id=?").bind(other.meta.last_row_id).run())});
  expect(response.status).toBe(409);
  expect((await env.DB.prepare('SELECT status FROM bookings WHERE id=?').bind(id).first()).status).toBe('checked_in');
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM booking_service_items WHERE booking_id=? AND payment_status='paid'").bind(id).first()).n).toBe(0);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM finance_transactions').first()).n).toBe(0);
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action_type='booking_checkout'").first()).n).toBe(0);
  expect((await env.DB.prepare('SELECT needs_cleaning AS cleaning FROM rooms WHERE id=1').first()).cleaning).toBe(0);
  const retry=await checkout({request:request(),params:{id:String(id)},env});
  expect(retry.status).toBe(200);
  const result=await retry.json();
  const paid=await env.DB.prepare("SELECT SUM(amount) AS total FROM booking_service_items WHERE booking_id=? AND payment_status='paid'").bind(id).first();
  expect(result.servicesDue).toBe(paid.total);
});
