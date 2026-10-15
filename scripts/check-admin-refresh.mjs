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
// Pending count must not claim "0" before data arrives, and announces updates politely.
assert.match(await readFile(resolve(publicRoot, 'admin/reception.html'), 'utf8'), /id="pendingTabCount"[^>]*aria-live="polite"[^>]*>…</);
try {
  for (const role of ['admin','manager','reception','observer']) {
    const context = await browser.newContext();
    const permissions = role === 'admin' ? PERMISSION_KEYS : ROLE_DEFAULTS[role];
    await context.route('https://**/*', route => route.abort());
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      // Slow staff-booking response so the in-flight (double-submit) state is observable.
      if (path === '/api/bookings/staff') await new Promise(r => setTimeout(r, 600));
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
    // Deep link to a permission-gated tab: kept when allowed, rewritten once permissions say no.
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`${base}/admin/reception.html#uu-dai`);
    await page.waitForFunction(() => document.querySelector('#pendingList').textContent.length > 0);
    if (role === 'observer') {
      assert.equal(await page.evaluate(() => location.hash),'#viec');
      assert.equal(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-tab'),'viec');
    } else {
      assert.equal(await page.evaluate(() => location.hash),'#uu-dai');
      assert.equal(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-tab'),'uu-dai');
    }
    await page.goto(`${base}/admin/reception.html`);
    for (const width of [390,800,1440]) {
      await page.setViewportSize({width,height:900});
      await page.goto(`${base}/admin/reception.html`);
      await page.waitForSelector('.nav-drawer');
      await page.waitForFunction(() => document.querySelector('#pendingList').textContent.length > 0);
      assert.equal(await page.locator('#pendingTabCount').textContent(),'1');
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
          let posts = 0;
          const countPost = r => { if (r.url().endsWith('/api/bookings/staff') && r.method() === 'POST') posts++; };
          page.on('request', countPost);
          const sent = page.waitForRequest(r => r.url().endsWith('/api/bookings/staff') && r.method() === 'POST');
          // Double submit while the request is in flight: exactly one POST, dialog stays open.
          await page.locator('#newBookingForm').evaluate(f => { f.requestSubmit(); f.requestSubmit(); });
          assert.equal((await sent).postDataJSON().guestName,'Khách kiểm thử');
          assert.equal(await page.locator('#newBookingForm button[type=submit]').isDisabled(),true);
          assert.equal(await page.locator('#newBookingForm').getAttribute('aria-busy'),'true');
          await page.locator('[name=guestName]').press('Escape');
          await page.locator('#newBookingOverlay').click({position:{x:5,y:5}});
          assert.equal(await page.locator('#newBookingOverlay').isVisible(),true);
          await page.locator('#newBookingOverlay').waitFor({state:'hidden'});
          page.off('request', countPost);
          assert.equal(posts,1,`${role}: duplicate staff booking POST`);
          assert.equal(await page.locator('#newBookingForm button[type=submit]').isDisabled(),false);
        }
      }
    }
    assert.deepEqual(errors,[],`${role}: browser errors`);
    await context.close();
  }
  // PR B: service orders page — list, new order form totals and deposit warning, detail actions per role.
  for (const role of ['manager', 'reception', 'observer']) {
    const context = await browser.newContext();
    const permissions = ROLE_DEFAULTS[role];
    await context.route('https://**/*', (r) => r.abort());
    const order = { id: 7, version: 'v1', quoteNumber: 'BG-2026-0007', orderType: 'dat_tiec', customerName: 'Chị Lan', phone: role === 'observer' ? null : '0900000000', organization: 'Công ty A',
      eventDate: '2026-12-20', eventTime: '18:30', guestCount: 50, venueNote: 'Sân vườn', bookingId: null, primaryCategory: 'bep_hien_le', depositAmount: 3000000,
      status: 'confirmed', total: 11000000, isHidden: false, note: null, quoteValidDays: 7, requestedDeposit: 3300000, createdAt: '2026-10-15T00:00:00Z',
      items: [{ id: 1, description: 'Set menu', quantity: 5, unitPrice: 2000000, financeCategory: 'bep_hien_le' }, { id: 2, description: 'Nước', quantity: 1, unitPrice: 1000000, financeCategory: 'hien_le_drinks' }],
      deposits: [{ id: 1, amount: 3000000, paymentMethod: 'transfer', note: null, createdAt: '2026-10-15T00:00:00Z', voidedAt: null }], categoryTotals: {} };
    await context.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { role, username: 'Kiểm tra đơn', permissions } });
      if (path === '/api/service-orders/categories') return route.fulfill({ json: [{ slug: 'bep_hien_le', label: 'Bếp Hiền Lê', isActive: true }, { slug: 'hien_le_drinks', label: 'Hiền Lê Drinks', isActive: true }] });
      if (path === '/api/service-orders') return route.fulfill({ json: new URL(route.request().url()).searchParams.get('status') === 'open' ? [order] : [] });
      if (path === '/api/service-orders/7') return route.fulfill({ json: order });
      if (path === '/api/quote-settings') return route.fulfill({ json: { defaultValidDays: 7, defaultDepositPercent: 30 } });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/admin/service-orders.html`);
      await page.waitForSelector('#openOrdersList .booking-card');
      assert.equal(await page.locator('#openNewOrderBtn').isVisible(), role !== 'observer');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `service-orders ${role}/${width}: overflow`);
      await page.locator('#openOrdersList .booking-card button').first().click();
      await page.waitForSelector('#orderDetailOverlay:not(.hidden)');
      assert.equal(await page.getByRole('button', { name: 'Xoá cọc' }).count(), role === 'manager' ? 1 : 0);
      assert.equal(await page.getByRole('button', { name: 'Huỷ đơn' }).count(), role === 'manager' ? 1 : 0);
      assert.equal(await page.getByRole('button', { name: 'Tất toán' }).count(), role === 'observer' ? 0 : 1);
      await page.screenshot({ path: `test-results/admin-refresh/service-orders-${role}-${width}.png`, fullPage: true });
      await page.keyboard.press('Escape');
    }
    if (role !== 'observer') {
      await page.locator('#openNewOrderBtn').click();
      await page.locator('#itemsBody tr input').first().fill('Set menu');
      await page.locator('#itemsBody tr input').nth(1).fill('2');
      await page.locator('#itemsBody tr input').nth(2).fill('500000');
      assert.match(await page.locator('#itemsTotals').textContent(), /Tổng đơn: 1\.000\.000đ/);
    }
    assert.deepEqual(errors, [], `service-orders ${role}: browser errors`);
    await context.close();
  }
  // PR A: editing a linked finance row locks the financial fields; a manual row stays editable.
  {
    const context = await browser.newContext();
    await context.route('https://**/*', (r) => r.abort());
    const tx = (id, linked) => ({ id, type: 'income', category: 'dich_vu', amount: 400000, note: `Dòng ${id}`, transactionDate: '2026-10-01', status: 'confirmed', createdBy: 'fx', createdAt: '2026-10-01T00:00:00Z', voidedAt: null, isHidden: false, linked });
    await context.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { role: 'admin', username: 'Kiểm tra Thu chi', permissions: PERMISSION_KEYS } });
      if (path === '/api/finance/categories') return route.fulfill({ json: [{ id: 1, slug: 'dich_vu', label: 'Lưu trú Hiền Lê', type: 'income', isActive: true }] });
      if (path === '/api/finance/transactions') return route.fulfill({ json: { transactions: [tx(1, true), tx(2, false)], total: 2, page: 1, pageSize: 25, sumIncome: 800000, sumExpense: 0, categoryTotals: { dich_vu: { income: 800000, expense: 0 } }, chartRows: [] } });
      if (path === '/api/finance/summary') return route.fulfill({ json: { month: '2026-10', openingBalance: 0, openingBalanceSource: 'none', totalIncome: 800000, totalExpense: 0, netChange: 800000, closingBalance: 800000 } });
      if (path === '/api/finance/opening-balance') return route.fulfill({ json: { period: '2026-10', openingBalance: null, setBy: null, setAt: null } });
      if (path === '/api/finance/receipts-usage') return route.fulfill({ json: { totalBytes: 0, thresholdBytes: 1, overThreshold: false } });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/admin/finance.html`);
    await page.waitForSelector('#financeTable tbody tr');
    const editButtons = page.locator('#financeTable tbody button[title="Sửa"]');
    await editButtons.nth(0).click();
    assert.equal(await page.locator('#financeForm [name="amount"]').isDisabled(), true);
    assert.equal(await page.locator('#financeForm [name="category"]').isDisabled(), true);
    assert.equal(await page.locator('#financeForm [name="note"]').isDisabled(), false);
    assert.equal(await page.locator('#financeLinkedHint').isVisible(), true);
    await page.locator('#financeFormCloseBtn').click();
    await editButtons.nth(1).click();
    assert.equal(await page.locator('#financeForm [name="amount"]').isDisabled(), false);
    assert.equal(await page.locator('#financeLinkedHint').isVisible(), false);
    assert.deepEqual(errors, [], 'finance page: browser errors');
    await context.close();
  }
  // Every HTML page: inspect shared layout without invoking unrelated page APIs.
  const context = await browser.newContext();
  const permissions = PERMISSION_KEYS;
  await context.route('https://**/*', r => r.abort());
  await context.route('**/api/**', r => {
    const path = new URL(r.request().url()).pathname;
    const booking = {id:1,guestName:'Khách kiểm thử',phone:'0900000000',roomName:'Triangle 01',guestsCount:2,checkIn:'2026-12-01',checkOut:'2026-12-02',nationality:'Việt Nam',idNumber:'000000000000'};
    const invoice = {...booking,status:'closed',paymentStatus:'paid',tableLabel:'Bàn 01',openedAt:'2026-12-01T03:00:00Z',closedAt:'2026-12-01T05:00:00Z',paymentMethod:'cash',totalAmount:100000,items:[{status:'posted',name:'Dịch vụ kiểm thử',quantity:2,unitPrice:50000,amount:100000}]};
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
  console.log('PASS: four synthetic roles × three widths; tabs/hash/keyboard, gated-tab deep link + hash normalization, pending count, permissions, navigation focus trap, booking creation with double-submit guard; every Admin HTML shell at three widths and three populated print templates. Synthetic API data; unrelated page controllers disabled in shell checks.');
} finally { await browser.close(); server.close(); }
