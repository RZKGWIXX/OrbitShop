/* server.js — чистий, виправлений варіант
   Змінні оточення:
     JSONBIN_MASTER_KEY  - master key для jsonbin.io (серверний)
     JSONBIN_ITEMS_BIN_ID - binId для items (записуємо { items: [...] })
     JSONBIN_ORDERS_BIN_ID - binId для orders (записуємо { orders: [...] })
*/

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

app.use(bodyParser.json());
app.set('trust proxy', true);

const ITEMS_FILE = path.join(__dirname, 'items.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY || null;
const JSONBIN_ITEMS_BIN_ID = process.env.JSONBIN_ITEMS_BIN_ID || null;
const JSONBIN_ORDERS_BIN_ID = process.env.JSONBIN_ORDERS_BIN_ID || null;
const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b';

function log(){ console.log.apply(console, arguments); }

function loadJsonFileSafe(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed;
    }
  } catch (e) {
    console.error('Failed to read/parse', filePath, e);
  }
  return defaultValue;
}

function writeJsonFileSafe(filePath, data) {
  try {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const bak = path.join(BACKUP_DIR, path.basename(filePath) + '.' + stamp + '.bak');
    fs.writeFileSync(bak, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to write file', filePath, e);
    return false;
  }
}

// default fallback data
let items = [
  { id: '1', title: 'Шипучка', price: 2, description: 'Освіжаюча шипучка', stock: 15, img: '/images/orbital.svg', active: true },
  { id: '2', title: 'Player Kicker', price: 1, description: 'Програма для викиду гравців', stock: 8, img: '/images/icon.svg', active: true }
];
let orders = [];

// Load locals if present
const localItems = loadJsonFileSafe(ITEMS_FILE, null);
if (localItems) {
  // support both array or wrapper { items: [...] }
  if (Array.isArray(localItems)) items = localItems;
  else if (localItems.items && Array.isArray(localItems.items)) items = localItems.items;
}
const localOrders = loadJsonFileSafe(ORDERS_FILE, null);
if (localOrders) {
  if (Array.isArray(localOrders)) orders = localOrders;
  else if (localOrders.orders && Array.isArray(localOrders.orders)) orders = localOrders.orders;
}

// jsonbin helpers (use native fetch available in Node 18+)
async function jsonbinGet(binId){
  if(!binId) throw new Error('No binId');
  if (typeof fetch !== 'function') throw new Error('fetch not available in this Node runtime');
  const url = `${JSONBIN_BASE}/${binId}/latest`;
  const headers = {};
  if(JSONBIN_MASTER_KEY) headers['X-Master-Key'] = JSONBIN_MASTER_KEY;
  const res = await fetch(url, { method: 'GET', headers });
  if(!res.ok) throw new Error('jsonbin GET failed: ' + res.status + ' ' + await res.text());
  const data = await res.json();
  return data && data.record ? data.record : data;
}

async function jsonbinPut(binId, payload){
  if(!binId) throw new Error('No binId');
  if (typeof fetch !== 'function') throw new Error('fetch not available in this Node runtime');
  const url = `${JSONBIN_BASE}/${binId}`;
  const headers = { 'Content-Type': 'application/json' };
  if(JSONBIN_MASTER_KEY) headers['X-Master-Key'] = JSONBIN_MASTER_KEY;
  // try PUT
  let res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
  if(res.ok){
    try { return await res.json(); } catch(e){ return { success: true }; }
  }
  // fallback POST
  res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if(res.ok) {
    try { return await res.json(); } catch(e){ return { success:true }; }
  }
  throw new Error('jsonbin write failed: ' + res.status + ' ' + await res.text());
}

// Try to initialize from jsonbin on startup (best-effort)
(async function initFromJsonbin(){
  try {
    if (JSONBIN_ITEMS_BIN_ID) {
      const remote = await jsonbinGet(JSONBIN_ITEMS_BIN_ID);
      if (Array.isArray(remote)) items = remote;
      else if (remote && Array.isArray(remote.items)) items = remote.items;
      log('Loaded items from jsonbin:', items.length);
      writeJsonFileSafe(ITEMS_FILE, items);
    } else {
      log('JSONBIN_ITEMS_BIN_ID not set — using local/default items');
    }
  } catch(e){
    console.warn('jsonbin items load failed:', e.message);
  }
  try {
    if (JSONBIN_ORDERS_BIN_ID) {
      const remoteOrders = await jsonbinGet(JSONBIN_ORDERS_BIN_ID);
      if (Array.isArray(remoteOrders)) orders = remoteOrders;
      else if (remoteOrders && Array.isArray(remoteOrders.orders)) orders = remoteOrders.orders;
      log('Loaded orders from jsonbin:', orders.length);
      writeJsonFileSafe(ORDERS_FILE, orders);
    } else {
      log('JSONBIN_ORDERS_BIN_ID not set — using local/default orders');
    }
  } catch(e){
    console.warn('jsonbin orders load failed:', e.message);
  }
})();

// persistence helpers: try remote then fallback local
async function persistItemsRemoteOrLocal(){
  if (JSONBIN_ITEMS_BIN_ID) {
    try {
      await jsonbinPut(JSONBIN_ITEMS_BIN_ID, { items });
      log('Saved items to jsonbin');
      return;
    } catch(e){
      console.warn('jsonbin persist items failed:', e.message);
    }
  }
  writeJsonFileSafe(ITEMS_FILE, items);
}

async function persistOrdersRemoteOrLocal(){
  if (JSONBIN_ORDERS_BIN_ID) {
    try {
      await jsonbinPut(JSONBIN_ORDERS_BIN_ID, { orders });
      log('Saved orders to jsonbin');
      return;
    } catch(e){
      console.warn('jsonbin persist orders failed:', e.message);
    }
  }
  writeJsonFileSafe(ORDERS_FILE, orders);
}

// Auto-save periodically
setInterval(()=>{ try{ persistItemsRemoteOrLocal(); persistOrdersRemoteOrLocal(); log('[autosave]'); } catch(e){ console.error('autosave failed', e); } }, 60000);

// Simple anti-spam
const lastOrderByIp = new Map();
const lastOrderByName = new Map();
const SPAM_WINDOW_MS = 10 * 1000;

// Routes (same semantics as before)
app.get('/api/items', (req, res) => res.json(items));

app.post('/api/addItem', async (req, res) => {
  const { title, price, description, stock, img, active } = req.body;
  if(!title || price === undefined) return res.status(400).json({ error: 'title and price required' });
  const id = Date.now().toString();
  const it = { id, title: String(title), price: Number(price), description: description||'', stock: Number(stock)||0, img: img||'/images/orbital.svg', active: active===undefined?true:!!active };
  items.push(it);
  await persistItemsRemoteOrLocal();
  io.emit('itemsUpdate', { action:'add', item: it });
  res.json({ success:true, item: it });
});

app.post('/api/updateItem', async (req, res) => {
  const { id, title, price, description, stock, img, active } = req.body;
  const it = items.find(x=>x.id === String(id));
  if(!it) return res.status(404).json({ error:'Item not found' });
  if(title!==undefined) it.title = title;
  if(price!==undefined) it.price = Number(price);
  if(description!==undefined) it.description = description;
  if(stock!==undefined) it.stock = Number(stock);
  if(img!==undefined) it.img = img;
  if(active!==undefined) it.active = !!active;
  await persistItemsRemoteOrLocal();
  io.emit('itemsUpdate', { action:'update', item: it });
  io.emit('stockUpdate', { id: it.id, stock: it.stock });
  res.json({ success:true, item: it });
});

app.post('/api/deleteItem', async (req, res) => {
  const { id } = req.body;
  const idx = items.findIndex(i=>i.id === String(id));
  if(idx === -1) return res.status(404).json({ error:'Item not found' });
  const removed = items.splice(idx,1)[0];
  await persistItemsRemoteOrLocal();
  io.emit('itemsUpdate', { action:'delete', id: removed.id });
  res.json({ success:true, item: removed });
});

app.post('/api/order', async (req, res) => {
  const { name, itemId, quantity } = req.body;
  if(!name || !itemId || !quantity) return res.status(400).json({ error: "Вкажіть ім'я та кількість" });
  const it = items.find(i=>i.id === String(itemId));
  if(!it) return res.status(400).json({ error: 'Товар не знайдено' });
  const q = Number(quantity);
  if(!Number.isInteger(q) || q <= 0) return res.status(400).json({ error: 'Кількість має бути цілим позитивним числом' });
  if(it.stock < q) return res.status(400).json({ error:'Немає достатньої кількості на складі', available: it.stock });
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const lastIp = lastOrderByIp.get(ip) || 0;
  const lastName = lastOrderByName.get(name) || 0;
  if(now - lastIp < SPAM_WINDOW_MS || now - lastName < SPAM_WINDOW_MS){
    return res.status(429).json({ error: 'Забагато запитів. Зачекайте кілька секунд.' });
  }
  it.stock -= q;
  const total = it.price * q;
  const order = { id: Date.now().toString(), name, item:{id: it.id, title: it.title, price: it.price}, quantity: q, total, status:'pending', createdAt: new Date().toISOString() };
  orders.unshift(order);
  lastOrderByIp.set(ip, now);
  lastOrderByName.set(name, now);
  await persistOrdersRemoteOrLocal();
  await persistItemsRemoteOrLocal();
  io.emit('newOrder', order);
  io.emit('stockUpdate', { id: it.id, stock: it.stock });
  io.emit('ordersUpdate', orders);
  res.json({ success:true, order });
});

app.get('/api/orders', (req, res) => res.json(orders));

app.post('/api/orders/:id/approve', async (req, res) => {
  const id = req.params.id;
  const ord = orders.find(o=>o.id === id);
  if(!ord) return res.status(404).json({ error:'Order not found' });
  ord.status = 'approved';
  await persistOrdersRemoteOrLocal();
  io.emit('ordersUpdate', orders);
  res.json({ success:true, order: ord });
});

app.post('/api/orders/:id/reject', async (req, res) => {
  const id = req.params.id;
  const ord = orders.find(o=>o.id === id);
  if(!ord) return res.status(404).json({ error:'Order not found' });
  ord.status = 'rejected';
  const it = items.find(i => i.id === ord.item.id);
  if(it) it.stock += ord.quantity;
  await persistOrdersRemoteOrLocal();
  await persistItemsRemoteOrLocal();
  io.emit('ordersUpdate', orders);
  io.emit('stockUpdate', { id: it ? it.id : null, stock: it ? it.stock : 0 });
  res.json({ success:true, order: ord });
});

app.post('/api/orders/:id/cancel', async (req, res) => {
  const id = req.params.id;
  const reason = req.body.reason || req.query.reason || 'Не вказано';
  const ord = orders.find(o=>o.id === id);
  if(!ord) return res.status(404).json({ error:'Order not found' });
  ord.status = 'cancelled';
  ord.cancellationReason = reason;
  const it = items.find(i => i.id === ord.item.id);
  if(it) it.stock += ord.quantity;
  await persistOrdersRemoteOrLocal();
  await persistItemsRemoteOrLocal();
  io.emit('ordersUpdate', orders);
  io.emit('stockUpdate', { id: it ? it.id : null, stock: it ? it.stock : 0 });
  io.emit('orderCancelled', { order: ord, reason });
  res.json({ success:true, order: ord });
});

app.post('/api/orders/clear', async (req, res) => { orders = []; await persistOrdersRemoteOrLocal(); io.emit('ordersUpdate', orders); res.json({ success:true }); });

app.get('/api/myorders', (req, res) => {
  const name = req.query.name;
  if(!name) return res.status(400).json({ error: 'Name required' });
  res.json(orders.filter(o=>o.name === name));
});

app.get('/api/summary', (req, res) => {
  const approved = orders.filter(o=>o.status === 'approved');
  const count = approved.length;
  const revenue = approved.reduce((s,o)=>s+(o.total||0), 0);
  res.json({ approvedCount: count, revenue });
});

// 404 for /api
app.use('/api', (req, res) => res.status(404).json({ error:'API endpoint not found' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public','index.html')));

const PORT = process.env.PORT || 3000;
http.listen(PORT, ()=> console.log('[start] Server on http://localhost:'+PORT+' — PID:'+process.pid));
