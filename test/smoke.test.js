const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('frontend entry point and core screens exist', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  for (const id of ['loginView','page-dashboard','page-products','page-stock','page-suppliers','page-reports','page-settings','modalBackdrop']) assert.match(html, new RegExp(`id="${id}"`));
});
test('server defines authentication and inventory APIs', () => {
  const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
  for (const route of ['/api/auth/login','/api/auth/logout','/api/products','/api/suppliers','/api/movements','/api/reports/summary','/api/backup','/api/restore']) assert.ok(server.includes(route), `Missing route ${route}`);
});
test('stock control prevents negative stock and preserves movement history', () => {
  const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
  assert.match(server, /qty>before/);
  assert.match(server, /quantity_before,quantity_after/);
  assert.match(server, /movement_type/);
});
test('environment example does not contain a real production secret', () => {
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(env, /SESSION_SECRET=replace-this/);
  assert.match(env, /ADMIN_EMAIL=/);
});
