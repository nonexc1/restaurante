// API REST del panel (protegida con usuario/contraseña).
import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { bus } from '../services/events.js';
import { sendToConversation, saveMessage, getConversation } from '../services/conversations.js';
import {
  getOrder, updateOrder, registerPayment, generateShalomGuide, setStatus, refreshAllTracking, sendPickupKey,
  createOrder, STATUS_LABELS, logEvent,
} from '../services/orders.js';
import { shalom, findAgencies, isConfigured as shalomReady } from '../shalom/client.js';
import { handleIncoming } from '../bot/inbound.js';

export const api = Router();

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(e.status && e.status < 600 ? e.status : 400).json({ error: e.message });
});

// ---- Tiempo real (Server-Sent Events)
api.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const onMsg = (e) => res.write(`event: message\ndata: ${JSON.stringify({ conversationId: e.conversationId })}\n\n`);
  const onOrder = (e) => res.write(`event: order\ndata: ${JSON.stringify(e)}\n\n`);
  bus.on('message', onMsg);
  bus.on('order', onOrder);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    bus.off('message', onMsg);
    bus.off('order', onOrder);
  });
});

// ---- Resumen / métricas
api.get('/stats', wrap((req, res) => {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  res.json({
    conversaciones: one('SELECT COUNT(*) n FROM conversations').n,
    no_atendidas: one(`SELECT COUNT(*) n FROM conversations WHERE status = 'no_atendida'`).n,
    pedidos_hoy: one(`SELECT COUNT(*) n FROM orders WHERE date(created_at) = date('now') AND status != 'cancelado'`).n,
    ventas_hoy: one(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE date(created_at) = date('now') AND status != 'cancelado'`).s,
    ventas_mes: one(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m','now') AND status NOT IN ('cancelado','devuelto')`).s,
    cobrado_mes: one(`SELECT COALESCE(SUM(paid_amount),0) s FROM orders WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m','now')`).s,
    por_verificar: one(`SELECT COUNT(*) n FROM orders WHERE payment_status = 'por_verificar'`).n,
    por_despachar: one(`SELECT COUNT(*) n FROM orders WHERE status = 'confirmado'`).n,
    en_agencia: one(`SELECT COUNT(*) n FROM orders WHERE status = 'en_agencia'`).n,
    entregados_mes: one(`SELECT COUNT(*) n FROM orders WHERE status = 'entregado' AND strftime('%Y-%m', updated_at) = strftime('%Y-%m','now')`).n,
    devueltos_mes: one(`SELECT COUNT(*) n FROM orders WHERE status = 'devuelto' AND strftime('%Y-%m', updated_at) = strftime('%Y-%m','now')`).n,
    por_estado: db.prepare('SELECT status, COUNT(*) n FROM orders GROUP BY status').all(),
    por_canal: db.prepare('SELECT channel, COUNT(*) n FROM conversations GROUP BY channel').all(),
    integraciones: {
      claude: config.anthropic.enabled,
      whatsapp: Boolean(config.whatsapp.token),
      facebook: Boolean(config.meta.pageToken),
      instagram: Boolean(config.meta.igToken),
      telegram: Boolean(config.telegram.token),
      shalom: shalomReady(),
      shalom_instancia: Boolean(config.shalom.instanceId),
    },
  });
}));

