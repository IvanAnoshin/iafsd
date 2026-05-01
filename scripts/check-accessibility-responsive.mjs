import fs from 'fs';
import path from 'path';

const root = process.cwd();
const required = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function expect(rel, pattern, label) {
  const source = read(rel);
  if (!pattern.test(source)) required.push({ status: 'error', file: rel, label });
}

function soft(rel, pattern, label) {
  const source = read(rel);
  if (!pattern.test(source)) warnings.push({ status: 'warn', file: rel, label });
}

expect('app/layout.jsx', /className="skip-link"/, 'root skip-link exists');
expect('app/layout.jsx', /id="main-content"/, 'main-content skip target exists');
expect('app/layout.jsx', /friendscape-live-region/, 'polite live region exists');
expect('app/globals.css', /:focus-visible/, 'visible keyboard focus styles exist');
expect('app/globals.css', /prefers-reduced-motion:\s*reduce/, 'prefers-reduced-motion is respected');
expect('app/globals.css', /data-reduced-motion='true'/, 'app reduced motion setting is respected');
expect('app/globals.css', /safe-area-inset-bottom/, 'safe-area bottom spacing exists');
expect('app/globals.css', /100dvh/, 'dynamic viewport units exist');
expect('components/PostAuthBottomNav.jsx', /aria-current=\{[^}]+\? 'page'/, 'active bottom nav exposes aria-current');
expect('components/PostAuthBottomNav.jsx', /aria-label="Основная навигация"/, 'bottom nav has label');
expect('components/MinimalActionDialog.jsx', /aria-labelledby=\{titleId\}/, 'minimal dialog uses labelled title');
expect('components/MinimalActionDialog.jsx', /event\.key === 'Escape'/, 'minimal dialog closes with Escape');
expect('components/NotificationCenter.jsx', /aria-haspopup="dialog"/, 'notification opener exposes dialog popup');
expect('components/NotificationCenter.jsx', /aria-expanded=\{open\}/, 'notification opener exposes expanded state');
expect('components/PublicTrustPage.jsx', /aria-current=\{item\.path === page\.path \? 'page'/, 'trust nav exposes aria-current');
expect('app/page.jsx', /aria-label="Имя"/, 'login first-name input has accessible name');
expect('app/page.jsx', /aria-label="Фамилия"/, 'login last-name input has accessible name');
expect('app/page.jsx', /aria-label="Пароль"/, 'login password input has accessible name');
expect('app/page.jsx', /role="alert"/, 'login errors are announced');

soft('app/globals.css', /max-height:\s*min\(86dvh/, 'modal/sheet max-height is mobile-safe');
soft('components/PostAuthHeader.jsx', /aria-haspopup="menu"/, 'profile menu exposes menu semantics');
soft('components/PostAuthHeader.jsx', /aria-expanded=\{showMore\}/, 'profile more button exposes expanded state');

const summary = {
  checked_at: new Date().toISOString(),
  status: required.length ? 'error' : warnings.length ? 'warn' : 'ready',
  errors: required,
  warnings,
};

console.log(JSON.stringify(summary, null, 2));
if (required.length) process.exit(1);
