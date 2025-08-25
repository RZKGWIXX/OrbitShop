
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('products-grid');
  const loading = document.getElementById('loading-overlay');
  const secretBtn = document.getElementById('secretBtn');
  let items = [];
  const socket = io();
  function showLoading(show) { if (show) loading.classList.add('show'); else loading.classList.remove('show'); }
  function showToast(message){ const t=document.createElement('div'); t.className='toast show'; t.textContent=message; const cont=document.getElementById('toasts')||(()=>{const c=document.createElement('div'); c.id='toasts'; document.body.appendChild(c); return c;})(); cont.appendChild(t); setTimeout(()=>{ t.remove(); }, 3500); }
  function setHeaderNick(name){ const el=document.getElementById('headerNick'); if(el) el.textContent = name || 'Гість'; }
  function ensureBuyerName(){ return new Promise((resolve)=>{ let name = localStorage.getItem('buyerName') || ''; if (name && name.trim()){ resolve(name); return; } const nm = document.createElement('div'); nm.id='nameModal'; nm.className='modal show'; nm.innerHTML = `<div class="modal-content" style="max-width:420px;padding:18px"><h3>Введіть ваше ім'я</h3><input id="guestNameInput" class="input" placeholder="Ім'я"/><div style="text-align:right;margin-top:12px"><button id="guestNameBtn" class="btn-primary">Зберегти</button></div></div>`; document.body.appendChild(nm); document.getElementById('guestNameBtn').addEventListener('click', ()=>{ const v=document.getElementById('guestNameInput').value.trim(); if(!v){ alert('Введіть ім\'я'); return; } localStorage.setItem('buyerName', v); setHeaderNick(v); nm.remove(); resolve(v); }); }); }
  function ensureMyOrdersUI(){ const navBtn = document.getElementById('navMyOrders'); if(navBtn){ navBtn.addEventListener('click', openMyOrdersModal); return; } if (document.getElementById('myOrdersBtn')) return; const btn=document.createElement('button'); btn.id='myOrdersBtn'; btn.className='btn-secondary'; btn.textContent='Мої замовлення'; document.body.appendChild(btn); btn.addEventListener('click', openMyOrdersModal); }
  async function openMyOrdersModal(){ const name = localStorage.getItem('buyerName'); if(!name){ showToast('Вкажіть ім\'я спочатку'); return; } let modal=document.getElementById('myOrdersModal'); if(!modal){ modal=document.createElement('div'); modal.id='myOrdersModal'; modal.className='modal'; modal.innerHTML=`<div class="modal-content" style="max-width:560px;padding:16px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Мої замовлення</h3><button id="closeMyOrders" class="btn-secondary">✕</button></div><div id="myOrdersList" style="margin-top:12px;max-height:400px;overflow:auto"></div></div>`; document.body.appendChild(modal); modal.querySelector('#closeMyOrders').addEventListener('click', ()=> modal.classList.remove('show')); } modal.classList.add('show'); const list = modal.querySelector('#myOrdersList'); list.innerHTML='Завантаження...'; try{ const res = await fetch('/api/myorders?name=' + encodeURIComponent(name)); const data = await res.json(); if(!Array.isArray(data)){ list.innerHTML='Помилка'; return; } if(data.length===0){ list.innerHTML='Замовлень немає'; return; } list.innerHTML=''; data.forEach(o=>{ const el=document.createElement('div'); el.className='order'; el.innerHTML = '<div style="display:flex;justify-content:space-between"><strong>'+escapeHtml(o.item.title)+' × '+o.quantity+'</strong><div>'+escapeHtml(o.status)+'</div></div><div class="order-meta">'+new Date(o.createdAt).toLocaleString()+(o.cancellationReason?(' — Причина: '+escapeHtml(o.cancellationReason)): '')+'</div>'; if(o.status==='pending'){ const cancelBtn=document.createElement('button'); cancelBtn.className='btn-secondary'; cancelBtn.textContent='Відмінити'; cancelBtn.addEventListener('click', ()=>{ const reason = prompt('Причина відміни (опц):')||'Не вказано'; fetch('/api/orders/'+encodeURIComponent(o.id)+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ reason })}).then(r=>r.json()).then(resp=>{ if(resp.error) { showToast('Не вдалося'); return; } showToast('Відмінено'); openMyOrdersModal(); }) }); el.appendChild(cancelBtn); } list.appendChild(el); }); }catch(e){ list.innerHTML='Помилка завантаження'; } }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, (m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  async function fetchItems(){ try{ const res = await fetch('/api/items'); items = await res.json(); render(); }catch(e){ showToast('Не вдалось завантажити товари'); } }
  function render(){ grid.innerHTML=''; items.forEach(it=>{ if(it.active===false) return; const card=document.createElement('div'); card.className='product-card'; card.dataset.productId=it.id; card.innerHTML = `<div class="product-image"><img src="${it.img}" alt="${it.title}"></div><div class="product-header"><div><h3 class="product-title">${escapeHtml(it.title)}</h3></div><div class="product-price">${it.price} грн</div></div><p class="product-description">${escapeHtml(it.description)}</p><div style="padding:0 12px 12px;"><span class="feature-tag">В наявності: ${it.stock}</span></div><div style="padding:0 12px 18px;"><button class="buy-button" ${it.stock<=0 ? 'disabled' : ''} data-action="order">Замовити</button></div>`; grid.appendChild(card); }); }
  document.body.addEventListener('click',(e)=>{ const btn = e.target.closest('[data-action]'); if(!btn) return; const action = btn.getAttribute('data-action'); if(action==='order'){ const card = btn.closest('.product-card'); const id = card && card.dataset.productId; const item = items.find(x=>x.id===id); if(!item){ showToast('Товар не знайдено'); return; } openOrderModal(item); } });
  secretBtn.addEventListener('click', ()=>{ const p=prompt('Enter admin password:'); if(p==='236790'){ localStorage.setItem('isAdmin','1'); alert('Admin'); window.location.href='/admin.html'; } else alert('Wrong'); });
  function openOrderModal(item){ let modal = document.getElementById('orderModal'); if(!modal){ modal=document.createElement('div'); modal.id='orderModal'; modal.className='modal'; modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h3>Підтвердження замовлення</h3><button id="closeModal" class="btn-secondary">✕</button></div><div class="modal-body"></div></div>`; document.body.appendChild(modal); modal.querySelector('#closeModal').addEventListener('click', ()=> modal.classList.remove('show')); } const body = modal.querySelector('.modal-body'); body.innerHTML = `<div style="display:flex;gap:18px;flex-wrap:wrap"><div style="flex:1;min-width:220px"><img src="${item.img}" style="width:100%;border-radius:8px;max-height:220px;object-fit:cover"/><h3 style="margin-top:10px">${escapeHtml(item.title)}</h3><p style="color:var(--muted)">${escapeHtml(item.description)}</p></div><div style="flex:1;min-width:220px"><div style="margin-bottom:8px"><strong>Ім'я:</strong> <span id="displayBuyerName"></span></div><label style="margin-top:8px">Кількість *</label><input id="buyQty" type="number" min="1" max="${item.stock}" value="1" class="input"/><div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center"><div><strong>Ціна:</strong> ${item.price} грн</div><div><strong>Разом:</strong> <span id="totalPrice">${item.price} грн</span></div></div><div style="margin-top:14px;display:flex;gap:10px"><button id="confirmOrder" class="btn-primary">Підтвердити</button><button id="cancelOrder" class="btn-secondary">Скасувати</button></div></div></div>`;
    document.getElementById('displayBuyerName') && (document.getElementById('displayBuyerName').textContent = (localStorage.getItem('buyerName')||'Гість'));
    modal.classList.add('show');
    const qty = modal.querySelector('#buyQty'); const total = modal.querySelector('#totalPrice');
    qty.addEventListener('input', ()=>{ const q=Math.max(1, Math.floor(Number(qty.value)||1)); qty.value=q; total.textContent=(item.price*q)+' грн'; });
    modal.querySelector('#cancelOrder').addEventListener('click', ()=> modal.classList.remove('show'));
    modal.querySelector('#confirmOrder').addEventListener('click', async ()=>{
      const name = localStorage.getItem('buyerName') || '';
      const q = Math.max(1, Math.floor(Number(qty.value)||1));
      if (!name){ showToast("Введіть своє ім'я"); return; }
      if (q<1){ showToast('Кількість повинна бути >=1'); return; }
      showLoading(true);
      try{
        const latest = await (await fetch('/api/items')).json();
        const latestItem = latest.find(x=>x.id===item.id);
        if (!latestItem){ showLoading(false); showToast('Товар більше не доступний'); return; }
        if (latestItem.stock < q){ showLoading(false); showToast('Недостатньо на складі. Доступно: ' + latestItem.stock + ' шт'); return; }
        const resp = await fetch('/api/order', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, itemId: item.id, quantity: q }) });
        const data = await resp.json();
        showLoading(false);
        if (!data.success){ showToast(data.error || 'Помилка'); return; }
        showToast('✅ Замовлення прийнято');
        setHeaderNick(name);
        modal.classList.remove('show');
        fetchItems();
      }catch(err){ showLoading(false); console.error(err); showToast('Мережна помилка'); }
    });
  }
  socket.on('connect', ()=> console.log('client socket connected'));
  socket.on('stockUpdate', data => { const it = items.find(x=>x.id===data.id); if (it){ it.stock = data.stock; render(); } });
  socket.on('itemsUpdate', ()=> fetchItems());
  socket.on('orderCancelled', (payload)=> { showToast('Відміна: ' + (payload && payload.order && payload.order.item ? payload.order.item.title : '') + ' — ' + (payload && payload.reason ? payload.reason : '')); fetchItems(); });
  ensureBuyerName().then((name)=>{ setHeaderNick(name); ensureMyOrdersUI(); fetchItems(); });
});