// ---- Conversaciones
api.get('/conversations', wrap((req, res) => {
  const { status, channel, q } = req.query;
  const where = [];
  const args = [];
  if (status) { where.push('c.status = ?'); args.push(status); }
  if (channel) { where.push('c.channel = ?'); args.push(channel); }
  if (q) { where.push('(c.display_name LIKE ? OR c.external_id LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = db.prepare(`SELECT c.id, c.channel, c.external_id, c.display_name, c.status, c.bot_enabled, c.unread, c.last_message_at,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_body
    FROM conversations c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.last_message_at DESC LIMIT 300`).all(...args);
  res.json(rows);
}));

api.get('/conversations/:id', wrap((req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'No existe' });
  delete conv.ai_history;
  db.prepare('UPDATE conversations SET unread = 0 WHERE id = ?').run(conv.id);
  res.json({
    ...conv,
    customer: conv.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(conv.customer_id) : null,
    messages: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 300').all(conv.id).reverse(),
    orders: db.prepare('SELECT id, code, status, total, paid_amount, payment_status FROM orders WHERE conversation_id = ? ORDER BY id DESC').all(conv.id),
  });
}));

api.post('/conversations/:id/messages', wrap(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) throw new Error('Mensaje vacío');
  // Cuando un asesor escribe, el bot se pausa en ese chat para no pisarse.
  if (req.body.pauseBot !== false) db.prepare('UPDATE conversations SET bot_enabled = 0 WHERE id = ?').run(req.params.id);
  res.json(await sendToConversation(Number(req.params.id), text, 'asesor'));
}));

api.patch('/conversations/:id', wrap((req, res) => {
  const { status, bot_enabled } = req.body;
  if (status) db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(status, req.params.id);
  if (bot_enabled !== undefined) db.prepare('UPDATE conversations SET bot_enabled = ? WHERE id = ?').run(bot_enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
}));

// Simulador: escribe como si fueras un cliente (canal "web") para probar el bot sin conectar nada.
api.post('/simulate', wrap(async (req, res) => {
  const externalId = String(req.body.externalId || 'cliente-prueba');
  await handleIncoming({
    channel: 'web', externalId, name: req.body.name || 'Cliente de prueba',
    type: req.body.type || 'text', text: String(req.body.text || ''),
  });
  const conv = db.prepare(`SELECT id FROM conversations WHERE channel = 'web' AND external_id = ?`).get(externalId);
  res.json({
    conversationId: conv.id,
    messages: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 6').all(conv.id).reverse(),
  });
}));

// ---- Productos
api.get('/products', wrap((req, res) => res.json(db.prepare('SELECT * FROM products ORDER BY active DESC, id').all())));

const productFields = ['sku', 'name', 'description', 'price', 'promo_price', 'cost', 'stock', 'shalom_content', 'image_url', 'faq', 'active'];
const pickProduct = (b) => productFields.filter((f) => b[f] !== undefined).map((f) => [f, b[f] === '' && f === 'promo_price' ? null : b[f]]);

api.post('/products', wrap((req, res) => {
  const fields = pickProduct(req.body);
  if (!req.body.name || req.body.price === undefined) throw new Error('Nombre y precio son obligatorios');
  const r = db.prepare(`INSERT INTO products (${fields.map((f) => f[0]).join(',')}) VALUES (${fields.map(() => '?').join(',')})`)
    .run(...fields.map((f) => f[1]));
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(r.lastInsertRowid));
}));

api.put('/products/:id', wrap((req, res) => {
  const fields = pickProduct(req.body);
  if (fields.length) db.prepare(`UPDATE products SET ${fields.map((f) => `${f[0]} = ?`).join(', ')} WHERE id = ?`).run(...fields.map((f) => f[1]), req.params.id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
}));

// ---- Pedidos
api.get('/orders/statuses', (req, res) => res.json(STATUS_LABELS));

api.get('/orders', wrap((req, res) => {
  const { status, q, payment_status } = req.query;
  const where = [];
  const args = [];
  if (status) { where.push('o.status = ?'); args.push(status); }
  if (payment_status) { where.push('o.payment_status = ?'); args.push(payment_status); }
  if (q) {
    where.push('(o.code LIKE ? OR o.recipient_dni LIKE ? OR o.recipient_name LIKE ? OR o.recipient_first_lastname LIKE ? OR o.recipient_phone LIKE ? OR o.shalom_order_number LIKE ?)');
    args.push(...Array(6).fill(`%${q}%`));
  }
  res.json(db.prepare(`SELECT o.*, (SELECT GROUP_CONCAT(quantity || ' x ' || name, ', ') FROM order_items i WHERE i.order_id = o.id) AS items_text
    FROM orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 500`).all(...args));
}));

api.get('/orders/:id', wrap((req, res) => {
  const o = getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'No existe' });
  res.json(o);
}));

api.post('/orders', wrap((req, res) => res.json(createOrder(req.body))));
api.patch('/orders/:id', wrap((req, res) => res.json(updateOrder(Number(req.params.id), req.body))));
api.post('/orders/:id/payment', wrap(async (req, res) => res.json(await registerPayment(Number(req.params.id), Number(req.body.amount)))));
api.post('/orders/:id/status', wrap(async (req, res) => res.json(await setStatus(Number(req.params.id), req.body.status))));
api.post('/orders/:id/shalom-guide', wrap(async (req, res) => res.json(await generateShalomGuide(Number(req.params.id), req.body || {}))));
api.post('/orders/:id/send-key', wrap(async (req, res) => res.json(await sendPickupKey(Number(req.params.id)))));
api.post('/orders/:id/note', wrap((req, res) => {
  logEvent(Number(req.params.id), 'nota', String(req.body.text || ''));
  res.json(getOrder(Number(req.params.id)));
}));

api.get('/orders/:id/label', wrap(async (req, res) => {
  const o = getOrder(req.params.id);
  if (!o?.shalom_order_number || !o.shalom_order_code) throw new Error('El pedido no tiene guía');
  const r = await shalom.label(o.shalom_order_number, o.shalom_order_code);
  res.set('Content-Type', r.headers.get('content-type') || 'application/pdf');
  res.set('Content-Disposition', `inline; filename="etiqueta-${o.code}.pdf"`);
  res.send(Buffer.from(await r.arrayBuffer()));
}));

api.post('/tracking/refresh', wrap(async (req, res) => res.json(await refreshAllTracking())));

// ---- Shalom
api.get('/shalom/agencies', wrap(async (req, res) => res.json(await findAgencies(String(req.query.q || ''), 15))));
api.get('/shalom/status', wrap(async (req, res) => {
  const out = { configured: shalomReady() };
  if (out.configured) {
    out.key = await shalom.validate().catch((e) => ({ error: e.message }));
    if (config.shalom.instanceId) out.instance = await shalom.instanceStatus().catch((e) => ({ error: e.message }));
  }
  res.json(out);
}));
api.post('/shalom/quote', wrap(async (req, res) => res.json(await shalom.quote(config.shalom.originTerminal, req.body.destination))));

// ---- Ajustes editables desde el panel
api.get('/settings', wrap((req, res) => res.json({
  bot_extra_instructions: getSetting('bot_extra_instructions', ''),
  business: config.business,
})));
api.put('/settings', wrap((req, res) => {
  if (req.body.bot_extra_instructions !== undefined) setSetting('bot_extra_instructions', req.body.bot_extra_instructions);
  res.json({ ok: true });
}));

// Nota interna en una conversación (no se envía al cliente).
api.post('/conversations/:id/note', wrap((req, res) => {
  res.json(saveMessage(Number(req.params.id), { direction: 'out', sender: 'sistema', body: `📝 ${req.body.text}` }));
}));
