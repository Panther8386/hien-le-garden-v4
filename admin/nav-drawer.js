// admin/nav-drawer.js
const NAV_GROUPS = [
  {
    label: 'Vận hành',
    items: [
      { href: 'dashboard.html', label: 'Tổng quan số liệu', icon: '📊', roles: ['manager'] },
      { href: 'reception.html', label: 'Vận hành hôm nay', icon: '🛎️', roles: ['reception', 'manager'] },
    ],
  },
  {
    label: 'Khách hàng & CRM',
    items: [
      { href: 'customers.html', label: 'Danh sách khách hàng', icon: '👥', roles: ['reception', 'manager'] },
      { href: 'templates.html', label: 'Kho template', icon: '✉️', roles: ['reception', 'manager'] },
    ],
  },
  {
    label: 'Cấu hình & Quản trị',
    items: [
      { href: 'manager.html', label: 'Cấu hình khuyến mãi', icon: '🎁', roles: ['reception', 'manager'] },
      { href: 'users.html', label: 'Quản lý user', icon: '🔑', roles: ['manager'] },
    ],
  },
];

function currentPage() {
  return window.location.pathname.split('/').pop();
}

function buildDrawer(role, username) {
  const page = currentPage();

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
      a.href = item.href;
      a.className = 'nav-drawer-item' + (item.href === page ? ' active' : '');
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
  const changePasswordLink = document.createElement('a');
  changePasswordLink.href = 'change-password.html';
  changePasswordLink.textContent = 'Đổi mật khẩu';
  if (page === 'change-password.html') changePasswordLink.className = 'active';
  const logoutLink = document.createElement('a');
  logoutLink.href = '#';
  logoutLink.textContent = 'Đăng xuất';
  logoutLink.addEventListener('click', async (event) => {
    event.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = 'login.html';
  });
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
