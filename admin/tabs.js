// Shared hash-preserving, keyboard-accessible tabs. Hidden tabs are permission gates.
window.HLGTabs = {
  refresh(root = document.querySelector('[data-tabs]')) {
    if (!root) return;
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const available = tabs.filter((tab) => !tab.hidden);
    const selected = available.find((tab) => tab.dataset.tab === location.hash.slice(1)) || available[0];
    tabs.forEach((tab) => {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    });
  },
};
document.querySelectorAll('[data-tabs]').forEach((root) => {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
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
