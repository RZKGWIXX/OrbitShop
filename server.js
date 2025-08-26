/*
  server.js — Orbit Store (jsonbin.io integration)
  Env vars used:
    JSONBIN_ITEMS_BIN_ID   - jsonbin bin id that will store {"items": [...]}
    JSONBIN_ORDERS_BIN_ID  - jsonbin bin id that will store {"orders": [...]}
    JSONBIN_MASTER_KEY     - jsonbin master key (required for private bins)
  Behavior:
    - On startup tries to GET items/orders from jsonbin (if bin ids provided).
    - When items or orders change, attempts a PUT to jsonbin to persist.
    - If jsonbin requests fail, falls back to local items.json / orders.json persistence.
*/

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default:fetch})=>fetch(...args));

app.use(bodyParser.json());
app.set('trust proxy', true);

const ITEMS_FILE = path.join(__dirname, 'items.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function loadJsonFileSafe(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
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

// load persisted or default data
let orders = loadJsonFileSafe(ORDERS_FILE, []);
let items = loadJsonFileSafe(ITEMS_FILE, [
  { id: '1', title: 'Шипучка', price: 2, description: 'Освіжаюча шипучка', stock: 15, img: '/images/orbital.svg', active: true },
  { id: '2', title: 'Player Kicker', price: 1, description: 'Програма для викиду гравців', stock: 8, img: '/images/icon.svg', active: true }
]);

// Ensure files exist on disk
writeJsonFileSafe(ITEMS_FILE, items);
writeJsonFileSafe(ORDERS_FILE, orders);

function persistOrders(){ try{ writeJsonFileSafe(ORDERS_FILE, orders); }catch(e){console.error(e);} }
function persistItems(){ try{ writeJsonFileSafe(ITEMS_FILE, items); }catch(e){console.error(e);} }

// Autosave every 60s
setInterval(()=>{
  try{ persistItems(); persistOrders(); console.log('[autosave] saved items and orders at', new Date().toISOString()); }catch(e){ console.error('Autosave failed', e); }
}, 60 * 1000);

// graceful shutdown
process.on('SIGINT', ()=>{ console.log('[shutdown] SIGINT received, saving data...'); persistItems(); persistOrders(); process.exit(0); });
process.on('SIGTERM', ()=>{ console.log('[shutdown] SIGTERM received, saving data...'); persistItems(); persistOrders(); process.exit(0); });
const ORDERS_FILE = path.join(__dirname, 'orders.json');

const JSONBIN_ITEMS_BIN_ID = process.env.JSONBIN_ITEMS_BIN_ID || null;
const JSONBIN_ORDERS_BIN_ID = process.env.JSONBIN_ORDERS_BIN_ID || null;
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY || null;

const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b';

function log(){ console.log.apply(console, arguments); }

// In-memory state (fallback defaults)
let items = [
  { id: '1', title: 'Шипучка', price: 2, description: 'Освіжаюча шипучка', stock: 15, img: '/images/orbital.svg', active: true },
  { id: '2', title: 'Player Kicker', price: 1, description: 'Програма для викиду гравців', stock: 8, img: '/images/icon.svg', active: true }
];
let orders = [];

// Local persistence helpers
function persistItemsLocal(){ try{ fs.writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2), 'utf8'); }catch(e){ console.error('persistItemsLocal', e); } }
function persistOrdersLocal(){ try{ fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8'); }catch(e){ console.error('persistOrdersLocal', e); } }

// Load local files if exists
try{ if(fs.existsSync(ITEMS_FILE)) items = JSON.parse(fs.readFileSync(ITEMS_FILE,'utf8')); }catch(e){ console.warn('Failed reading items.json', e); }
try{ if(fs.existsSync(ORDERS_FILE)) orders = JSON.parse(fs.readFileSync(ORDERS_FILE,'utf8')); }catch(e){ console.warn('Failed reading orders.json', e); }

// jsonbin helpers
async function jsonbinGet(binId){
  if(!binId) throw new Error('No binId');
  const headers = {};
  if(JSONBIN_MASTER_KEY) headers['X-Master-Key'] = JSONBIN_MASTER_KEY;
  const url = `${JSONBIN_BASE}/${binId}/latest`;
  const res = await fetch(url, { method: 'GET', headers });
  if(!res.ok) throw new Error('jsonbin GET failed: ' + res.status + ' ' + await res.text());
  const data = await res.json();
  // jsonbin v3 returns { record: {...}, metadata: {...} }
  if(data && data.record) return data.record;
  return data;
}

async function jsonbinPut(binId, payload){
  if(!binId) throw new Error('No binId');
  const headers = { 'Content-Type': 'application/json' };
  if(JSONBIN_MASTER_KEY) headers['X-Master-Key'] = JSONBIN_MASTER_KEY;
  const url = `${JSONBIN_BASE}/${binId}`;
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
  if(res.ok){
    try{ return await res.json(); }catch(e){ return { success:true }; }
  }
  // fallback: try POST (some setups expect POST to update)
  const res2 = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if(res2.ok){ try{ return await res2.json(); }catch(e){ return { success:true }; } }
  throw new Error('jsonbin write failed: ' + res.status + ' ' + await res.text());
}

// Initialize from jsonbin if configured
(async function initFromJsonbin(){
  try{
    if(JSONBIN_ITEMS_BIN_ID){
      const remote = await jsonbinGet(JSONBIN_ITEMS_BIN_ID);
      // support both wrapper { items: [...] } or direct array
      if(Array.isArray(remote)) items = remote;
      else if(remote && Array.isArray(remote.items)) items = remote.items;
      else if(remote && remote.items === undefined && Array.isArray(remote)) items = remote;
      log('Loaded items from jsonbin, count:', items.length);
      persistItemsLocal();
    }
    if(JSONBIN_ORDERS_BIN_ID){
      const remoteOrders = await jsonbinGet(JSONBIN_ORDERS_BIN_ID);
      if(Array.isArray(remoteOrders)) orders = remoteOrders;
      else if(remoteOrders && Array.isArray(remoteOrders.orders)) orders = remoteOrders.orders;
      else if(remoteOrders && remoteOrders.orders === undefined && Array.isArray(remoteOrders)) orders = remoteOrders;
      log('Loaded orders from jsonbin, count:', orders.length);
      persistOrdersLocal();
    }
  }catch(e){
    console.warn('jsonbin init failed, using local files:', e.message);
  }
})();

// Save helpers that try jsonbin then fallback to local
async function saveItemsRemoteOrLocal(){
  if(JSONBIN_ITEMS_BIN_ID){
    try{
      // write wrapper { items: [...] } to keep structure
      await jsonbinPut(JSONBIN_ITEMS_BIN_ID, { items });
      log('Saved items to jsonbin');
      return;
    }catch(e){
      console.warn('jsonbin put items failed', e.message);
    }
  }
  persistItemsLocal();
}

async function saveOrdersRemoteOrLocal(){
  if(JSONBIN_ORDERS_BIN_ID){
    try{
      await jsonbinPut(JSONBIN_ORDERS_BIN_ID, { orders });
      log('Saved orders to jsonbin');
      return;
    }catch(e){
      console.warn('jsonbin put orders failed', e.message);
    }
  }
  persistOrdersLocal();
}

// Basic anti-spam
const lastOrderByIp = new Map();
const lastOrderByName = new Map();
const SPAM_WINDOW_MS = 8 * 1000; // 8s

// Routes
app.get('/api/items', (req, res) => res.json(items));

app.post('/api/addItem', async (req, res) => {
  const { title, price, description, stock, img, active } = req.body;
  if(!title || price === undefined) return res.status(400).json({ error: 'title and price required' });
  const id = Date.now().toString();
  const it = { id, title: String(title), price: Number(price), description: description || '', stock: Number(stock) || 0, img: img || '/images/orbital.svg', active: active===undefined ? true : !!active };
  items.push(it);
  await saveItemsRemoteOrLocal();
  io.emit('itemsUpdate', { action:'add', item: it });
  res.json({ success:true, item: it });
});

app.post('/api/updateItem', async (req, res) => {
  const { id, title, price, description, stock, img, active } = req.body;
  const it = items.find(x => x.id === String(id));
  if(!it) return res.status(404).json({ error: 'Item not found' });
  if(title !== undefined) it.title = title;
  if(price !== undefined) it.price = Number(price);
  if(description !== undefined) it.description = description;
  if(stock !== undefined) it.stock = Number(stock);
  if(img !== undefined) it.img = img;
  if(active !== undefined) it.active = !!active;
  await saveItemsRemoteOrLocal();
  io.emit('itemsUpdate', { action:'update', item: it });
  io.emit('stockUpdate', { id: it.id, stock: it.stock });
  res.json({ success:true, item: it });
});

app.post('/api/deleteItem', async (req, res) => {
  const { id } = req.body;
  const idx = items.findIndex(i => i.id === String(id));
  if(idx === -1) return res.status(404).json({ error: 'Item not found' });
  const removed = items.splice(idx, 1)[0];
  await saveItemsRemoteOrLocal();
  io.emit('itemsUpdate', { action:'delete', id: removed.id });
  res.json({ success:true, item: removed });
});

app.post('/api/order', async (req, res) => {
  const { name, itemId, quantity } = req.body;
  if(!name || !itemId || !quantity) return res.status(400).json({ error: 'Вкажіть ім\'я та кількість' });
  const it = items.find(i => i.id === String(itemId));
  if(!it) return res.status(400).json({ error: 'Товар не знайдено' });
  const q = Number(quantity);
  if(!Number.isInteger(q) || q <= 0) return res.status(400).json({ error: 'Кількість має бути цілим позитивним числом' });
  if(it.stock < q) return res.status(400).json({ error: 'Немає достатньої кількості на складі', available: it.stock });
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const lastIp = lastOrderByIp.get(ip) || 0;
  const lastName = lastOrderByName.get(name) || 0;
  if(now - lastIp < SPAM_WINDOW_MS || now - lastName < SPAM_WINDOW_MS){
    return res.status(429).json({ error: 'Забагато запитів. Зачекайте кілька секунд.' });
  }
  // decrease stock and create order
  it.stock -= q;
  const total = it.price * q;
  const order = { id: Date.now().toString(), name, item: { id: it.id, title: it.title, price: it.price }, quantity: q, total, status: 'pending', createdAt: new Date().toISOString() };
  orders.unshift(order);
  lastOrderByIp.set(ip, now);
  lastOrderByName.set(name, now);
  await saveOrdersRemoteOrLocal();
  await saveItemsRemoteOrLocal();
  io.emit('newOrder', order);
  io.emit('stockUpdate', { id: it.id, stock: it.stock });
  io.emit('ordersUpdate', orders);
  res.json({ success:true, order });
});

app.get('/api/orders', (req, res) => res.json(orders));

app.post('/api/orders/:id/approve', async (req, res) => {
  const id = req.params.id;
  const ord = orders.find(o => o.id === id);
  if(!ord) return res.status(404).json({ error: 'Order not found' });
  ord.status = 'approved';
  await saveOrdersRemoteOrLocal();
  io.emit('ordersUpdate', orders);
  res.json({ success:true, order: ord });
});

app.post('/api/orders/:id/reject', async (req, res) => {
  const id = req.params.id;
  const ord = orders.find(o => o.id === id);
  if(!ord) return res.status(404).json({ error: 'Order not found' });
  ord.status = 'rejected';
  const it = items.find(i => i.id === ord.item.id);
  if(it) it.stock += ord.quantity;
  await saveOrdersRemoteOrLocal();
  await saveItemsRemoteOrLocal();
  io.emit('ordersUpdate', orders);
  io.emit('stockUpdate', { id: it ? it.id : null, stock: it ? it.stock : 0 });
  res.json({ success:true, order: ord });
});

app.post('/api/orders/:id/cancel', async (req, res) => {
  const id = req.params.id;
  const reason = req.body.reason || req.query.reason || 'Не вказано';
  const ord = orders.find(o => o.id === id);
  if(!ord) return res.status(404).json({ error: 'Order not found' });
  ord.status = 'cancelled';
  ord.cancellationReason = reason;
  const it = items.find(i => i.id === ord.item.id);
  if(it) it.stock += ord.quantity;
  await saveOrdersRemoteOrLocal();
  await saveItemsRemoteOrLocal();
  io.emit('ordersUpdate', orders);
  io.emit('stockUpdate', { id: it ? it.id : null, stock: it ? it.stock : 0 });
  io.emit('orderCancelled', { order: ord, reason });
  res.json({ success:true, order: ord });
});

app.post('/api/orders/clear', async (req, res) => { orders = []; await saveOrdersRemoteOrLocal(); io.emit('ordersUpdate', orders); res.json({ success:true }); });

app.get('/api/myorders', (req, res) => {
  const name = req.query.name;
  if(!name) return res.status(400).json({ error: 'Name required' });
  res.json(orders.filter(o => o.name === name));
});

app.get('/api/summary', (req, res) => {
  const approved = orders.filter(o => o.status === 'approved');
  const count = approved.length;
  const revenue = approved.reduce((s,o) => s + (o.total||0), 0);
  res.json({ approvedCount: count, revenue });
});

// 404 for /api
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
http.listen(PORT, ()=> console.log('[start] Server on http://localhost:'+PORT+' — PID:'+process.pid));
http.listen(PORT, () => log('Server listening on http://localhost:' + PORT));
