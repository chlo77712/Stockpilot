require('dotenv').config();
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  if (production) throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  console.warn('WARNING: Set SESSION_SECRET in .env to a random string of at least 32 characters.');
}
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"],
  baseUri: ["'self'"], frameAncestors: ["'none'"]
}}}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(session({
  name: 'stockpilot.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret-please',
  resave: false, saveUninitialized: false,
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.resolve('data') }),
  cookie: { httpOnly: true, sameSite: 'strict', secure: production, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Try again in 15 minutes.' } }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (v, max = 250) => String(v ?? '').trim().slice(0, max);
const integer = (v, label, min = 0, max = 100000000) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw httpError(400, `${label} must be a whole number between ${min} and ${max}.`);
  return n;
};
const money = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000000000 || Math.round(n * 100) !== n * 100) throw httpError(400, `${label} must be a valid non-negative amount with at most 2 decimal places.`);
  return n;
};
const httpError = (status, message) => Object.assign(new Error(message), { status });
const requireAuth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Please log in to continue.' });
const requireOwner = (req, res, next) => req.session.user?.role === 'owner' ? next() : res.status(403).json({ error: 'Owner permission required.' });
const csrfCheck = (req, res, next) => {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Request origin rejected.' }); }
    catch { return res.status(403).json({ error: 'Request origin rejected.' }); }
  }
  next();
};
app.use('/api', csrfCheck);

app.get('/api/health', (req,res) => res.json({ ok: true, service: 'StockPilot', time: new Date().toISOString() }));
app.get('/api/auth/me', (req,res) => res.json({ user: req.session.user || null }));
app.post('/api/auth/login', asyncRoute(async (req,res) => {
  const email = clean(req.body.email, 254).toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) throw httpError(400, 'Enter your email and password.');
  const user = db.prepare('SELECT id,name,email,password_hash,role,active FROM users WHERE email = ?').get(email);
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) throw httpError(401, 'Email or password is incorrect.');
  await new Promise((resolve,reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.json({ user: req.session.user });
}));
app.post('/api/auth/logout', requireAuth, asyncRoute(async (req,res) => {
  await new Promise((resolve,reject) => req.session.destroy(err => err ? reject(err) : resolve()));
  res.clearCookie('stockpilot.sid', { httpOnly: true, sameSite: 'strict', secure: production });
  res.json({ ok: true });
}));
app.post('/api/auth/change-password', requireAuth, asyncRoute(async (req,res) => {
  const oldPassword = String(req.body.oldPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 12 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) throw httpError(400, 'New password must be at least 12 characters and include uppercase, lowercase and a number.');
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || !(await bcrypt.compare(oldPassword, user.password_hash))) throw httpError(400, 'Current password is incorrect.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(newPassword, 12), req.session.user.id);
  res.json({ ok: true, message: 'Password updated.' });
}));

app.use('/api', requireAuth);
app.get('/api/settings', (req,res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key,r.value])));
});
app.put('/api/settings', requireOwner, (req,res) => {
  const allowed = ['business_name','business_phone','business_email','business_address','currency','low_stock_default'];
  const values = {
    business_name: clean(req.body.business_name,100) || 'My Business',
    business_phone: clean(req.body.business_phone,40),
    business_email: clean(req.body.business_email,254),
    business_address: clean(req.body.business_address,250),
    currency: clean(req.body.currency,8).toUpperCase() || 'KES',
    low_stock_default: String(integer(req.body.low_stock_default ?? 5, 'Default low-stock level',0,1000000))
  };
  const update = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const tx = db.transaction(() => allowed.forEach(k => update.run(k, values[k]))); tx();
  res.json(values);
});

app.get('/api/dashboard', (req,res) => {
 const totals = db.prepare(`SELECT COUNT(*) product_count, COALESCE(SUM(quantity),0) units,
 COALESCE(SUM(quantity*cost_price),0) stock_cost, COALESCE(SUM(quantity*selling_price),0) potential_sales,
 COALESCE(SUM(CASE WHEN quantity <= reorder_level THEN 1 ELSE 0 END),0) low_stock
 FROM products WHERE active=1`).get();
 const recent = db.prepare(`SELECT m.id,m.movement_type,m.quantity,m.quantity_before,m.quantity_after,m.reference,m.notes,m.created_at,p.name product_name,p.sku
 FROM movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 8`).all();
 res.json({ ...totals, recent });
});

