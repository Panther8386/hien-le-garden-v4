// Single source of truth for what may be published in dist/ (release item R-1).
// Imported by scripts/build-static.mjs (what to copy) and scripts/check-dist.mjs
// (what is allowed to exist), so the build and the gate cannot drift apart.

const CODE = ['.html', '.css', '.js'];
const IMAGES = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.avif'];
const RASTER_POSTERS = ['.png', '.jpg', '.jpeg', '.webp'];
const VIDEO = ['.mp4', '.webm'];
const FONTS = ['.woff', '.woff2'];

// Public top-level FILES (exact, case-sensitive names).
export const PUBLIC_FILES = new Set([
  'index.html',
  '_redirects', // Pages reads it from the upload directory as routing config
  'favicon.svg',
  'favicon-32.png',
  'favicon-512.png',
  'apple-touch-icon.png',
  'manifest.json',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
]);

// Public top-level DIRECTORIES -> allowed file extensions (lowercase) inside them.
// Derived from the tracked tree: admin (html/css/js), assets (js/png),
// page dirs (html), images (jpg/png/webp), videos (mp4); plus inert types
// of the same family.
export const PUBLIC_DIRS = new Map([
  ['admin', new Set([...CODE, ...IMAGES, ...FONTS])],
  ['assets', new Set([...CODE, ...IMAGES, ...FONTS])],
  ['bang-gia', new Set([...CODE, ...IMAGES])],
  ['cam-nang', new Set([...CODE, ...IMAGES])],
  ['gioi-thieu', new Set([...CODE, ...IMAGES])],
  ['tri-an-khach-hang', new Set([...CODE, ...IMAGES])],
  ['images', new Set(IMAGES)],
  ['videos', new Set([...VIDEO, ...RASTER_POSTERS])],
]);

// Tracked top-level entries that must never be published.
export const PRIVATE_ENTRIES = new Set([
  'functions', // built by wrangler from cwd, not uploaded as assets
  'lib',
  'migrations',
  'test',
  'scripts',
  'docs',
  '.github',
  'BACKEND.md',
  'wrangler.toml',
  'package.json',
  'package-lock.json',
  'vitest.config.js',
  '.gitignore',
  '.gitattributes',
  '.assetsignore',
  '.env.example',
]);

// Name patterns never published from public dirs even with an allowed
// extension (tested against the path inside the dir, case-insensitive).
export const DENY_IN_PUBLIC = [/\.test\.js$/i, /\.spec\.js$/i, /\.map$/i, /(^|\/)\./, /(^|\/)readme[^/]*$/i];

// Assets the site cannot work without; check-dist fails if one is missing.
export const REQUIRED = [
  'index.html',
  '_redirects',
  'manifest.json',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
  'favicon.svg',
  'admin/login.html',
  'admin/admin.css',
  'admin/reception.html',
  'admin/reception.js',
  'admin/nav-drawer.js',
  'admin/tabs.js',
  'tri-an-khach-hang/index.html',
  'bang-gia/index.html',
];

export function extOf(relPosix) {
  const base = relPosix.slice(relPosix.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

// null when relPosix (a file path relative to dist/) is allowed by the
// allowlist, otherwise the reason it is not.
export function allowlistReason(relPosix) {
  const segs = relPosix.split('/');
  if (segs.length === 1) return PUBLIC_FILES.has(segs[0]) ? null : 'top-level file not in PUBLIC_FILES';
  const exts = PUBLIC_DIRS.get(segs[0]);
  if (!exts) return `top-level dir ${segs[0]}/ not in PUBLIC_DIRS`;
  const ext = extOf(relPosix);
  if (!exts.has(ext)) return `extension "${ext || '(none)'}" not allowed in ${segs[0]}/`;
  const inner = segs.slice(1).join('/');
  const deny = DENY_IN_PUBLIC.find((re) => re.test(inner));
  if (deny) return `name matches ${deny}`;
  return null;
}
