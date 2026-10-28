const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const index = read('app/src/main/assets/index.html');
const theme = read('app/src/main/assets/v2-theme.css');
const app = read('app/src/main/assets/app.js');
const layout = read('app/src/main/assets/layout.js');

test('v2 theme is wired into the five-page shell', () => {
  assert.match(index, /<link rel="stylesheet" href="v2-theme\.css">/);
  const nav = index.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.equal((nav.match(/data-nav="/g) || []).length, 5);
  assert.match(index, /class="brand-lockup"/);
});

test('v2 theme exposes explicit, system and reduced-motion paths', () => {
  assert.match(theme, /:root\[data-theme="dark"\]/);
  assert.match(theme, /prefers-color-scheme: dark/);
  assert.match(theme, /prefers-reduced-motion: reduce/);
  assert.match(theme, /grid-template-columns: repeat\(5, 1fr\)/);
});

test('theme preference stays outside the learning data contract', () => {
  assert.match(app, /THEME_KEY = 'study-checkin-theme-v2'/);
  assert.match(app, /data-theme-preference/);
  assert.match(app, /applyThemePreference\(themePreference\(\)\)/);
  assert.match(layout, /themeSection/);
  assert.match(layout, /theme\?\[\{element:theme\}\]/);
});
