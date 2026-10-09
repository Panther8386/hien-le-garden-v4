# F4 mobile tabs — staging, 2026-10-09

Source `751cc403272471c69c6ff3beb2aa115fb030ec7a`, draft PR #14. Staging deployment `d7438cac`, alias https://staging.hien-le-garden-v4.pages.dev/manager#uu-dai. Production remains `809511c / 3a30dc4b`; not merged or deployed to production.

Selected tabs now scroll fully into the tab strip after selection, hash navigation, permission refresh or resizing. The page does not scroll vertically. Directional swipe text appears only when tabs extend beyond the strip. Tabs keep their label width rather than shrinking. PC hides the hint when all tabs fit.

Validation: 10 browser checks with actual reception tab markup/CSS/script passed: permission-gated deep link, 390px full visibility, hint, Home/End, hash changes, desktop, resize, permission removal/normalization, no page overflow/vertical scroll, no JS errors. Build and check:dist passed (135 public files, 15/15 required assets). Real staging passed 4/4: authenticated permission refresh/deep link, visible fourth tab and hint at 390px, Home/End, desktop hint hidden. No business writes. Evidence: test-results/mobile-tabs/.

Only admin/tabs.js and admin/admin.css are included in the commit. No API, business logic or migration changes. CI run 37897876123; production merge/deployment requires owner approval.
CI follow-up: workflow 37897876123 completed SUCCESS. Both required jobs passed; production remains unchanged.
