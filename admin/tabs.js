// Shared hash-preserving, keyboard-accessible tabs. Hidden tabs are permission gates.
// normalizeHash: once permissions are known, rewrite a hash that points at a hidden tab
// to the tab actually shown (before that, keep it so a deep link survives the permission load).
window.HLGTabs = {
  refresh(root = document.querySelector('[data-tabs]'), { normalizeHash = false } = {}) {
    if (!root) return;
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const available = tabs.filter((tab) => !tab.hidden);
    const selected = available.find((tab) => tab.dataset.tab === location.hash.slice(1)) || available[0];
    if (normalizeHash && selected && location.hash && location.hash.slice(1) !== selected.dataset.tab) {
      history.replaceState(null, '', `#${selected.dataset.tab}`);
    }
    tabs.forEach((tab) => {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    });
    // Scroll only the tab strip; keep the page and the selected panel in place.
    if (selected) {
      const strip = root.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (item.left < strip.left) root.scrollLeft += item.left - strip.left;
      else if (item.right > strip.right) root.scrollLeft += item.right - strip.right;
    }
    root.dispatchEvent(new Event('tabsvisibilitychange'));
  },
};
document.querySelectorAll('[data-tabs]').forEach((root) => {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const hint = document.createElement('p');
  hint.className = 'tabs-scroll-hint';
  hint.hidden = true;
  root.after(hint);
  function updateHint() {
    const before = root.scrollLeft > 1;
    const after = root.scrollWidth - root.clientWidth - root.scrollLeft > 1;
    hint.hidden = !before && !after;
    hint.textContent = before && after ? '← Vuốt để xem thêm tab →'
      : before ? '← Vuốt để xem các tab trước' : 'Vuốt để xem thêm tab →';
  }
  root.addEventListener('scroll', updateHint, { passive: true });
  root.addEventListener('tabsvisibilitychange', updateHint);
  // Also cover viewport/font changes and permission-gated tabs becoming visible.
  const observer = new ResizeObserver(() => window.HLGTabs.refresh(root));
  observer.observe(root);
  tabs.forEach((tab) => observer.observe(tab));
  function select(tab) {
    history.replaceState(null, '', `#${tab.dataset.tab}`);
    window.HLGTabs.refresh(root);
  }
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      const available = tabs.filter((item) => !item.hidden);
      const index = available.indexOf(tab);
      let next;
      if (event.key === 'ArrowRight') next = available[(index + 1) % available.length];
      if (event.key === 'ArrowLeft') next = available[(index - 1 + available.length) % available.length];
      if (event.key === 'Home') next = available[0];
      if (event.key === 'End') next = available.at(-1);
      if (!next) return;
      event.preventDefault();
      select(next);
      next.focus();
    });
  });
  window.addEventListener('hashchange', () => window.HLGTabs.refresh(root));
  window.HLGTabs.refresh(root);
});
