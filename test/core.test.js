import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.SHALOM_WEBHOOK_SECRET = 'whsec_test';
process.env.META_APP_SECRET = 'meta_secret';
process.env.ADVANCE_AMOUNT = '20';
process.env.YAPE_NUMBER = '999888777';

const { db } = await import('../src/db.js');
const { seedIfEmpty } = await import('../src/seed.js');
const shalomMod = await import('../src/shalom/client.js');
const channels = await import('../src/channels/index.js');
const orders = await import('../src/services/orders.js');
const conversations = await import('../src/services/conversations.js');
const tools = await import('../src/bot/tools.js');

seedIfEmpty();

test('firma de webhook Shalom', () => {
  const body = '{"orderNumber":"66479331","status":"EN DESTINO"}';
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex');
  assert.equal(shalomMod.verifyWebhookSignature(body, `t=${t},v1=${v1}`), true);
  assert.equal(shalomMod.verifyWebhookSignature(body + ' ', `t=${t},v1=${v1}`), false);
  assert.equal(shalomMod.verifyWebhookSignature(body, `t=${t - 3600},v1=${v1}`), false);
});

test('firma de webhook Meta', () => {
  const body = '{"object":"page"}';
  const sig = 'sha256=' + createHmac('sha256', 'meta_secret').update(body).digest('hex');
  assert.equal(channels.verifyMetaSignature(body, sig), true);
  assert.equal(channels.verifyMetaSignature(body, 'sha256=00'), false);
});

test('extrae número y código de guía de respuestas espejo', () => {
  const r = shalomMod.extractOrderIds({ success: true, data: { ose_numero: 66479331, ose_codigo: '3kth', otro: 'x' } });
  assert.deepEqual(r, { orderNumber: '66479331', orderCode: '3KTH' });
});

test('mapea estados de Shalom', () => {
  assert.equal(orders.mapShalomStatus('EN TRANSITO'), 'en_transito');
  assert.equal(orders.mapShalomStatus('Pendiente de entrega - agencia destino'), 'en_agencia');
  assert.equal(orders.mapShalomStatus('ENTREGADO'), 'entregado');
  assert.equal(orders.mapShalomStatus('Registrado'), null);
});

test('parsea webhooks de WhatsApp, Instagram y Telegram', () => {
  const wa = channels.parseMetaWebhook({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { contacts: [{ wa_id: '51999', profile: { name: 'Ana' } }], messages: [{ from: '51999', id: 'm1', type: 'text', text: { body: 'hola' } }] } }] }],
  });
  assert.deepEqual(wa[0], { channel: 'whatsapp', externalId: '51999', name: 'Ana', messageId: 'm1', type: 'text', text: 'hola' });
  const ig = channels.parseMetaWebhook({ object: 'instagram', entry: [{ messaging: [{ sender: { id: '77' }, message: { mid: 'x', text: 'precio?' } }] }] });
  assert.equal(ig[0].channel, 'instagram');
  assert.equal(ig[0].text, 'precio?');
  const echo = channels.parseMetaWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: '1' }, message: { is_echo: true, text: 'x' } }] }] });
  assert.equal(echo.length, 0);
  const tg = channels.parseTelegramUpdate({ message: { message_id: 5, chat: { id: 123 }, from: { first_name: 'Luis' }, text: 'hola' } });
  assert.equal(tg[0].externalId, '123');
  assert.equal(tg[0].name, 'Luis');
});

test('ciclo completo de pedido por agencia Shalom (adelanto + saldo + clave)', async () => {
  const conv = conversations.upsertConversation({ channel: 'web', externalId: 'test-1', name: 'Cliente' });
  const ctx = { conversation: conv, handedOff: false };
  const fan = db.prepare(`SELECT * FROM products WHERE sku = 'VENT-PLEG-01'`).get();

  const missing = await tools.runTool('crear_pedido', { items: [{ producto_id: fan.id, cantidad: 1 }], tipo_entrega: 'shalom_agencia', nombres: 'Ana', celular: '999' }, ctx);
  assert.match(missing, /^ERROR: faltan datos/);

  const res = JSON.parse(await tools.runTool('crear_pedido', {
    items: [{ producto_id: fan.id, cantidad: 1 }], tipo_entrega: 'shalom_agencia', modo_pago: 'adelanto',
    dni: '12345678', nombres: 'Ana', apellido_paterno: 'Quispe', apellido_materno: 'Mamani', celular: '999111222',
    departamento: 'PIURA', agencia_ter_id: '582', agencia_nombre: 'PIURA / CASTILLA',
  }, ctx));
  assert.equal(res.ok, true);
  assert.equal(res.total, fan.promo_price);
  assert.equal(res.adelanto_requerido, 20);

  const order = orders.getOrder(res.codigo);
  assert.equal(order.status, 'nuevo');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(fan.id).stock, fan.stock - 1);

  let o = await orders.registerPayment(order.id, 20);
  assert.equal(o.status, 'confirmado');
  assert.equal(o.payment_status, 'adelanto_pagado');

  // Simula guía ya creada en Shalom
  orders.updateOrder(order.id, { status: 'guia_generada', shalom_order_number: '66479331', shalom_order_code: '3KTH', shalom_pickup_key: '4321' });
  o = await orders.applyTrackingUpdate('66479331', 'EN TRANSITO');
  assert.equal(o.status, 'en_transito');
  o = await orders.applyTrackingUpdate('66479331', 'Pendiente de entrega en agencia destino');
  assert.equal(o.status, 'en_agencia');
  o = await orders.applyTrackingUpdate('66479331', 'EN TRANSITO'); // llegó tarde: no retrocede
  assert.equal(o.status, 'en_agencia');

  o = await orders.registerPayment(order.id, o.total - o.paid_amount);
  assert.equal(o.payment_status, 'pagado');
  assert.equal(o.status, 'clave_enviada');
  const lastMsg = db.prepare('SELECT body FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conv.id).body;
  assert.match(lastMsg, /Clave: 4321/);

  const status = JSON.parse(await tools.runTool('estado_pedido', {}, ctx));
  assert.equal(status[0].clave, '4321');
});

test('la clave no se revela si falta pagar', async () => {
  const conv = conversations.upsertConversation({ channel: 'web', externalId: 'test-2', name: 'Otro' });
  const ctx = { conversation: conv };
  const lamp = db.prepare(`SELECT * FROM products WHERE sku = 'ZANC-LAMP-01'`).get();
  const res = JSON.parse(await tools.runTool('crear_pedido', {
    items: [{ producto_id: lamp.id, cantidad: 2 }], tipo_entrega: 'lima_delivery', modo_pago: 'contraentrega',
    nombres: 'Rosa', celular: '988777666', distrito: 'SJL', direccion: 'Av. Próceres 123',
  }, ctx));
  assert.equal(res.adelanto_requerido, 0);
  assert.equal(res.total, lamp.promo_price * 2 + 10);
  orders.updateOrder(orders.getOrder(res.codigo).id, { shalom_pickup_key: '9999' });
  const status = JSON.parse(await tools.runTool('estado_pedido', {}, ctx));
  assert.notEqual(status[0].clave, '9999');
});

test('cancelar devuelve stock', async () => {
  const lamp = db.prepare(`SELECT * FROM products WHERE sku = 'ZANC-LAMP-01'`).get();
  const o = orders.createOrder({ items: [{ productId: lamp.id, quantity: 3 }], deliveryType: 'lima_delivery', recipientName: 'X' });
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(lamp.id).stock, lamp.stock - 3);
  await orders.setStatus(o.id, 'cancelado');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(lamp.id).stock, lamp.stock);
});