app.get('/api/products', (req,res) => {
 const q = `%${clean(req.query.q,100).replace(/[\%_]/g,'')}%`;
 const category = clean(req.query.category,100);
 const status = clean(req.query.status,20);
 let sql = `SELECT p.*,s.name supplier_name FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.active=1 AND (p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?)`;
 const params = [q,q,q];
 if (category) { sql += ' AND p.category=?'; params.push(category); }
 if (status === 'low') sql += ' AND p.quantity <= p.reorder_level';
 if (status === 'out') sql += ' AND p.quantity=0';
 sql += ' ORDER BY p.name COLLATE NOCASE';
 res.json(db.prepare(sql).all(...params));
});
app.post('/api/products', requireOwner, (req,res) => {
 const d = productInput(req.body);
 const tx = db.transaction(() => {
   const result = db.prepare(`INSERT INTO products(sku,name,category,supplier_id,unit,quantity,reorder_level,cost_price,selling_price,notes)
   VALUES(@sku,@name,@category,@supplier_id,@unit,@quantity,@reorder_level,@cost_price,@selling_price,@notes)`).run(d);
   if (d.quantity > 0) db.prepare(`INSERT INTO movements(product_id,movement_type,quantity,quantity_before,quantity_after,notes,user_id) VALUES (?,'opening',?,0,?,?,?)`).run(result.lastInsertRowid,d.quantity,d.quantity,'Opening stock',req.session.user.id);
   return result.lastInsertRowid;
 });
 try { const id=tx(); res.status(201).json(db.prepare('SELECT * FROM products WHERE id=?').get(id)); }
 catch(e) { if (String(e.message).includes('UNIQUE')) throw httpError(409,'That SKU already exists. Use a unique SKU.'); throw e; }
});
app.put('/api/products/:id', requireOwner, (req,res) => {
 const id = integer(req.params.id,'Product ID',1);
 const old = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);
 if (!old) throw httpError(404,'Product not found.');
 const d = productInput(req.body);
 if (d.quantity !== old.quantity) throw httpError(400,'Use Stock In, Stock Out or Adjust Stock to change quantity so the movement history stays accurate.');
 try { db.prepare(`UPDATE products SET sku=@sku,name=@name,category=@category,supplier_id=@supplier_id,unit=@unit,reorder_level=@reorder_level,cost_price=@cost_price,selling_price=@selling_price,notes=@notes,updated_at=datetime('now') WHERE id=@id`).run({...d,id}); }
 catch(e) { if (String(e.message).includes('UNIQUE')) throw httpError(409,'That SKU already exists. Use a unique SKU.'); throw e; }
 res.json(db.prepare('SELECT * FROM products WHERE id=?').get(id));
});
function productInput(body) {
 const sku=clean(body.sku,60).toUpperCase(), name=clean(body.name,150);
 if (!sku || !name) throw httpError(400,'SKU and product name are required.');
 const supplierRaw=body.supplier_id;
 let supplier_id = null;
 if (supplierRaw !== '' && supplierRaw !== undefined && supplierRaw !== null) {
   supplier_id = integer(supplierRaw,'Supplier',1);
   if (!db.prepare('SELECT id FROM suppliers WHERE id=?').get(supplier_id)) throw httpError(400,'Selected supplier does not exist.');
 }
 return { sku,name,category:clean(body.category,100)||'General',supplier_id,unit:clean(body.unit,30)||'pcs',
 quantity:integer(body.quantity??0,'Quantity',0,100000000),reorder_level:integer(body.reorder_level??5,'Reorder level',0,100000000),
 cost_price:money(body.cost_price??0,'Cost price'),selling_price:money(body.selling_price??0,'Selling price'),notes:clean(body.notes,1000) };
}
app.delete('/api/products/:id', requireOwner, (req,res) => {
 const id=integer(req.params.id,'Product ID',1);
 const product=db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(id);
 if(!product) throw httpError(404,'Product not found.');
 db.prepare("UPDATE products SET active=0,updated_at=datetime('now') WHERE id=?").run(id);
 res.json({ok:true});
});

