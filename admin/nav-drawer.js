// admin/nav-drawer.js
// Menu items are gated by permission keys (GET /api/auth/me -> permissions).
// This is UX only: every API re-checks the same key server-side.
// `perm` is one key, an array meaning "any of these keys", or
// `{ all: [...], any: [...] }` meaning every `all` key AND at least one
// `any` key (either list may be omitted). Use `all` for permissions every
// on-load API call on the page needs beyond the page's own any-of gate.
const NAV_GROUPS = [
  {
    label: 'Tài sản & Kho',
    items: [
      { page: 'asset-config.html', label: 'Danh mục & vị trí', icon: '🗂️', perm: { all: ['assets.view', 'bookings.view'] } },
      { page: 'asset-source-data.html', label: 'Hồ sơ nguồn', icon: '📄', perm: 'assets.view' },
      { page: 'assets.html', label: 'Danh mục tài sản', icon: '🏷️', perm: 'assets.view' },
      { page: 'asset-inventory.html', label: 'Kiểm kê tài sản', icon: '📦', perm: 'assets.view' },
      { page: 'asset-inventory-stock.html', label: 'Kho', icon: '📦', perm: 'assets.view' },
    ],
  },
  {
    label: 'Vận hành',
    items: [
      { page: 'dashboard.html', label: 'Tổng quan số liệu', icon: '📊', perm: 'dashboard.view' },
      { page: 'finance.html', label: 'Sổ thu chi', icon: '💵', perm: 'finance.view_income' },
      { page: 'reception.html', label: 'Vận hành hôm nay', icon: '🛎️', perm: 'bookings.view' },
      { page: 'dine-in-orders.html', label: 'Order ăn uống', icon: '🍽️', perm: 'dine_in.view' },
      { page: 'gio-xanh.html', label: 'Giờ Xanh Hiền Lê', icon: '🌿', perm: 'gio_xanh.view' },
    ],
  },
  {
    label: 'Khách hàng & CRM',
    items: [
      { page: 'customers.html', label: 'Danh sách khách hàng', icon: '👥', perm: 'customers.view' },
      { page: 'templates.html', label: 'Kho template', icon: '✉️', perm: 'templates.view' },
    ],
  },
  {
    label: 'Cấu hình & Quản trị',
    items: [
      { page: 'manager.html', label: 'Cấu hình khuyến mãi', icon: '🎁', perm: 'promo_config.view' },
      { page: 'catalog.html', label: 'Bảng giá dịch vụ', icon: '💰', perm: ['settings.view', 'settings.catalog'] },
      { page: 'finance-categories.html', label: 'Danh mục Sổ thu chi', icon: '🏷️', perm: { all: ['settings.finance_categories', 'finance.view_income'] } },
      { page: 'dine-in-menu.html', label: 'Menu quán', icon: '📋', perm: 'settings.dine_in_menu' },
      { page: 'audit-log.html', label: 'Nhật ký thao tác', icon: '📜', perm: 'audit.view' },
      { page: 'cancellation-policy.html', label: 'Chính sách hoàn cọc', icon: '🔄', perm: ['settings.view', 'settings.cancellation_policy'] },
      { page: 'rooms.html', label: 'Quản lý phòng', icon: '🛏️', perm: { any: ['settings.view', 'settings.rooms'], all: ['bookings.view'] } },
      { page: 'users.html', label: 'Phân quyền', icon: '🔑', perm: 'users.manage' },
    ],
  },
];

// Reuse the existing permission contracts while changing information architecture.
const itemsByPage = Object.fromEntries(NAV_GROUPS.flatMap(g => g.items).map(i => [i.page, i]));
NAV_GROUPS.splice(0, NAV_GROUPS.length, ...[
 ['Vận hành', ['reception','dine-in-orders','gio-xanh']],
 ['Khách hàng', ['customers','templates','manager']],
 ['Tài chính', ['dashboard','finance']],
 ['Kho & tài sản', ['asset-inventory-stock','asset-inventory','assets','asset-source-data','asset-config']],
 ['Cài đặt', ['rooms','catalog','dine-in-menu','cancellation-policy','finance-categories','users','audit-log']],
].map(([label,pages]) => ({label, items:pages.map(p => itemsByPage[p+'.html'])})));

