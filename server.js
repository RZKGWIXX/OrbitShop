/* Remote-store adapter server.js
   This is an example Express server that demonstrates how to persist items/orders
   to a remote JSON endpoint (e.g. JSON Bin / other JSON-hosting service).
   It is intentionally backend-only: it serves as a drop-in replacement or reference
   for your existing server.js. It does NOT include frontend files.
   
   USAGE:
   - Place this server.js into your project (replace your current server.js)
   - Install dependencies: npm install express socket.io body-parser node-fetch
   - Configure environment variables (optional):
       REMOTE_ITEMS_URL  - full URL to fetch/replace items JSON
       REMOTE_ORDERS_URL - full URL to fetch/replace orders JSON
       REMOTE_API_KEY    - optional API key used in Authorization: Bearer <key>
   The code will try remote on startup and use remote for save operations; if remote fails it'll fallback to local files orders.json/items.json.
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

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const ITEMS_FILE = path.join(__dirname, 'items.json');

const REMOTE_ITEMS_URL = process.env.REMOTE_ITEMS_URL || null;
const REMOTE_ORDERS_URL = process.env.REMOTE_ORDERS_URL || null;
const REMOTE_API_KEY = process.env.REMOTE_API_KEY || null;

let orders = [];
let items = [];

// local fallback templates (if you want some initial items)
const DEFAULT_ITEMS = [
  { id: '1', title: 'Шипучка', price: 2, description: 'Освіжаюча шипучка', stock: 15, img: '/images/orbital.svg', active: true }
];

function log(){ console.log.apply(console, arguments); }

async function remoteGet(url){
  if(!url) throw new Error('No remote URL provided');
  const headers = {};
  if(REMOTE_API_KEY) headers['Authorization'] = 'Bearer ' + REMOTE_API_KEY;
  const res = await fetch(url, { method: 'GET', headers });
  if(!res.ok) throw new Error('Remote GET failed: ' + res.status + ' ' + await res.text());
  return await res.json();
}
async function remoteReplace(url, data){
  if(!url) throw new Error('No remote URL provided');
  const headers = {'Content-Type': 'application/json'};
  if(REMOTE_API_KEY) headers['Authorization'] = 'Bearer ' + REMOTE_API_KEY;
  // try PUT then POST
  let res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(data) });
  if(res.ok){
    try{ return await res.json(); }catch(e){ return { success:true }; }
  }
  res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
  if(res.ok){ try{ return await res.json(); }catch(e){ return { success:true }; } }
  throw new Error('Remote write failed: ' + res.status + ' ' + await res.text());
}

function persistOrdersLocal(){ try{ fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders,null,2),'utf8'); }catch(e){ console.error(e); } }
function persistItemsLocal(){ try{ fs.writeFileSync(ITEMS_FILE, JSON.stringify(items,null,2),'utf8'); }catch(e){ console.error(e); } }

// Load local files if exist
try{ if(fs.existsSync(ORDERS_FILE)) orders = JSON.parse(fs.readFileSync(ORDERS_FILE,'utf8')); }catch(e){ console.warn('Failed reading orders.json', e); }
try{ if(fs.existsSync(ITEMS_FILE)) items = JSON.parse(fs.readFileSync(ITEMS_FILE,'utf8')); }catch(e){ console.warn('Failed reading items.json', e); }
if(!items || items.length === 0) items = DEFAULT_ITEMS.slice();

// Try to initialize from remote if configured
(async function initRemote(){
  try{
    if(REMOTE_ITEMS_URL){
      const remoteItems = await remoteGet(REMOTE_ITEMS_URL);
      if(Array.isArray(remoteItems) && remoteItems.length) items = remoteItems;
      log('Loaded items from remote');
    }
    if(REMOTE_ORDERS_URL){
      const remoteOrders = await remoteGet(REMOTE_ORDERS_URL);
      if(Array.isArray(remoteOrders)) orders = remoteOrders;
      log('Loaded orders from remote');
    }
  }catch(e){
    log('Remote init failed, using local data:', e.message);
  }
})();

async function saveItems(){ if(REMOTE_ITEMS_URL){ try{ await remoteReplace(REMOTE_ITEMS_URL, items); return; }catch(e){ console.warn('Remote saveItems failed', e.message); } } persistItemsLocal(); }
async function saveOrders(){ if(REMOTE_ORDERS_URL){ try{ await remoteReplace(REMOTE_ORDERS_URL, orders); return; }catch(e){ console.warn('Remote saveOrders failed', e.message); } } persistOrdersLocal(); }

// basic routes similar to previous server (you can merge into your existing server)
app.get('/api/items', (req,res)=> res.json(items));
app.post('/api/addItem', async (req,res)=>{ const { title, price, description, stock, img, active } = req.body; if(!title||price===undefined) return res.status(400).json({error:'title and price required'}); const id = Date.now().toString(); const it = { id, title:String(title), price:Number(price), description:description||'', stock:Number(stock)||0, img:img||'/images/orbital.svg', active: active===undefined?true:!!active }; items.push(it); await saveItems(); io.emit('itemsUpdate', {action:'add', item:it}); res.json({success:true,item:it}); });
app.post('/api/updateItem', async (req,res)=>{ const { id, stock, title, price, active } = req.body; const it = items.find(x=>x.id===String(id)); if(!it) return res.status(404).json({error:'Item not found'}); if(stock!==undefined) it.stock = Number(stock); if(title!==undefined) it.title = title; if(price!==undefined) it.price = Number(price); if(active!==undefined) it.active = !!active; await saveItems(); io.emit('itemsUpdate',{action:'update', item: it}); io.emit('stockUpdate',{id:it.id, stock: it.stock}); res.json({success:true,item:it}); });
app.post('/api/deleteItem', async (req,res)=>{ const { id } = req.body; const idx = items.findIndex(i=>i.id===String(id)); if(idx===-1) return res.status(404).json({error:'Item not found'}); const removed = items.splice(idx,1)[0]; await saveItems(); io.emit('itemsUpdate',{action:'delete', id: removed.id}); res.json({success:true,item:removed}); });

// orders endpoints (same semantics as your current server)
app.post('/api/order', async (req,res)=>{ const { name, itemId, quantity } = req.body; if(!name||!itemId||!quantity) return res.status(400).json({ error: "Вкажіть ім'я та кількість" }); const it = items.find(i=>i.id===String(itemId)); if(!it) return res.status(400).json({ error: 'Товар не знайдено' }); const q = Number(quantity); if(!Number.isInteger(q)||q<=0) return res.status(400).json({ error: 'Кількість має бути цілим позитивним числом' }); if(it.stock < q) return res.status(400).json({ error:'Немає достатньої кількості на складі', available: it.stock }); it.stock -= q; const total = it.price * q; const order = { id: Date.now().toString(), name, item:{id: it.id, title: it.title, price: it.price}, quantity: q, total, status:'pending', createdAt: new Date().toISOString() }; orders.unshift(order); await saveOrders(); await saveItems(); io.emit('newOrder', order); io.emit('stockUpdate', { id: it.id, stock: it.stock }); io.emit('ordersUpdate', orders); res.json({ success:true, order }); });

app.get('/api/orders', (req,res)=> res.json(orders));
app.post('/api/orders/:id/approve', async (req,res)=>{ const id = req.params.id; const ord = orders.find(o=>o.id===id); if(!ord) return res.status(404).json({error:'Order not found'}); ord.status = 'approved'; await saveOrders(); io.emit('ordersUpdate', orders); res.json({success:true,order:ord}); });
app.post('/api/orders/:id/reject', async (req,res)=>{ const id = req.params.id; const ord = orders.find(o=>o.id===id); if(!ord) return res.status(404).json({error:'Order not found'}); ord.status = 'rejected'; const it = items.find(i=>i.id===ord.item.id); if(it) it.stock += ord.quantity; await saveOrders(); await saveItems(); io.emit('ordersUpdate', orders); io.emit('stockUpdate', { id: it? it.id : null, stock: it? it.stock : 0 }); res.json({success:true, order: ord}); });
app.post('/api/orders/:id/cancel', async (req,res)=>{ const id = req.params.id; const reason = req.body.reason || req.query.reason || 'Не вказано'; const ord = orders.find(o=>o.id===id); if(!ord) return res.status(404).json({error:'Order not found'}); ord.status = 'cancelled'; ord.cancellationReason = reason; const it = items.find(i=>i.id===ord.item.id); if(it) it.stock += ord.quantity; await saveOrders(); await saveItems(); io.emit('ordersUpdate', orders); io.emit('stockUpdate', { id: it? it.id : null, stock: it? it.stock : 0 }); io.emit('orderCancelled', { order: ord, reason }); res.json({success:true, order: ord}); });

app.post('/api/orders/clear', async (req,res)=>{ orders = []; await saveOrders(); io.emit('ordersUpdate', orders); res.json({ success:true }); });
app.get('/api/myorders', (req,res)=>{ const name = req.query.name; if(!name) return res.status(400).json({ error: 'Name required' }); res.json(orders.filter(o=>o.name===name)); });
app.get('/api/summary', (req,res)=>{ const approved = orders.filter(o=>o.status==='approved'); const count = approved.length; const revenue = approved.reduce((s,o)=>s+(o.total||0), 0); res.json({ approvedCount: count, revenue }); });

app.use('/api', (req,res)=> res.status(404).json({ error:'API endpoint not found' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

const PORT = process.env.PORT || 3000;
http.listen(PORT, ()=> log('Server listening on http://localhost:'+PORT));