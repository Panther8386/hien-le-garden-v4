// admin/nav-drawer.js
const NAV_GROUPS = [
  {
    label: 'Vận hành',
    items: [
      { page: 'dashboard.html', label: 'Tổng quan số liệu', icon: '📊', roles: ['manager', 'admin', 'observer'] },
      { page: 'finance.html', label: 'Sổ thu chi', icon: '💵', roles: ['manager', 'admin', 'observer'] },
      { page: 'reception.html', label: 'Vận hành hôm nay', icon: '🛎️', roles: ['reception', 'manager', 'admin', 'observer'] },
    ],
  },
  {
    label: 'Khách hàng & CRM',
    items: [
      { page: 'customers.html', label: 'Danh sách khách hàng', icon: '👥', roles: ['reception', 'manager', 'admin', 'observer'] },
      { page: 'templates.html', label: 'Kho template', icon: '✉️', roles: ['reception', 'manager', 'admin'] },
    ],
  },
  {
    label: 'Cấu hình & Quản trị',
    items: [
      { page: 'manager.html', label: 'Cấu hình khuyến mãi', icon: '🎁', roles: ['reception', 'manager', 'admin'] },
      { page: 'catalog.html', label: 'Bảng giá dịch vụ', icon: '💰', roles: ['reception', 'manager', 'admin', 'observer'] },
      { page: 'audit-log.html', label: 'Nhật ký thao tác', icon: '📜', roles: ['manager', 'admin'] },
      { page: 'cancellation-policy.html', label: 'Chính sách hoàn cọc', icon: '🔄', roles: ['reception', 'manager', 'admin', 'observer'] },
      { page: 'users.html', label: 'Quản lý user', icon: '🔑', roles: ['manager', 'admin'] },
    ],
  },
];

const ROLE_URL_PREFIX = { admin: '/manager', manager: '/manager', reception: '/reception', observer: '/observer' };

function currentPageFile() {
  return window.location.pathname.split('/').pop();
}

function buildDrawer(role, username) {
  const page = currentPageFile();
  const prefix = ROLE_URL_PREFIX[role] || '/reception';
  const pageSlug = { 'dashboard.html': 'dashboard', 'finance.html': 'finance', 'customers.html': 'customers', 'templates.html': 'templates', 'manager.html': 'config', 'catalog.html': 'catalog', 'audit-log.html': 'audit-log', 'cancellation-policy.html': 'cancellation-policy', 'users.html': 'users', 'change-password.html': 'change-password' };
  function urlFor(pageFile) {
    if (pageFile === 'reception.html') return prefix;
    return `${prefix}/${pageSlug[pageFile]}`;
  }

  const topbar = document.createElement('div');
  topbar.className = 'nav-topbar';
  const brand = document.createElement('span');
  brand.className = 'nav-brand';
  brand.textContent = 'Hiền Lê Garden CRM';
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
    const visibleItems = group.items.filter((item) => item.roles.includes(role));
    if (visibleItems.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'nav-drawer-group';
    const groupLabel = document.createElement('div');
    groupLabel.className = 'nav-drawer-group-label';
    groupLabel.textContent = group.label;
    groupEl.appendChild(groupLabel);

    visibleItems.forEach((item) => {
      const a = document.createElement('a');
      a.href = urlFor(item.page);
      a.className = 'nav-drawer-item' + (item.page.replace(/\.html$/, '') === page.replace(/\.html$/, '') ? ' active' : '');
      a.textContent = `${item.icon} ${item.label}`;
      groupEl.appendChild(a);
    });

    drawerBody.appendChild(groupEl);
  });
  drawer.appendChild(drawerBody);

  const drawerFooter = document.createElement('div');
  drawerFooter.className = 'nav-drawer-footer';
  const userLine = document.createElement('div');
  userLine.textContent = `👤 ${username}`;
  const footerLinks = document.createElement('div');
  footerLinks.className = 'nav-drawer-footer-links';
  const homeLink = document.createElement('a');
  homeLink.href = '/';
  homeLink.target = '_blank';
  homeLink.rel = 'noopener';
  homeLink.textContent = '🏠 Trang chủ';
  const changePasswordLink = document.createElement('a');
  changePasswordLink.href = urlFor('change-password.html');
  changePasswordLink.textContent = 'Đổi mật khẩu';
  if (page === 'change-password.html') changePasswordLink.className = 'active';
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
  footerLinks.appendChild(logoutLink);
  drawerFooter.appendChild(userLine);
  drawerFooter.appendChild(footerLinks);
  drawer.appendChild(drawerFooter);

  document.body.prepend(topbar);
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
  document.body.classList.add('has-nav-drawer');

  function openDrawer() {
    drawer.classList.add('open');
    overlay.classList.add('open');
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }

  toggleBtn.addEventListener('click', openDrawer);
  closeBtn.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
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
  const { role, username } = await res.json();
  buildDrawer(role, username);
})();