const ROLE_URL_PREFIX = { admin: '/manager', manager: '/manager', reception: '/reception', observer: '/observer' };

// Page file -> clean URL slug under /manager, /reception, /observer (see _redirects).
const PAGE_SLUG = { 'dashboard.html': 'dashboard', 'dine-in-orders.html': 'dine-in-orders', 'gio-xanh.html': 'gio-xanh', 'finance.html': 'finance', 'finance-categories.html': 'finance-categories', 'dine-in-menu.html': 'dine-in-menu', 'customers.html': 'customers', 'templates.html': 'templates', 'manager.html': 'config', 'catalog.html': 'catalog', 'audit-log.html': 'audit-log', 'cancellation-policy.html': 'cancellation-policy', 'rooms.html': 'rooms', 'users.html': 'users', 'change-password.html': 'change-password', 'security.html': 'security', 'asset-config.html': 'asset-config', 'asset-source-data.html': 'asset-source-data', 'assets.html': 'assets', 'asset-inventory.html': 'asset-inventory', 'asset-inventory-stock.html': 'asset-inventory-stock' };
const SLUG_PAGE = Object.fromEntries(Object.entries(PAGE_SLUG).map(([file, slug]) => [slug, file]));
const CLEAN_URL_PREFIXES = ['manager', 'reception', 'observer'];

// Pages every signed-in user may open, and detail pages not in the menu.
const PAGE_ALWAYS_ALLOWED = ['change-password.html', 'security.html'];
const PAGE_EXTRA_PERMS = {
  'dine-in-order-detail.html': 'dine_in.view',
  'gio-xanh-detail.html': 'gio_xanh.view',
};

// True when `permissions` satisfies `perm`: a key, an any-of array of keys,
// or `{ all, any }` (every `all` key present AND at least one `any` key
// present; either list may be omitted from the object form).
function allows(permissions, perm) {
  if (perm && typeof perm === 'object' && !Array.isArray(perm)) {
    const allOk = !perm.all || perm.all.every((p) => permissions.includes(p));
    const anyOk = !perm.any || perm.any.some((p) => permissions.includes(p));
    return allOk && anyOk;
  }
  return Array.isArray(perm) ? perm.some((p) => permissions.includes(p)) : permissions.includes(perm);
}

function currentPageFile() {
  return window.location.pathname.split('/').pop();
}

// Resolves the physical admin/*.html file behind the current URL, for both
// the raw form (/admin/users, /admin/users.html) and the clean role-prefixed
// form (/manager, /manager/config, /observer/assets).
function resolvePageFile() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length > 0 && CLEAN_URL_PREFIXES.includes(segments[0])) {
    if (segments.length === 1) return 'reception.html';
    return SLUG_PAGE[segments[1]] || `${segments[1].replace(/\.html$/, '')}.html`;
  }
  const last = currentPageFile() || 'reception';
  return last.endsWith('.html') ? last : `${last}.html`;
}

function urlFor(role, pageFile) {
  const prefix = ROLE_URL_PREFIX[role] || '/reception';
  if (pageFile === 'reception.html') return prefix;
  return `${prefix}/${PAGE_SLUG[pageFile]}`;
}

function requiredPermForPage(pageFile) {
  if (PAGE_ALWAYS_ALLOWED.includes(pageFile)) return null;
  if (PAGE_EXTRA_PERMS[pageFile]) return PAGE_EXTRA_PERMS[pageFile];
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => i.page === pageFile);
    if (item) return item.perm;
  }
  return null;
}

// Sends the user to the first page they may see when they lack the current
// page's permission. "Vận hành hôm nay" comes first when allowed, then menu order.
function guardPage(role, permissions) {
  const needed = requiredPermForPage(resolvePageFile());
  if (!needed || allows(permissions, needed)) return true;
  const items = NAV_GROUPS.flatMap((g) => g.items);
  const home = items.find((i) => i.page === 'reception.html');
  const first = [home, ...items].find((i) => i && allows(permissions, i.perm));
  document.documentElement.style.visibility = 'hidden';
  window.location.replace(first ? urlFor(role, first.page) : urlFor(role, 'change-password.html'));
  return false;
}