app.get('/api/suppliers', (req,res) => res.json(db.prepare('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE').all()));
app.post('/api/suppliers', requireOwner, (req,res) => {
 const name=clean(req.body.name,150); if(!name) throw httpError(400,'Supplier name is required.');
 try { const r=db.prepare('INSERT INTO suppliers(name,contact_person,phone,email,notes) VALUES(?,?,?,?,?)').run(name,clean(req.body.contact_person,120),clean(req.body.phone,40),clean(req.body.email,254),clean(req.body.notes,1000)); res.status(201).json(db.prepare('SELECT * FROM suppliers WHERE id=?').get(r.lastInsertRowid)); }
 catch(e) { if(String(e.message).includes('UNIQUE')) throw httpError(409,'A supplier with that name already exists.'); throw e; }
});
app.put('/api/suppliers/:id', requireOwner, (req,res) => {
 const id=integer(req.params.id,'Supplier ID',1), name=clean(req.body.name,150); if(!name) throw httpError(400,'Supplier name is required.');
 try { const r=db.prepare('UPDATE suppliers SET name=?,contact_person=?,phone=?,email=?,notes=? WHERE id=?').run(name,clean(req.body.contact_person,120),clean(req.body.phone,40),clean(req.body.email,254),clean(req.body.notes,1000),id); if(!r.changes) throw httpError(404,'Supplier not found.'); res.json(db.prepare('SELECT * FROM suppliers WHERE id=?').get(id)); }
 catch(e) { if(String(e.message).includes('UNIQUE')) throw httpError(409,'A supplier with that name already exists.'); throw e; }
});
app.delete('/api/suppliers/:id', requireOwner, (req,res) => { const id=integer(req.params.id,'Supplier ID',1); const r=db.prepare('DELETE FROM suppliers WHERE id=?').run(id); if(!r.changes) throw httpError(404,'Supplier not found.'); res.json({ok:true}); });

