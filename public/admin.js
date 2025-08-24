document.addEventListener('DOMContentLoaded', () => {
  const pendingList = document.getElementById('pendingList');
  const approvedList = document.getElementById('approvedList');
  const rejectedList = document.getElementById('rejectedList');
  const cancelledList = document.getElementById('cancelledList');
  const itemsList = document.getElementById('itemsList');
  const adminSummary = document.getElementById('adminSummary');
  const clearBtn = document.getElementById('clearOrdersBtn');
  const logout = document.getElementById('logout');
  const socket = io();
  const API_BASE = window.location.origin + '/api';

  if (logout) logout.addEventListener('click', ()=> { localStorage.removeItem('isAdmin'); location.href='/'; });

  async function safeJson(res){
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (!res.ok) {
      try { const j = JSON.parse(text); throw new Error(j.error || JSON.stringify(j)); } catch(e){ throw new Error('Server error (status='+res.status+'): ' + text.slice(0,200)); }
    }
    if (!ct.includes('application/json')) {
      throw new Error('Expected JSON but got HTML from ' + (res.url || '') + ' (status='+res.status+')\n' + text.slice(0,300));
    }
    return JSON.parse(text);
  }

  async function fetchAndRender(){
    try{
      const [ordersRes, itemsRes, summaryRes] = await Promise.all([ fetch(API_BASE + '/orders'), fetch(API_BASE + '/items'), fetch(API_BASE + '/summary') ]);
      const orders = await safeJson(ordersRes);
      const items = await safeJson(itemsRes);
      const summary = await safeJson(summaryRes);
      renderOrders(orders);
      renderItems(items);
      renderSummary(summary);
    }catch(e){ console.error('Failed to fetch admin data', e); alert('Помилка завантаження даних адмінки:\n' + e.message); }
  }

  function renderOrders(orders){
    pendingList.innerHTML=''; approvedList.innerHTML=''; rejectedList.innerHTML=''; if (cancelledList) cancelledList.innerHTML='';
    orders.forEach(o => {
      const el = document.createElement('div');
      el.className = 'admin-item';
      el.innerHTML = '<div><strong>' + escapeHtml(o.item.title) + ' × ' + o.quantity + '</strong><div class="meta">' + escapeHtml(o.name) + ' • ' + new Date(o.createdAt).toLocaleString() + '</div><div class="meta">Статус: <strong>' + o.status + '</strong></div>' + (o.cancellationReason?('<div class="meta">Причина: '+escapeHtml(o.cancellationReason)+'</div>'):'') + '</div><div style="text-align:right"><div style="margin-bottom:8px">' + o.total + ' грн</div><div class="admin-actions"></div></div>';
      const actions = el.querySelector('.admin-actions');
      if (o.status === 'pending'){
        const a = document.createElement('button'); a.className='btn-primary'; a.textContent='Approve'; a.addEventListener('click', ()=> approve(o.id));
        const r = document.createElement('button'); r.className='btn-secondary'; r.textContent='Reject'; r.style.marginLeft='8px'; r.addEventListener('click', ()=> reject(o.id));
        actions.appendChild(a); actions.appendChild(r);
        pendingList.appendChild(el);
      } else if (o.status === 'approved'){
        approvedList.appendChild(el);
      } else if (o.status === 'cancelled'){
        if (cancelledList) cancelledList.appendChild(el);
      } else {
        rejectedList.appendChild(el);
      }
    });
  }

  function renderItems(items){
    itemsList.innerHTML='';
    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'product-card';
      row.style.padding = '10px';
      row.style.marginBottom = '10px';
      row.innerHTML = '<div style="display:flex;gap:12px;align-items:center"><img src="' + it.img + '" style="width:90px;height:64px;object-fit:cover;border-radius:8px"/><div style="flex:1"><strong style="color:var(--accent)">' + escapeHtml(it.title) + (it.active ? '' : ' <span style=\"color:#f39c12\">(знято)</span>') + '</strong><div class=\"meta\">' + escapeHtml(it.description) + '</div></div><div style=\"text-align:right\"><input id=\"stock_' + it.id + '\" type=\"number\" value=\"' + it.stock + '\" style=\"width:80px;padding:6px;border-radius:8px;background:transparent;border:1px solid rgba(255,255,255,0.04);color:inherit\"/><div style=\"margin-top:8px\"><button class=\"btn-primary\" data-id=\"' + it.id + '\">Update</button><button style=\"margin-left:8px\" class=\"btn-secondary\" data-action-item=\"toggleActive\" data-id=\"' + it.id + '\" data-active=\"' + (it.active ? 'true' : 'false') + '\">' + (it.active ? 'Зняти з продажу' : 'Виставити') + '</button><button style=\"margin-left:8px\" class=\"btn-secondary\" data-action-item=\"deleteItem\" data-id=\"' + it.id + '\">Видалити</button></div></div></div>';
      itemsList.appendChild(row);
      const btn = row.querySelector('.btn-primary');
      if (btn) btn.addEventListener('click', async ()=>{ const v = Number(row.querySelector('#stock_'+it.id).value) || 0; try{ const res = await fetch(API_BASE + '/updateItem', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, stock: v })}); if (!res.ok) throw new Error(await res.text()); await fetchAndRender(); }catch(e){ alert('Помилка оновлення складу: '+e.message); } });
    });
  }

  function renderSummary(summary){ if (adminSummary) adminSummary.innerHTML = 'Успішних: <strong>' + summary.approvedCount + '</strong> — Прибуток: <strong>' + summary.revenue + ' грн</strong>'; }

  async function approve(id){ try{ const res = await fetch(API_BASE + '/orders/' + encodeURIComponent(id) + '/approve', { method:'POST' }); if (!res.ok) throw new Error(await res.text()); await fetchAndRender(); }catch(e){ alert('Approve failed: '+e.message); } }
  async function reject(id){ try{ const res = await fetch(API_BASE + '/orders/' + encodeURIComponent(id) + '/reject', { method:'POST' }); if (!res.ok) throw new Error(await res.text()); await fetchAndRender(); }catch(e){ alert('Reject failed: '+e.message); } }
  async function clearAll(){ if (!confirm('Очистити всі замовлення?')) return; try{ const res = await fetch(API_BASE + '/orders/clear', { method:'POST' }); if (!res.ok) throw new Error(await res.text()); await fetchAndRender(); }catch(e){ alert('Clear failed: '+e.message); } }

  // Add item via admin form
  const addBtn = document.getElementById('addItemBtn');
  if (addBtn) addBtn.addEventListener('click', async ()=>{ const title = document.getElementById('new_title').value.trim(); const price = Number(document.getElementById('new_price').value.trim()); const stock = Number(document.getElementById('new_stock').value.trim()) || 0; const img = document.getElementById('new_img').value.trim() || '/images/orbital.svg'; if (!title || !price){ alert('Вкажіть назву та ціну'); return; } try{ const res = await fetch(API_BASE + '/addItem', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, price, stock, img })}); if (!res.ok) throw new Error(await res.text()); await fetchAndRender(); document.getElementById('new_title').value=''; document.getElementById('new_price').value=''; document.getElementById('new_stock').value=''; document.getElementById('new_img').value=''; alert('Товар додано'); }catch(e){ alert('Add item failed: '+e.message); } });

  // delegation for toggleActive and deleteItem
  document.body.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-action-item]');
    if (!btn) return;
    const action = btn.getAttribute('data-action-item');
    const id = btn.getAttribute('data-id');
    if (action === 'toggleActive'){
      (async ()=>{ try{ const res = await fetch(API_BASE + '/updateItem', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, active: btn.dataset.active === 'true' ? false : true })}); if (!res.ok) throw new Error(await res.text()); await fetchAndRender(); }catch(e){ alert('Toggle failed: '+e.message); } })();
    } else if (action === 'deleteItem'){
      (async ()=>{ if (!confirm('Видалити товар?')) return; try{ const res = await fetch(API_BASE + '/deleteItem', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id })}); if (!res.ok) throw new Error(await res.text()); await fetchAndRender(); }catch(e){ alert('Delete failed: '+e.message); } })();
    }
  });

  const clearBtnElem = document.getElementById('clearOrdersBtn');
  if (clearBtnElem) clearBtnElem.addEventListener('click', clearAll);

  socket.on('connect', ()=> console.log('admin socket connected'));
  socket.on('newOrder', (order)=> { fetchAndRender(); flash(); showToast('Новий заказ: ' + (order?.item?.title || '') + ' × ' + (order?.quantity || '')); });
  socket.on('ordersUpdate', ()=> { fetchAndRender(); });
  socket.on('stockUpdate', ()=> { fetchAndRender(); });
  socket.on('itemsUpdate', ()=> { fetchAndRender(); });
  socket.on('orderCancelled', (payload)=> { fetchAndRender(); flash(); showToast('Відміна: ' + (payload?.order?.item?.title||'') + ' — ' + (payload?.reason||'')); });

  function flash(){ document.body.style.boxShadow = 'inset 0 0 30px rgba(183,255,0,0.06)'; setTimeout(()=> document.body.style.boxShadow = '', 600); }
  function showToast(message){ const t=document.createElement('div'); t.className='toast show'; t.textContent=message; const cont=document.getElementById('toasts')||(()=>{const c=document.createElement('div'); c.id='toasts'; document.body.appendChild(c); return c; })(); cont.appendChild(t); setTimeout(()=>{ t.classList.remove('show'); t.remove(); }, 3500); }

  fetchAndRender();
});

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, (m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
