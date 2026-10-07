// Local UI regression checks with synthetic data; never connects to production.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { PERMISSION_KEYS, ROLE_DEFAULTS } from '../lib/permissions.js';

// Exercise the upload artifact, including newly tracked scripts, rather than source.
const publicRoot = resolve(process.argv[2] || 'dist');

const server = createServer(async (req, res) => {
  try {
    const path = resolve(publicRoot, `.${new URL(req.url, 'http://localhost').pathname}`);
    if (!path.startsWith(resolve(publicRoot, 'admin') + '\\') && !path.startsWith(resolve(publicRoot, 'admin') + '/')) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir('test-results/admin-refresh', { recursive:true });
try {
  for (const role of ['admin','manager','reception','observer']) {
    const context = await browser.newContext();
    const permissions = role === 'admin' ? PERMISSION_KEYS : ROLE_DEFAULTS[role];
    await context.route('https://**/*', route => route.abort());
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      let body = [];
      if (path === '/api/auth/me') body = {role,username:'Kiểm tra giao diện',permissions};
      if (path === '/api/bookings' && new URL(route.request().url()).searchParams.get('status') === 'pending') body = [{id:1,guestName:'Khách thử nghiệm',phone:'0900000000',roomType:'triangle',checkIn:'2026-12-01',checkOut:'2026-12-02',guestsCount:2,status:'pending',depositAmount:0,services:[],notes:'Dữ liệu giả lập để kiểm tra giao diện.'}];
      if (path === '/api/rooms') body = ['empty','booked','booked_deposited','occupied','used'].map((status,index) => ({id:index+1,name:`Triangle ${index+1}`,status,roomType:'triangle',pricePerNight:500000}));
      if (path === '/api/reception/reminders') body = {pendingNoDeposit:[],arrivingToday:[],roomsNotCleaned:[],thresholds:{}};
      if (path === '/api/availability') body = {availableRooms:[{id:1,name:'Phòng thử nghiệm'}]};
      if (path === '/api/bookings/staff') body = {id:1};
      route.fulfill({json:body});
    });
    const page = await context.newPage();
    const errors=[]; page.on('pageerror', e => errors.push(e.message));
    for (const width of [390,800,1440]) {
      await page.setViewportSize({width,height:900});
      await page.goto(`${base}/admin/reception.html`);
      await page.waitForSelector('.nav-drawer');
      await page.waitForFunction(() => document.querySelector('#pendingList').textContent.length > 0);
      assert.equal(await page.locator('#openNewBookingBtn').isVisible(), role !== 'observer');
      assert.equal(await page.locator('#tab-uu-dai').isVisible(), role !== 'observer');
      for (const tab of ['viec','dat-phong','so-do', ...(role === 'observer' ? [] : ['uu-dai'])]) {
        await page.locator(`#tab-${tab}`).click();
        assert.equal(await page.locator(`#panel-${tab}`).isVisible(),true);
        assert.equal(await page.locator('[role=tabpanel]:visible').count(),1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true, `${role}/${width}/${tab}: horizontal overflow`);
        await page.screenshot({path:`test-results/admin-refresh/${role}-${width}-${tab}.png`,fullPage:true});
      }
      await page.reload();
      await page.waitForSelector('.nav-drawer');
      assert.equal(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-tab'), role === 'observer' ? 'so-do':'uu-dai');
      await page.locator('#tab-viec').click();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#tab-dat-phong').getAttribute('aria-selected'),'true');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true, `${role}/${width}: horizontal overflow`);
      if (width < 1024) {
        await page.locator(width < 640 ? '.nav-bottom button':'.nav-toggle').click();
        assert.equal(await page.locator('.nav-drawer').evaluate(el => el.inert),false);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent),'Đăng xuất');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.className),'nav-drawer-close');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.nav-drawer').evaluate(el => el.inert),true);
      }
      if (role !== 'observer') {
        await page.locator('#openNewBookingBtn').click();
        assert.equal(await page.locator('#newBookingOverlay').isVisible(),true);
        await page.screenshot({path:`test-results/admin-refresh/${role}-${width}-new-booking.png`,fullPage:true});
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#newBookingOverlay').isVisible(),false);
        if (width === 1440) {
          await page.locator('#openNewBookingBtn').click();
          await page.locator('[name=guestName]').fill('Khách kiểm thử');
          await page.locator('[name=phone]').fill('0900000000');
          await page.locator('[name=checkIn]').fill('2026-12-01');
          await page.locator('[name=checkOut]').fill('2026-12-02');
          await page.locator('[name=roomType]').selectOption('triangle');
          await page.locator('#newBookingRoomId option[value="1"]').waitFor({state:'attached'});
          await page.locator('#newBookingRoomId').selectOption('1');
          const sent = page.waitForRequest(r => r.url().endsWith('/api/bookings/staff') && r.method() === 'POST');
          await page.locator('#newBookingForm button[type=submit]').click();
          assert.equal((await sent).postDataJSON().guestName,'Khách kiểm thử');
          await page.locator('#newBookingOverlay').waitFor({state:'hidden'});
        }
      }
    }
    assert.deepEqual(errors,[],`${role}: browser errors`);
    await context.close();
  }
  // Every HTML page: inspect shared layout without invoking unrelated page APIs.
  const context = await browser.newContext();
  const permissions = PERMISSION_KEYS;
  await context.route('https://**/*', r => r.abort());
  await context.route('**/api/**', r => {
    const path = new URL(r.request().url()).pathname;
    const booking = {id:1,guestName:'Khách kiểm thử',phone:'0900000000',roomName:'Triangle 01',guestsCount:2,checkIn:'2026-12-01',checkOut:'2026-12-02',nationality:'Việt Nam',idNumber:'000000000000'};
    const invoice = {...booking,status:'closed',tableLabel:'Bàn 01',openedAt:'2026-12-01T03:00:00Z',closedAt:'2026-12-01T05:00:00Z',paymentMethod:'cash',totalAmount:100000,items:[{status:'posted',name:'Dịch vụ kiểm thử',quantity:2,unitPrice:50000,amount:100000}]};
    r.fulfill({json:path === '/api/auth/me' ? {role:'admin',username:'Kiểm tra bố cục',permissions}:path.startsWith('/api/bookings/') ? booking:invoice});
  });
  await context.route('**/admin/*.js', r => /\/(nav-drawer|tabs|.*-print)\.js$/.test(r.request().url()) ? r.continue() : r.abort());
  const page = await context.newPage();
  for (const file of (await readdir(resolve(publicRoot, 'admin'))).filter(f => f.endsWith('.html'))) {
    for (const width of [390,800,1440]) {
      await page.setViewportSize({width,height:900});
      await page.goto(`${base}/admin/${file}?bookingId=1&orderId=1&sessionId=1`);
      if (file.endsWith('-print.html')) await page.locator('#formPrint h2').waitFor();
      if (await page.locator('script[src="/admin/nav-drawer.js"]').count()) await page.waitForSelector('.nav-drawer');
      if (!file.endsWith('-print.html')) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,`${file}/${width}: layout overflow`);
      await page.screenshot({path:`test-results/admin-refresh/layout-${file}-${width}.png`,fullPage:true});
    }
    if (file.endsWith('-print.html')) {
      await page.emulateMedia({media:'print'});
      await page.screenshot({path:`test-results/admin-refresh/print-${file}.png`,fullPage:true});
      await page.emulateMedia({media:'screen'});
    }
  }
  await context.close();
  console.log('PASS: four synthetic roles × three widths; tabs/hash/keyboard, permissions, navigation focus trap, booking creation; every Admin HTML shell at three widths and three populated print templates. Synthetic API data; unrelated page controllers disabled in shell checks.');
} finally { await browser.close(); server.close(); }