function buildDrawer(role, username, permissions) {
  const page = resolvePageFile();

  const topbar = document.createElement('div');
  topbar.className = 'nav-topbar';
  const brand = document.createElement('span');
  brand.className = 'nav-brand';
  brand.textContent = 'Hiền Lê Garden';
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'nav-toggle';
  toggleBtn.setAttribute('aria-label', 'Mở menu');
  toggleBtn.textContent = '☰';
  topbar.appendChild(brand);
  topbar.appendChild(toggleBtn);

  const overlay = document.createElement('div');
  overlay.className = 'nav-drawer-overlay';

  const drawer = document.createElement('nav');
  drawer.className = 'nav-drawer';
  drawer.id = 'adminNavigation';
  drawer.setAttribute('aria-label', 'Điều hướng quản trị');
  toggleBtn.setAttribute('aria-controls', drawer.id);
  toggleBtn.setAttribute('aria-expanded', 'false');

  const drawerHeader = document.createElement('div');
  drawerHeader.className = 'nav-drawer-header';
  const drawerTitle = document.createElement('strong');
  drawerTitle.textContent = 'Hiền Lê Garden';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'nav-drawer-close';
  closeBtn.setAttribute('aria-label', 'Đóng menu');
  closeBtn.textContent = '✕';
  drawerHeader.appendChild(drawerTitle);
  drawerHeader.appendChild(closeBtn);
  drawer.appendChild(drawerHeader);

  const drawerBody = document.createElement('div');
  drawerBody.className = 'nav-drawer-body';
  NAV_GROUPS.forEach((group) => {
    const visibleItems = group.items.filter((item) => allows(permissions, item.perm));
    if (visibleItems.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'nav-drawer-group';
    const groupLabel = document.createElement('div');
    groupLabel.className = 'nav-drawer-group-label';
    groupLabel.textContent = group.label;
    groupEl.appendChild(groupLabel);

    visibleItems.forEach((item) => {
      const a = document.createElement('a');
      a.href = urlFor(role, item.page);
      a.className = 'nav-drawer-item' + (item.page.replace(/\.html$/, '') === page.replace(/\.html$/, '') ? ' active' : '');
      a.textContent = `${item.icon} ${item.label}`;
      if (item.page === page) a.setAttribute('aria-current', 'page');
      groupEl.appendChild(a);
    });

    drawerBody.appendChild(groupEl);
  });
  drawer.appendChild(drawerBody);

  const drawerFooter = document.createElement('div');
  drawerFooter.className = 'nav-drawer-footer';
  const userLine = document.createElement('div');
  userLine.textContent = `${username} · ${({admin:'Quản trị viên',manager:'Quản lý',reception:'Lễ tân',observer:'Người quan sát'})[role] || role}`;
  const footerLinks = document.createElement('div');
  footerLinks.className = 'nav-drawer-footer-links';
  const homeLink = document.createElement('a');
  homeLink.href = '/';
  homeLink.target = '_blank';
  homeLink.rel = 'noopener';
  homeLink.textContent = '🏠 Trang chủ';
  const changePasswordLink = document.createElement('a');
  changePasswordLink.href = urlFor(role, 'change-password.html');
  changePasswordLink.textContent = 'Đổi mật khẩu';
  if (page === 'change-password.html') changePasswordLink.className = 'active';
  const securityLink = document.createElement('a');
  securityLink.href = urlFor(role, 'security.html');
  securityLink.textContent = 'Bảo mật tài khoản (2FA)';
  if (page === 'security.html') securityLink.className = 'active';
  const logoutLink = document.createElement('a');
  logoutLink.href = '#';
  logoutLink.textContent = 'Đăng xuất';
  logoutLink.addEventListener('click', async (event) => {
    event.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/admin';
  });
  footerLinks.appendChild(homeLink);
  footerLinks.appendChild(changePasswordLink);
  footerLinks.appendChild(securityLink);
  footerLinks.appendChild(logoutLink);
  drawerFooter.appendChild(userLine);
  drawerFooter.appendChild(footerLinks);
  drawer.appendChild(drawerFooter);

  document.body.prepend(topbar);
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
  document.body.classList.add('has-nav-drawer');


  const bottom = document.createElement('nav');
  bottom.className = 'nav-bottom';
  bottom.setAttribute('aria-label', 'Truy cập nhanh');
  ['reception','dine-in-orders','gio-xanh','customers','finance']
    .map(p => itemsByPage[p+'.html']).filter(i => allows(permissions,i.perm)).slice(0,4).forEach(item => {
      const link = document.createElement('a');
      link.href = urlFor(role,item.page);
      const icon = document.createElement('span'); icon.textContent = item.icon; icon.setAttribute('aria-hidden','true');
      link.append(icon, ({'reception.html':'Hôm nay','dine-in-orders.html':'Order','gio-xanh.html':'Giờ Xanh','customers.html':'Khách hàng','finance.html':'Thu chi'})[item.page]);
      if(item.page === page) { link.className='active'; link.setAttribute('aria-current','page'); }
      bottom.append(link);
    });
  const more = document.createElement('button');
  more.type='button'; more.textContent='☰ Thêm';
  more.setAttribute('aria-controls', drawer.id); more.setAttribute('aria-expanded','false');
  bottom.append(more); document.body.append(bottom);
  const desktop = window.matchMedia('(min-width:1024px)');
  let returnFocus;
  let blocked = [];
  let oldOverflow = '';
  function openDrawer() {
    if(desktop.matches) return;
    returnFocus = document.activeElement;
    drawer.inert = false;
    drawer.setAttribute('role','dialog'); drawer.setAttribute('aria-modal','true');
    drawer.classList.add('open'); overlay.classList.add('open');
    blocked = [...document.body.children].filter(el => el !== drawer && el !== overlay && !el.inert);
    blocked.forEach(el => { el.inert=true; });
    oldOverflow=document.body.style.overflow; document.body.style.overflow='hidden';
    toggleBtn.setAttribute('aria-expanded','true'); more.setAttribute('aria-expanded','true');
    closeBtn.focus();
  }
  function closeDrawer(restore = true) {
    const wasOpen=drawer.classList.contains('open');
    drawer.classList.remove('open'); overlay.classList.remove('open');
    drawer.removeAttribute('role'); drawer.removeAttribute('aria-modal');
    drawer.inert=!desktop.matches;
    blocked.forEach(el => { el.inert=false; }); blocked=[];
    if(wasOpen) document.body.style.overflow=oldOverflow;
    toggleBtn.setAttribute('aria-expanded','false'); more.setAttribute('aria-expanded','false');
    if(wasOpen && restore) returnFocus?.focus();
  }
  toggleBtn.addEventListener('click', openDrawer); more.addEventListener('click',openDrawer);
  closeBtn.addEventListener('click', () => closeDrawer()); overlay.addEventListener('click', () => closeDrawer());
  desktop.addEventListener('change', () => closeDrawer(false));
  closeDrawer(false);
  document.addEventListener('keydown', event => {
    if(!drawer.classList.contains('open')) return;
    if(event.key==='Escape') { event.preventDefault(); closeDrawer(); }
    if(event.key==='Tab') {
      const targets=[...drawer.querySelectorAll('a[href],button')].filter(el => el.getClientRects().length);
      const first=targets[0], last=targets.at(-1);
      if(event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus(); }
      else if(!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus(); }
    }
  });

}

// Admin pages must never run against a stale cached build. Browsers only
// auto-check for a new service worker script at most once every 24h, which
// is too slow while this admin section is under active development -- force
// an immediate check on every load so a fix like the /admin/ cache
// exclusion itself propagates on the very next visit, not up to a day later.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg) reg.update();
  }).catch(() => {});
}

(async () => {
  let res;
  try {
    res = await fetch('/api/auth/me');
  } catch (err) {
    return;
  }
  if (!res.ok) return;
  const { role, username, permissions = [] } = await res.json();
  if (!guardPage(role, permissions)) return;
  buildDrawer(role, username, permissions);
})();
