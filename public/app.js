// Panel del CRM (JavaScript sin dependencias).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `S/${Number(n || 0).toFixed(2)}`;
const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '');
const CHANNEL = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', telegram: 'Telegram', web: 'Pruebas' };
const DELIVERY = { shalom_agencia: 'Shalom agencia', lima_delivery: 'Delivery Lima' };
let STATUS = {};

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(text, ms = 3500) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast('⚠️ ' + e.message, 6000); } finally { if (btn) btn.disabled = false; }
}

// ---------- Navegación
let currentView = 'dashboard';
function show(view) {
  currentView = view;
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  ({ dashboard: loadStats, inbox: loadConversations, orders: loadOrders, products: loadProducts, settings: loadSettings }[view] || (() => {}))();
}
$$('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

// ---------- Resumen
async function loadStats() {
  const s = await api('/stats');
  const cards = [
    ['Ventas hoy', money(s.ventas_hoy)], ['Pedidos hoy', s.pedidos_hoy], ['Ventas del mes', money(s.ventas_mes)],
    ['Cobrado del mes', money(s.cobrado_mes)], ['Vouchers por verificar', s.por_verificar], ['Por despachar', s.por_despachar],
    ['En agencia (cobrar saldo)', s.en_agencia], ['Chats sin atender', s.no_atendidas], ['Entregados (mes)', s.entregados_mes],
    ['Devueltos (mes)', s.devueltos_mes],
  ];
  $('#stats-cards').innerHTML = cards.map(([l, n]) => `<div class="card"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join('');
  const max = Math.max(1, ...s.por_estado.map((x) => x.n));
  $('#stats-status').innerHTML = s.por_estado.length
    ? s.por_estado.map((x) => `<div class="bar"><span class="pill ${esc(x.status)}">${esc(x.status)}</span><div class="fill" style="width:${(x.n / max) * 60}%"></div><b>${x.n}</b></div>`).join('')
    : '<p class="muted">Aún no hay pedidos.</p>';
  const names = { claude: 'Bot IA (Claude)', whatsapp: 'WhatsApp', facebook: 'Facebook Messenger', instagram: 'Instagram', telegram: 'Telegram', shalom: 'Shalom API', shalom_instancia: 'Shalom Pro (instancia)' };
  $('#stats-integrations').innerHTML = Object.entries(s.integraciones)
    .map(([k, v]) => `<div class="${v ? 'ok' : 'no'}">${v ? '✅' : '⬜'} ${names[k] || k}</div>`).join('');
  setBadge('#badge-unattended', s.no_atendidas);
  setBadge('#badge-verify', s.por_verificar);
}
function setBadge(sel, n) { const b = $(sel); b.hidden = !n; b.textContent = n; }

// ---------- Bandeja
let convFilter = { status: '', channel: '', q: '' };
let activeConv = null;

async function loadConversations() {
  const qs = new URLSearchParams(Object.entries(convFilter).filter(([, v]) => v)).toString();
  const rows = await api('/conversations' + (qs ? '?' + qs : ''));
  $('#conv-items').innerHTML = rows.map((c) => `
    <li data-id="${c.id}" class="${c.id === activeConv ? 'active' : ''}">
      <div class="top"><span class="ch ${esc(c.channel)}">${esc(CHANNEL[c.channel] || c.channel)}</span>
        <span class="name">${esc(c.display_name || c.external_id)}</span>
        ${c.unread ? `<span class="unread">${c.unread}</span>` : ''}</div>
      <div class="preview">${c.bot_enabled ? '🤖' : '👤'} ${esc(c.last_body || '')}</div>
    </li>`).join('') || '<li class="muted">Sin conversaciones</li>';
  $$('#conv-items li[data-id]').forEach((li) => li.addEventListener('click', () => openConversation(Number(li.dataset.id))));
}
$('#conv-tabs').addEventListener('click', (e) => {
  if (!e.target.dataset || e.target.tagName !== 'BUTTON') return;
  $$('#conv-tabs button').forEach((b) => b.classList.toggle('active', b === e.target));
  convFilter.status = e.target.dataset.status;
  loadConversations();
});
$('#conv-channel').addEventListener('change', (e) => { convFilter.channel = e.target.value; loadConversations(); });
$('#conv-search').addEventListener('input', debounce((e) => { convFilter.q = e.target.value; loadConversations(); }, 300));

async function openConversation(id) {
  activeConv = id;
  const c = await api('/conversations/' + id);
  $('#chat').innerHTML = `
    <div class="chat-head">
      <span class="ch ${esc(c.channel)}">${esc(CHANNEL[c.channel])}</span>
      <span class="who">${esc(c.display_name || c.external_id)} <small class="muted">${esc(c.external_id)}</small></span>
      <label style="margin:0"><input type="checkbox" id="bot-toggle" ${c.bot_enabled ? 'checked' : ''} style="display:inline;width:auto"> Bot activo</label>
      <select id="conv-status">
        ${['abierta', 'venta', 'no_atendida', 'cerrada'].map((s) => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <button class="secondary" id="btn-new-order">+ Pedido manual</button>
    </div>
    ${c.orders.length ? `<div class="chat-orders">${c.orders.map((o) => `<button class="secondary" data-order="${o.id}">${esc(o.code)} · <span class="pill ${esc(o.status)}">${esc(o.status)}</span> ${money(o.total)}</button>`).join('')}</div>` : ''}
    <div class="messages" id="messages">${c.messages.map(renderMsg).join('')}</div>
    <form class="composer" id="composer">
      <input id="composer-input" placeholder="Escribe una respuesta (pausa el bot en este chat)…" autocomplete="off">
      <button>Enviar</button>
    </form>`;
  const box = $('#messages');
  box.scrollTop = box.scrollHeight;
  $('#bot-toggle').addEventListener('change', (e) => api(`/conversations/${id}`, { method: 'PATCH', body: { bot_enabled: e.target.checked } }).then(loadConversations));
  $('#conv-status').addEventListener('change', (e) => api(`/conversations/${id}`, { method: 'PATCH', body: { status: e.target.value } }).then(loadConversations));
  $$('[data-order]', $('#chat')).forEach((b) => b.addEventListener('click', () => openOrder(Number(b.dataset.order))));
  $('#btn-new-order').addEventListener('click', () => newOrderForm(c));
  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#composer-input');
    const text = input.value.trim();
    if (!text) return;
    await run(e.submitter, async () => {
      await api(`/conversations/${id}/messages`, { method: 'POST', body: { text } });
      input.value = '';
      openConversation(id);
    });
  });
  loadConversations();
}

// Actualiza solo los mensajes (sin borrar lo que el asesor está escribiendo).
async function refreshMessages(id) {
  const c = await api('/conversations/' + id);
  const box = $('#messages');
  if (!box || activeConv !== id) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = c.messages.map(renderMsg).join('');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function renderMsg(m) {
  const cls = m.sender === 'sistema' ? 'sistema' : m.direction;
  const who = { cliente: '', bot: '🤖 Bot', asesor: '👤 Asesor', sistema: '⚙️ Sistema' }[m.sender];
  const body = m.type === 'image' ? `📷 Imagen ${m.body ? '— ' + esc(m.body) : ''}` : m.type === 'audio' ? '🎤 Nota de voz' : esc(m.body);
  return `<div class="msg ${cls}">${body}<span class="meta">${who} ${fmtDate(m.created_at)}</span></div>`;
}

// ---------- Pedidos
async function loadOrders() {
  if (!Object.keys(STATUS).length) {
    STATUS = await api('/orders/statuses');
    $('#order-status').innerHTML += Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  }
  const qs = new URLSearchParams({ q: $('#order-search').value, status: $('#order-status').value, payment_status: $('#order-payment').value });
  const rows = await api('/orders?' + qs);
  $('#orders-table tbody').innerHTML = rows.map((o) => `
    <tr data-id="${o.id}">
      <td><b>${esc(o.code)}</b></td>
      <td>${fmtDate(o.created_at)}</td>
      <td>${esc([o.recipient_name, o.recipient_first_lastname].join(' '))}<br><small class="muted">${esc(o.recipient_phone)} · ${esc(o.department || o.district)}</small></td>
      <td class="wrap">${esc(o.items_text)}</td>
      <td>${esc(DELIVERY[o.delivery_type])}</td>
      <td>${money(o.total)}<br><small class="muted">pagado ${money(o.paid_amount)}</small></td>
      <td><span class="pill ${esc(o.payment_status)}">${esc(o.payment_status)}</span></td>
      <td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td>
      <td>${esc(o.shalom_order_number)}${o.shalom_order_code ? '-' + esc(o.shalom_order_code) : ''}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">Sin pedidos</td></tr>';
  $$('#orders-table tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openOrder(Number(tr.dataset.id))));
}
$('#order-search').addEventListener('input', debounce(loadOrders, 300));
$('#order-status').addEventListener('change', loadOrders);
$('#order-payment').addEventListener('change', loadOrders);
$('#btn-refresh-tracking').addEventListener('click', (e) => run(e.target, async () => {
  const r = await api('/tracking/refresh', { method: 'POST' });
  toast(`Tracking: ${r.checked} guías revisadas, ${r.updated} con novedades`);
  loadOrders();
}));

function openModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').showModal();
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.target.close(); });

async function openOrder(id) {
  if (!Object.keys(STATUS).length) STATUS = await api('/orders/statuses');
  const o = await api('/orders/' + id);
  const pending = o.total - o.paid_amount;
  const f = (k, label, extra = '') => `<label>${label}<input name="${k}" value="${esc(o[k])}" ${extra}></label>`;
  openModal(`
    <div class="toolbar"><h1>Pedido ${esc(o.code)}</h1><span class="pill ${esc(o.status)}">${esc(STATUS[o.status])}</span><button class="secondary" onclick="modal.close()">✕</button></div>
    <p>${o.items.map((i) => `${i.quantity} × ${esc(i.name)} (${money(i.unit_price)})`).join('<br>')}</p>
    <p><b>Total ${money(o.total)}</b> (envío ${money(o.shipping)}) · Pagado ${money(o.paid_amount)} · <b>Saldo ${money(pending)}</b> ·
      <span class="pill ${esc(o.payment_status)}">${esc(o.payment_status)}</span> · ${esc(DELIVERY[o.delivery_type])} · modo ${esc(o.payment_mode)}</p>

    <div class="actions">
      <input id="pay-amount" type="number" step="0.01" placeholder="Monto" value="${(o.payment_status === 'pendiente' || o.payment_status === 'por_verificar') && o.advance_required && !o.paid_amount ? o.advance_required : pending.toFixed(2)}" style="width:110px">
      <button id="btn-pay">💰 Registrar pago (Yape verificado)</button>
      ${o.delivery_type === 'shalom_agencia' && !o.shalom_order_number ? '<button id="btn-guide">📦 Generar guía Shalom</button>' : ''}
      ${o.shalom_order_number ? `<a href="/api/orders/${o.id}/label" target="_blank"><button class="secondary" type="button">🖨️ Etiqueta</button></a>` : ''}
      ${o.shalom_pickup_key && o.payment_status === 'pagado' && o.status !== 'clave_enviada' && o.status !== 'entregado' ? '<button id="btn-key">🔑 Enviar clave</button>' : ''}
      <select id="status-select">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <button id="btn-status" class="secondary">Cambiar estado</button>
      ${o.conversation_id ? `<button id="btn-chat" class="secondary">💬 Ver chat</button>` : ''}
    </div>

    <form id="order-form">
      <div class="form-grid">
        ${f('recipient_dni', 'DNI')}${f('recipient_phone', 'Celular')}
        ${f('recipient_name', 'Nombres')}${f('recipient_first_lastname', 'Apellido paterno')}
        ${f('recipient_second_lastname', 'Apellido materno')}${f('department', 'Departamento')}
        ${f('province', 'Provincia')}${f('district', 'Distrito')}
        ${f('address', 'Dirección (Lima)')}${f('shalom_agency_name', 'Agencia Shalom')}
        ${f('shalom_terminal_id', 'ter_id agencia destino')}${f('shalom_pickup_key', 'Clave de recojo')}
        ${f('shalom_order_number', 'N° guía')}${f('shalom_order_code', 'Código guía')}
      </div>
      <label>Buscar agencia destino <input id="agency-q" placeholder="Ciudad / distrito"></label>
      <ul id="agency-pick" class="agency-list"></ul>
      <label>Notas<textarea name="notes" rows="2">${esc(o.notes)}</textarea></label>
      <button>Guardar datos</button>
    </form>
    ${o.shalom_status ? `<p>Estado Shalom: <b>${esc(o.shalom_status)}</b></p>` : ''}
    <h3>Historial</h3>
    <ul class="timeline">${o.events.map((e) => `<li>${fmtDate(e.created_at)} · <b>${esc(e.event)}</b> ${esc(e.detail)}</li>`).join('')}</ul>`);

  const reload = () => { openOrder(id); if (currentView === 'orders') loadOrders(); loadStats(); };
  $('#btn-pay').addEventListener('click', (e) => run(e.target, async () => {
    const amount = Number($('#pay-amount').value);
    if (!(amount > 0)) throw new Error('Monto inválido');
    await api(`/orders/${id}/payment`, { method: 'POST', body: { amount } });
    toast('Pago registrado y cliente notificado');
    reload();
  }));
  $('#btn-guide')?.addEventListener('click', (e) => run(e.target, async () => {
    const r = await api(`/orders/${id}/shalom-guide`, { method: 'POST' });
    toast(r.shalom_order_number ? `Guía ${r.shalom_order_number} generada` : 'Guía registrada: completa el N° de guía si no apareció');
    reload();
  }));
  $('#btn-key')?.addEventListener('click', (e) => run(e.target, async () => {
    await api(`/orders/${id}/send-key`, { method: 'POST' });
    toast('Clave enviada');
    reload();
  }));
  $('#btn-status').addEventListener('click', (e) => run(e.target, async () => {
    await api(`/orders/${id}/status`, { method: 'POST', body: { status: $('#status-select').value } });
    reload();
  }));
  $('#btn-chat')?.addEventListener('click', () => { $('#modal').close(); show('inbox'); openConversation(o.conversation_id); });
  $('#order-form').addEventListener('submit', (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      await api(`/orders/${id}`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
      toast('Datos guardados');
      reload();
    });
  });
  agencyPicker($('#agency-q'), $('#agency-pick'), (a) => {
    $('[name=shalom_terminal_id]').value = a.ter_id;
    $('[name=shalom_agency_name]').value = a.nombre;
  });
}

function agencyPicker(input, list, onPick) {
  input.addEventListener('input', debounce(async () => {
    if (input.value.trim().length < 3) { list.innerHTML = ''; return; }
    const rows = await api('/shalom/agencies?q=' + encodeURIComponent(input.value)).catch((e) => { list.innerHTML = `<li>${esc(e.message)}</li>`; return null; });
    if (!rows) return;
    list.innerHTML = rows.map((a, i) => `<li><a href="#" data-i="${i}">${esc(a.nombre)}</a> <small class="muted">${esc(a.direccion)} · ter_id ${a.ter_id}</small></li>`).join('') || '<li class="muted">Sin resultados</li>';
    $$('a[data-i]', list).forEach((el) => el.addEventListener('click', (ev) => { ev.preventDefault(); onPick(rows[Number(el.dataset.i)]); list.innerHTML = ''; }));
  }, 350));
}

async function newOrderForm(conv) {
  const products = (await api('/products')).filter((p) => p.active);
  const cu = conv.customer || {};
  openModal(`
    <div class="toolbar"><h1>Nuevo pedido</h1><button class="secondary" onclick="modal.close()">✕</button></div>
    <form id="new-order">
      <div class="form-grid">
        <label>Producto<select name="productId">${products.map((p) => `<option value="${p.id}">${esc(p.name)} — ${money(p.promo_price ?? p.price)}</option>`).join('')}</select></label>
        <label>Cantidad<input name="quantity" type="number" min="1" value="1"></label>
        <label>Entrega<select name="deliveryType"><option value="shalom_agencia">Shalom agencia (provincia)</option><option value="lima_delivery">Delivery Lima</option></select></label>
        <label>Modo de pago<select name="paymentMode"><option value="adelanto">Adelanto + saldo</option><option value="completo">100% adelantado</option><option value="contraentrega">Contraentrega (Lima)</option></select></label>
        <label>DNI<input name="recipientDni" value="${esc(cu.dni)}"></label>
        <label>Celular<input name="recipientPhone" value="${esc(cu.phone)}"></label>
        <label>Nombres<input name="recipientName" value="${esc(cu.name)}"></label>
        <label>Apellido paterno<input name="recipientFirstLastname"></label>
        <label>Apellido materno<input name="recipientSecondLastname"></label>
        <label>Departamento<input name="department" value="${esc(cu.department)}"></label>
        <label>Distrito<input name="district" value="${esc(cu.district)}"></label>
        <label>Dirección (Lima)<input name="address" value="${esc(cu.address)}"></label>
        <label>ter_id agencia<input name="shalomTerminalId"></label>
        <label>Agencia<input name="shalomAgencyName"></label>
      </div>
      <label>Buscar agencia <input id="agency-q2" placeholder="Ciudad / distrito"></label>
      <ul id="agency-pick2" class="agency-list"></ul>
      <button>Crear pedido</button>
    </form>`);
  agencyPicker($('#agency-q2'), $('#agency-pick2'), (a) => {
    $('[name=shalomTerminalId]').value = a.ter_id;
    $('[name=shalomAgencyName]').value = a.nombre;
  });
  $('#new-order').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    run(e.submitter, async () => {
      const o = await api('/orders', { method: 'POST', body: {
        ...d, conversationId: conv.id, customerId: conv.customer_id,
        items: [{ productId: Number(d.productId), quantity: Number(d.quantity) }],
      } });
      toast(`Pedido ${o.code} creado`);
      openOrder(o.id);
      openConversation(conv.id);
    });
  });
}