app.post('/api/movements', (req,res) => {
 const productId=integer(req.body.product_id,'Product',1);
 const type=clean(req.body.movement_type,20);
 if(!['stock_in','stock_out','adjustment'].includes(type)) throw httpError(400,'Choose Stock In, Stock Out or Adjustment.');
 const qty=integer(req.body.quantity,'Quantity',type==='adjustment'?0:1,100000000);
 const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId); if(!p) throw httpError(404,'Product not found.');
 const before=p.quantity;
 let after;
 if(type==='stock_in') after=before+qty;
 else if(type==='stock_out') { if(qty>before) throw httpError(400,`Only ${before} ${p.unit} available; stock cannot go negative.`); after=before-qty; }
 else after=qty; // adjustment quantity is the desired counted balance
 const movementQty=type==='adjustment'?Math.max(1,Math.abs(after-before)):qty;
 if(type==='adjustment' && after===before) throw httpError(400,'Counted quantity is already equal to current stock.');
 const tx=db.transaction(() => {
  db.prepare("UPDATE products SET quantity=?,updated_at=datetime('now') WHERE id=?").run(after,productId);
  db.prepare('INSERT INTO movements(product_id,movement_type,quantity,quantity_before,quantity_after,reference,notes,user_id) VALUES(?,?,?,?,?,?,?,?)').run(productId,type,movementQty,before,after,clean(req.body.reference,100),clean(req.body.notes,1000),req.session.user.id);
 }); tx();
 res.status(201).json({product_id:productId,quantity_before:before,quantity_after:after});
});
app.get('/api/movements', (req,res) => {
 const limit=Math.min(500,Math.max(1,Number(req.query.limit)||100));
 res.json(db.prepare(`SELECT m.*,p.name product_name,p.sku,u.name user_name FROM movements m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT ?`).all(limit));
});
app.get('/api/reports/summary', (req,res) => {
 const byCategory=db.prepare(`SELECT category,COUNT(*) product_count,SUM(quantity) units,SUM(quantity*cost_price) stock_cost,SUM(quantity*selling_price) potential_sales FROM products WHERE active=1 GROUP BY category ORDER BY category`).all();
 const totals=db.prepare(`SELECT COUNT(*) products,COALESCE(SUM(quantity),0) units,COALESCE(SUM(quantity*cost_price),0) stock_cost,COALESCE(SUM(quantity*selling_price),0) potential_sales,COALESCE(SUM(quantity*(selling_price-cost_price)),0) potential_margin FROM products WHERE active=1`).get();
 const movements=db.prepare(`SELECT movement_type,COUNT(*) transactions,SUM(quantity) units FROM movements WHERE created_at >= datetime('now','-30 days') GROUP BY movement_type`).all();
 res.json({totals,byCategory,movements});
});
app.get('/api/backup', requireOwner, (req,res) => {
 const backup={format:'stockpilot-backup-v1',created_at:new Date().toISOString(),settings:db.prepare('SELECT key,value FROM settings').all(),suppliers:db.prepare('SELECT * FROM suppliers').all(),products:db.prepare('SELECT * FROM products').all(),movements:db.prepare('SELECT * FROM movements').all()};
 res.setHeader('Content-Type','application/json'); res.setHeader('Content-Disposition',`attachment; filename="stockpilot-backup-${new Date().toISOString().slice(0,10)}.json"`); res.send(JSON.stringify(backup,null,2));
});
app.post('/api/restore', requireOwner, (req,res) => {
 const b=req.body;
 if(!b || b.format!=='stockpilot-backup-v1' || !Array.isArray(b.products) || !Array.isArray(b.suppliers) || !Array.isArray(b.movements) || !Array.isArray(b.settings)) throw httpError(400,'This is not a valid StockPilot backup file.');
 if(b.products.length>10000 || b.suppliers.length>5000 || b.movements.length>100000) throw httpError(400,'Backup exceeds the allowed import size.');
 const tx=db.transaction(() => {
   db.exec('DELETE FROM movements; DELETE FROM products; DELETE FROM suppliers;');
   const insS=db.prepare('INSERT INTO suppliers(id,name,contact_person,phone,email,notes,created_at) VALUES(@id,@name,@contact_person,@phone,@email,@notes,@created_at)');
   for(const s of b.suppliers) insS.run({id:s.id,name:clean(s.name,150),contact_person:clean(s.contact_person,120),phone:clean(s.phone,40),email:clean(s.email,254),notes:clean(s.notes,1000),created_at:s.created_at||new Date().toISOString()});
   const insP=db.prepare('INSERT INTO products(id,sku,name,category,supplier_id,unit,quantity,reorder_level,cost_price,selling_price,notes,active,created_at,updated_at) VALUES(@id,@sku,@name,@category,@supplier_id,@unit,@quantity,@reorder_level,@cost_price,@selling_price,@notes,@active,@created_at,@updated_at)');
   for(const p of b.products) insP.run({...p,sku:clean(p.sku,60),name:clean(p.name,150),category:clean(p.category,100),unit:clean(p.unit,30),notes:clean(p.notes,1000)});
   const insM=db.prepare('INSERT INTO movements(id,product_id,movement_type,quantity,quantity_before,quantity_after,reference,notes,user_id,created_at) VALUES(@id,@product_id,@movement_type,@quantity,@quantity_before,@quantity_after,@reference,@notes,@user_id,@created_at)');
   for(const m of b.movements) insM.run({...m,reference:clean(m.reference,100),notes:clean(m.notes,1000)});
   const insSet=db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
   for(const s of b.settings) if(typeof s.key==='string' && typeof s.value==='string') insSet.run(clean(s.key,100),clean(s.value,1000));
 });
 try {tx();} catch(e) {throw httpError(400,`Backup could not be restored: ${e.message}`);}
 res.json({ok:true,message:'Backup restored. Please refresh the application.'});
});

app.get('*', (req,res) => res.sendFile(path.join(__dirname,'..','public','index.html')));
app.use((err,req,res,next) => {
 if(res.headersSent) return next(err);
 const status=err.status || 500;
 if(status>=500) console.error(err);
 res.status(status).json({error:status>=500?'An unexpected server error occurred. Check server logs.':err.message});
});
app.listen(PORT, () => console.log(`StockPilot running at http://localhost:${PORT}`));
module.exports = app;
