/**
 * Hiền Lê Garden — GA4 conversion event tracking.
 *
 * Loaded on the 8 public pages only (not admin/). Provides:
 *   - a delegated click listener that classifies customer contact
 *     links (Zalo / phone / Telegram) by existing DOM class/id context
 *     — no markup changes required, no PII collected.
 *   - window.hlgTrackBookingClick(), called explicitly by index.html's
 *     submitBooking() after a successful POST /api/bookings.
 *
 * GA4 itself only sends data on production (see the hostname guard in
 * each page's <head> Google tag snippet) — if gtag() was never
 * initialized (dev/pages.dev/localhost), track() below is a no-op.
 */
(function () {
  function track(eventName, params) {
    if (typeof window.gtag !== 'function') return;
    try {
      window.gtag('event', eventName, params || {});
    } catch (err) {
      /* analytics must never break the page */
    }
  }

  // Ordered [selector, label] pairs — first matching ancestor (or the
  // link itself) wins. Falls back to the generic 'page' label rather
  // than requiring markup changes for full coverage.
  var LOCATION_SELECTORS = [
    ['.nav-btn-zalo, .nav-btn-call', 'nav'],
    ['.fab-zalo, .fab-call', 'floating_action'],
    ['.bm-btn-zalo, .bm-btn-call', 'booking_confirm'],
    ['.bm-note', 'booking_modal_note'],
    ['.contact-actions', 'tri_an_confirm'],
    ['.pricing-cta', 'pricing_cta'],
    ['.cta-box', 'article_cta'],
    ['.offer-cta', 'offer_section'],
    ['.rv-source-link', 'reviews_section'],
    ['.event-tag', 'events_section'],
    ['#closing-cta', 'closing_cta'],
    ['.map-sidebar', 'map_sidebar'],
    ['.footer-contact, .sub-footer', 'footer'],
  ];

  function classifyLocation(link) {
    for (var i = 0; i < LOCATION_SELECTORS.length; i++) {
      if (link.closest(LOCATION_SELECTORS[i][0])) return LOCATION_SELECTORS[i][1];
    }
    return 'page';
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href') || '';

    if (href.indexOf('zalo.me/0968987311') !== -1) {
      track('contact_zalo', { cta_location: classifyLocation(link) });
    } else if (href.indexOf('tel:0968987311') === 0) {
      track('contact_phone', { cta_location: classifyLocation(link) });
    } else if (href.indexOf('t.me/HienLeGardenbot') !== -1) {
      track('contact_telegram', { cta_location: 'tri_an_confirm' });
    }
  }, true);

  window.hlgTrackBookingClick = function () {
    track('booking_click', { cta_location: 'booking_modal' });
  };
})();
