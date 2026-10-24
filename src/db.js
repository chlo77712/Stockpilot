const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DATABASE_PATH || './data/stockpilot.sqlite';
const resolved = path.resolve(dbPath);
fs.mkdirSync(path.dirname(resolved), { recursive: true });
const db = new Database(resolved);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','staff')),
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suppliers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 contact_person TEXT DEFAULT '',
 phone TEXT DEFAULT '',
 email TEXT DEFAULT '',
 notes TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT 'General',
 supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
 unit TEXT NOT NULL DEFAULT 'pcs',
 quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
 reorder_level INTEGER NOT NULL DEFAULT 5 CHECK(reorder_level >= 0),
 cost_price REAL NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
 selling_price REAL NOT NULL DEFAULT 0 CHECK(selling_price >= 0),
 notes TEXT DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS movements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 product_id INTEGER NOT NULL REFERENCES products(id),
 movement_type TEXT NOT NULL CHECK(movement_type IN ('opening','stock_in','stock_out','adjustment')),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 quantity_before INTEGER NOT NULL,
 quantity_after INTEGER NOT NULL,
 reference TEXT DEFAULT '',
 notes TEXT DEFAULT '',
 user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_movements_created ON movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_id);
`);

const settingDefaults = {
 business_name: 'My Business',
 business_phone: '',
 business_email: '',
 business_address: '',
 currency: 'KES',
 low_stock_default: '5'
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
for (const [key, value] of Object.entries(settingDefaults)) insertSetting.run(key, value);

const adminEmail = (process.env.ADMIN_EMAIL || '').trim();
const adminPassword = process.env.ADMIN_PASSWORD || '';
if (adminEmail && adminPassword) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!exists) {
    const hash = bcrypt.hashSync(adminPassword, 12);
    db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)')
      .run(process.env.ADMIN_NAME || 'Business Owner', adminEmail, hash, 'owner');
    console.log(`Initial owner account created for ${adminEmail}. Change the password after first login.`);
  }
}

module.exports = db;
