const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

app.use(bodyParser.json());
app.set('trust proxy', true);

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const ITEMS_FILE = path.join(__dirname, 'items.json');

let orders = [];
let items = [
  { id: '1', title: 'Шипучка', price: 2, description: 'Освіжаюча шипучка', stock: 15, img: '/images/orbital.svg', active: true },
  { id: '2', title: 'Player Kicker', price: 1, description: 'Програма для викиду гравців', stock: 8, img: '/images/icon.svg', active: true }
];

try {
  if (fs.existsSync(ORDERS_FILE)) orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
} catch(e){ console.warn('Failed loading orders.json', e); }
try {
  if (fs.existsSync(ITEMS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'));
    if (Array.isArray(parsed) && parsed.length) items = parsed;
  }
} catch(e){ console.warn('Failed loading items.json', e); }

function persistOrders(){ try{ fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8'); }catch(e){console.error(e);} }
function persistItems(){ try{ fs.writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2), 'utf8'); }catch(e){console.error(e);} }

const lastOrderByIp = new Map();
const lastOrderByName = new Map();
const SPAM_WINDOW_MS = 10 * 1000;

app.get('/api/items', (req, res) => {
  res.json(items);
});

app.post('/api/addItem', (req, res) => {
  const { title, price, description, stock, img, active } = req.body;
  if (!title || price === undefined) return res.status(400).json({ error: 'title and price required' });
  const id = Date.now().toString();
  const it = { id, title: String(title), price: Number(price), description: description||'', stock: Number(stock)||0, img: img||'/images/orbital.svg', active: active===undefined?true:!!active };
  items.push(it);
  persistItems();
  io.emit('itemsUpdate', { action:'add', item: it });
  res.json({ success:true, item: it });
});

app.post('/api/updateItem', (req, res) => {
  const { id, title, price, description, stock, img, active } = req.body;
  const it = items.find(x => x.id === String(id));
  if (!it) return res.status(404).json({ error: 'Item not found' });
  if (title !== undefined) it.title = title;
  if (price !== undefined) it.price = Number(price);
  if (description !== undefined) it.description = description;
  if (stock !== undefined) it.stock = Number(stock);
  if (img !== undefined) it.img = img;
  if (active !== undefined) it.active = !!active;
  persistItems();
  io.emit('itemsUpdate', { action:'update', item: it });
  io.emit('stockUpdate', { id: it.id, stock: it.stock });
  res.json({ success:true, item: it });
});

app.post('/api/deleteItem', (req, res) => {
  const { id } = req.body;
  const idx = items.findIndex(i => i.id === String(id));
  if (idx === -1) return res.status(404).json({ error:'Item not found' });
  const removed = items.splice(idx,1)[0];
  persistItems();
  io.emit('itemsUpdate', { action:'delete', id: removed.id });
  res.json({ success:true, item: removed });
});

app.post('/api/order', (req, res) => {
  const { name, itemId, quantity } = req.body;
  if (!name || !itemId || !quantity) return res.status(400).json({ error: "Вкажіть ім'я та кількість" });
  const it = items.find(i => i.id === String(itemId));
  if (!it) return res.status(400).json({ error: 'Товар не знайдено' });
  const q = Number(quantity);
  if (!Number.isInteger(q) || q <= 0) return res.status(400).json({ error: 'Кількість має бути цілим позитивним числом' });
  if (it.stock < q) return res.status(400).json({ error: 'Немає достатньої кількості на складі', available: it.stock });
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const lastIp = lastOrderByIp.get(ip) || 0;
  const lastName = lastOrderByName.get(name) || 0;
  if (now - lastIp < SPAM_WINDOW_MS || now - lastName < SPAM_WINDOW_MS) {
    return res.status(429).json({ error: 'Забагато запитів. Зачекайте кілька секунд.' });
  }
  it.stock -= q;
  const total = it.price * q;
  const order = { id: Date.now().toString(), name, item:{id: it.id, title: it.title, price: it.price}, quantity: q, total, status:'pending', createdAt: new Date().toISOString() };
  orders.unshift(order);
  lastOrderByIp.set(ip, now);
  lastOrderByName.set(name, now);
  persistOrders();
  persistItems();
  io.emit('newOrder', order);
  io.emit('stockUpdate', { id: it.id, stock: it.stock });
  io.emit('ordersUpdate', orders);
  res.json({ success:true, order });
});

app.get('/api/orders', (req, res) => res.json(orders));

app.post('/api/orders/:id/approve', (req, res) => {
  const id = req.params.id;
  const ord = orders.find(o => o.id === id);
  if (!ord) return res.status(404).json({ error:'Order not found' });
  ord.status = 'approved';
  persistOrders();
  io.emit('ordersUpdate', orders);
  res.json({ success:true, order: ord });
});

app.post('/api/orders/:id/reject', (req, res) => {
  const id = req.params.id;
  const ord = orders.find(o => o.id === id);
  if (!ord) return res.status(404).json({ error:'Order not found' });
  ord.status = 'rejected';
  // return stock if pending?
  const it = items.find(i => i.id === ord.item.id);
  if (it) it.stock += ord.quantity;
  persistOrders();
  persistItems();
  io.emit('ordersUpdate', orders);
  io.emit('stockUpdate', { id: it ? it.id : null, stock: it ? it.stock : 0 });
  res.json({ success:true, order: ord });
});

app.post('/api/orders/:id/cancel', (req, res) => {
  const id = req.params.id;
  const reason = req.body.reason || req.query.reason || 'Не вказано';
  const ord = orders.find(o => o.id === id);
  if (!ord) return res.status(404).json({ error:'Order not found' });
  ord.status = 'cancelled';
  ord.cancellationReason = reason;
  const it = items.find(i => i.id === ord.item.id);
  if (it) it.stock += ord.quantity;
  persistOrders();
  persistItems();
  io.emit('ordersUpdate', orders);
  io.emit('stockUpdate', { id: it ? it.id : null, stock: it ? it.stock : 0 });
  io.emit('orderCancelled', { order: ord, reason });
  res.json({ success:true, order: ord });
});

app.post('/api/orders/clear', (req, res) => { orders = []; persistOrders(); io.emit('ordersUpdate', orders); res.json({ success:true }); });

app.get('/api/myorders', (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.json(orders.filter(o => o.name === name));
});

app.get('/api/summary', (req, res) => {
  const approved = orders.filter(o => o.status === 'approved');
  const count = approved.length;
  const revenue = approved.reduce((s,o)=>s+(o.total||0), 0);
  res.json({ approvedCount: count, revenue });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public','index.html')));

const PORT = process.env.PORT || 3000;
http.listen(PORT, ()=> console.log('Server on http://localhost:'+PORT));