// ---------- Productos
async function loadProducts() {
  const rows = await api('/products');
  $('#products-table tbody').innerHTML = rows.map((p) => {
    const sale = p.promo_price ?? p.price;
    const margin = sale ? Math.round(((sale - p.cost) / sale) * 100) : 0;
    return `<tr data-id="${p.id}">
      <td class="wrap"><b>${esc(p.name)}</b><br><small class="muted">${esc(p.sku)}</small></td>
      <td>${money(p.price)}</td><td>${p.promo_price != null ? money(p.promo_price) : '—'}</td><td>${money(p.cost)}</td>
      <td>${margin}%</td><td>${p.stock}</td><td>${p.active ? '✅' : '⬜'}</td><td><button class="secondary">Editar</button></td></tr>`;
  }).join('');
  $$('#products-table tbody tr').forEach((tr) => tr.addEventListener('click', () => productForm(rows.find((p) => p.id === Number(tr.dataset.id)))));
}
$('#btn-new-product').addEventListener('click', () => productForm({ active: 1, shalom_content: 'PAQUETE S' }));

function productForm(p) {
  const f = (k, label, type = 'text') => `<label>${label}<input name="${k}" type="${type}" step="0.01" value="${esc(p[k] ?? '')}"></label>`;
  openModal(`
    <div class="toolbar"><h1>${p.id ? 'Editar' : 'Nuevo'} producto</h1><button class="secondary" onclick="modal.close()">✕</button></div>
    <form id="product-form">
      <div class="form-grid">
        ${f('name', 'Nombre')}${f('sku', 'SKU')}
        ${f('price', 'Precio normal (S/)', 'number')}${f('promo_price', 'Precio promo (S/)', 'number')}
        ${f('cost', 'Costo puesto en Lima (S/)', 'number')}${f('stock', 'Stock', 'number')}
        <label>Tamaño Shalom<select name="shalom_content">${['SOBRE', 'PAQUETE XS', 'PAQUETE S', 'PAQUETE M', 'PAQUETE L'].map((c) => `<option ${c === p.shalom_content ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Activo<select name="active"><option value="1" ${p.active ? 'selected' : ''}>Sí</option><option value="0" ${!p.active ? 'selected' : ''}>No</option></select></label>
      </div>
      <label>Descripción (el bot la usa para vender)<textarea name="description" rows="3">${esc(p.description)}</textarea></label>
      <label>Preguntas frecuentes / objeciones<textarea name="faq" rows="3">${esc(p.faq)}</textarea></label>
      <button>Guardar</button>
    </form>`);
  $('#product-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    for (const k of ['price', 'cost', 'stock', 'active']) d[k] = Number(d[k] || 0);
    d.promo_price = d.promo_price === '' ? '' : Number(d.promo_price);
    run(e.submitter, async () => {
      await api('/products' + (p.id ? '/' + p.id : ''), { method: p.id ? 'PUT' : 'POST', body: d });
      $('#modal').close();
      loadProducts();
    });
  });
}

// ---------- Simulador
let simId = 'sim-' + Date.now();
let simSeen = new Set();
async function simSend(text, type = 'text') {
  const log = $('#sim-log');
  log.innerHTML += `<div class="msg in">${type === 'image' ? '📷 (voucher)' : esc(text)}</div>`;
  log.innerHTML += '<div class="msg sistema" id="typing">escribiendo…</div>';
  log.scrollTop = log.scrollHeight;
  try {
    const r = await api('/simulate', { method: 'POST', body: { externalId: simId, text, type } });
    for (const m of r.messages) {
      if (m.direction !== 'out' || simSeen.has(m.id)) continue;
      simSeen.add(m.id);
      log.innerHTML += renderMsg(m);
    }
  } catch (e) {
    log.innerHTML += `<div class="msg sistema">⚠️ ${esc(e.message)}</div>`;
  }
  $('#typing')?.remove();
  log.scrollTop = log.scrollHeight;
}
$('#sim-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('#sim-input').value.trim();
  if (!t) return;
  $('#sim-input').value = '';
  simSend(t);
});
$('#sim-img').addEventListener('click', () => simSend('', 'image'));
$('#sim-reset').addEventListener('click', () => { simId = 'sim-' + Date.now(); simSeen = new Set(); $('#sim-log').innerHTML = ''; });

// ---------- Ajustes
async function loadSettings() {
  const s = await api('/settings');
  $('#bot-extra').value = s.bot_extra_instructions;
  $('#business-info').textContent = JSON.stringify(s.business, null, 2);
}
$('#btn-save-settings').addEventListener('click', (e) => run(e.target, async () => {
  await api('/settings', { method: 'PUT', body: { bot_extra_instructions: $('#bot-extra').value } });
  toast('Guardado');
}));
$('#btn-shalom-status').addEventListener('click', (e) => run(e.target, async () => {
  $('#shalom-status').textContent = JSON.stringify(await api('/shalom/status'), null, 2);
}));
agencyPicker($('#agency-search'), $('#agency-results'), (a) => toast(`ter_id ${a.ter_id}: ${a.nombre}`));

// ---------- Tiempo real
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const refresh = debounce(() => {
  if (currentView === 'inbox') { loadConversations(); if (activeConv) refreshMessages(activeConv); }
  if (currentView === 'orders') loadOrders();
  if (currentView === 'dashboard') loadStats();
}, 500);
const es = new EventSource('/api/events');
es.addEventListener('message', (e) => {
  const { conversationId } = JSON.parse(e.data);
  if (currentView !== 'inbox' || !activeConv || conversationId === activeConv) refresh();
  else loadConversations();
});
es.addEventListener('order', refresh);

show('dashboard');
