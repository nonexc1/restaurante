// Ciclo de vida del pedido.
//
// Envío a provincia por agencia Shalom (modelo "adelanto + saldo con clave"):
//   nuevo → confirmado (adelanto pagado) → guia_generada → en_transito → en_agencia
//        → pagado (cliente paga el saldo) → clave_enviada → entregado
// Delivery Lima (contraentrega):
//   nuevo → confirmado → en_ruta → entregado
// Cualquier estado puede pasar a cancelado / devuelto.
import { randomInt } from 'node:crypto';
import { db, tx } from '../db.js';
import { config } from '../config.js';
import { shalom, extractOrderIds, isConfigured as shalomReady } from '../shalom/client.js';
import { sendToConversation, setConversationStatus } from './conversations.js';
import { bus } from './events.js';

export const STATUS_LABELS = {
  nuevo: 'Nuevo (esperando pago/confirmación)',
  confirmado: 'Confirmado (listo para despachar)',
  guia_generada: 'Guía Shalom generada',
  en_transito: 'En tránsito',
  en_agencia: 'En agencia destino (cobrar saldo)',
  pagado: 'Pagado completo',
  clave_enviada: 'Clave enviada al cliente',
  en_ruta: 'En ruta (delivery Lima)',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  devuelto: 'Devuelto',
};

export function getOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? OR code = ?').get(id, String(id));
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  order.events = db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id').all(order.id);
  return order;
}

export function logEvent(orderId, event, detail = '') {
  db.prepare('INSERT INTO order_events (order_id, event, detail) VALUES (?, ?, ?)').run(orderId, event, detail);
}

function touch(orderId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE orders SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => fields[k]), orderId);
  bus.emit('order', { orderId });
}

const ALLOWED_FIELDS = new Set([
  'status', 'payment_status', 'paid_amount', 'recipient_name', 'recipient_first_lastname', 'recipient_second_lastname',
  'recipient_dni', 'recipient_phone', 'department', 'province', 'district', 'address', 'shalom_terminal_id',
  'shalom_agency_name', 'shalom_order_number', 'shalom_order_code', 'shalom_pickup_key', 'shalom_status', 'notes',
  'shipping', 'total', 'advance_required', 'payment_mode',
]);

export function updateOrder(orderId, fields) {
  const clean = Object.fromEntries(Object.entries(fields).filter(([k]) => ALLOWED_FIELDS.has(k)));
  touch(orderId, clean);
  return getOrder(orderId);
}

function newOrderCode() {
  for (;;) {
    const code = `P${randomInt(100000, 999999)}`;
    if (!db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code)) return code;
  }
}

/**
 * Crea un pedido. items: [{ productId, quantity }]
 * data: { deliveryType: 'shalom_agencia'|'lima_delivery', paymentMode, recipient..., agency... }
 */
export function createOrder({ conversationId = null, customerId = null, items, deliveryType, paymentMode, ...data }) {
  if (!items?.length) throw new Error('El pedido necesita al menos un producto');
  return tx(() => {
    let subtotal = 0;
    const lines = items.map(({ productId, quantity }) => {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId);
      if (!p) throw new Error(`Producto ${productId} no existe o está inactivo`);
      const qty = Math.max(1, Number(quantity) || 1);
      const unit = p.promo_price ?? p.price;
      subtotal += unit * qty;
      return { p, qty, unit };
    });

    const isLima = deliveryType === 'lima_delivery';
    const shipping = isLima ? config.business.limaDeliveryFee : Number(data.shipping || 0);
    const total = subtotal + shipping;
    const mode = paymentMode || (isLima ? 'contraentrega' : 'adelanto');
    const advance = mode === 'adelanto' ? Math.min(config.business.advanceAmount, total) : mode === 'completo' ? total : 0;

    const r = db.prepare(`INSERT INTO orders (
      code, customer_id, conversation_id, delivery_type, payment_mode, subtotal, shipping, total, advance_required,
      recipient_name, recipient_first_lastname, recipient_second_lastname, recipient_dni, recipient_phone,
      department, province, district, address, shalom_terminal_id, shalom_agency_name, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      newOrderCode(), customerId, conversationId, deliveryType, mode, subtotal, shipping, total, advance,
      data.recipientName || '', data.recipientFirstLastname || '', data.recipientSecondLastname || '',
      data.recipientDni || '', data.recipientPhone || '', data.department || '', data.province || '',
      data.district || '', data.address || '', String(data.shalomTerminalId || ''), data.shalomAgencyName || '',
      data.notes || ''
    );
    const orderId = Number(r.lastInsertRowid);
    for (const { p, qty, unit } of lines) {
      db.prepare('INSERT INTO order_items (order_id, product_id, name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)')
        .run(orderId, p.id, p.name, qty, unit);
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, p.id);
    }
    if (customerId) {
      db.prepare(`UPDATE customers SET
        name = COALESCE(NULLIF(?, ''), name), dni = COALESCE(NULLIF(?, ''), dni), phone = COALESCE(NULLIF(?, ''), phone),
        department = COALESCE(NULLIF(?, ''), department), province = COALESCE(NULLIF(?, ''), province),
        district = COALESCE(NULLIF(?, ''), district), address = COALESCE(NULLIF(?, ''), address)
        WHERE id = ?`).run(
        [data.recipientName, data.recipientFirstLastname, data.recipientSecondLastname].filter(Boolean).join(' '),
        data.recipientDni || '', data.recipientPhone || '', data.department || '', data.province || '',
        data.district || '', data.address || '', customerId
      );
    }
    if (conversationId) setConversationStatus(conversationId, 'venta');
    logEvent(orderId, 'creado', `${deliveryType} · ${mode} · total S/${total.toFixed(2)}`);
    bus.emit('order', { orderId });
    return getOrder(orderId);
  });
}

async function notify(order, text) {
  if (!order.conversation_id) return;
  try {
    await sendToConversation(order.conversation_id, text, 'sistema');
  } catch {
    // el error ya quedó registrado en la conversación
  }
}

const money = (n) => `S/${Number(n).toFixed(2)}`;

// El asesor verificó el Yape/Plin en su app y registra el monto recibido.
export async function registerPayment(orderId, amount) {
  const order = getOrder(orderId);
  if (!order) throw new Error('Pedido no encontrado');
  const paid = order.paid_amount + Number(amount);
  const fullyPaid = paid + 0.001 >= order.total;
  const fields = { paid_amount: paid, payment_status: fullyPaid ? 'pagado' : 'adelanto_pagado' };
  if (order.status === 'nuevo') fields.status = 'confirmado';
  if (fullyPaid && order.status === 'en_agencia') fields.status = 'pagado';
  touch(order.id, fields);
  logEvent(order.id, 'pago', `${money(amount)} registrado (acumulado ${money(paid)})`);

  const updated = getOrder(order.id);
  if (order.status === 'nuevo') {
    await notify(updated, `✅ ¡Pago recibido! Tu pedido ${updated.code} está confirmado. Te enviaremos el número de guía apenas lo despachemos.`);
  } else if (fullyPaid && updated.delivery_type === 'shalom_agencia' && updated.shalom_pickup_key) {
    await sendPickupKey(updated.id);
  } else {
    await notify(updated, `✅ Pago de ${money(amount)} recibido para el pedido ${updated.code}. ¡Gracias!`);
  }
  return getOrder(order.id);
}

// Genera la guía en Shalom Pro y notifica al cliente (sin la clave: esa se entrega al cancelar el saldo).
export async function generateShalomGuide(orderId, { content } = {}) {
  const order = getOrder(orderId);
  if (!order) throw new Error('Pedido no encontrado');
  if (order.delivery_type !== 'shalom_agencia') throw new Error('El pedido no es envío por agencia Shalom');
  if (order.shalom_order_number) throw new Error('El pedido ya tiene guía');
  if (!shalomReady()) throw new Error('Shalom API no configurada (SHALOM_API_KEY)');
  const missing = ['recipient_dni', 'recipient_name', 'recipient_first_lastname', 'recipient_phone', 'shalom_terminal_id']
    .filter((k) => !order[k]);
  if (missing.length) throw new Error(`Faltan datos para la guía: ${missing.join(', ')}`);
  if (!config.shalom.originTerminal) throw new Error('Configura SHALOM_ORIGIN_TERMINAL (ter_id de tu agencia de origen)');

  const pickupKey = order.shalom_pickup_key || String(randomInt(1000, 9999));
  const firstItem = order.items[0];
  const product = firstItem?.product_id ? db.prepare('SELECT shalom_content FROM products WHERE id = ?').get(firstItem.product_id) : null;
  const destino = /^0/.test(order.shalom_terminal_id) ? order.shalom_terminal_id : Number(order.shalom_terminal_id);

  const res = await shalom.register({
    origen: Number(config.shalom.originTerminal),
    destino,
    content: content || product?.shalom_content || config.shalom.defaultContent,
    cantidad: 1,
    documento: order.recipient_dni,
    name: order.recipient_name.toUpperCase(),
    firstname: order.recipient_first_lastname.toUpperCase(),
    lastname: (order.recipient_second_lastname || order.recipient_first_lastname).toUpperCase(),
    phone: Number(String(order.recipient_phone).replace(/\D/g, '').slice(-9)),
    clave: pickupKey,
    declaracion_jurada: config.shalom.declaracion,
  });

  const { orderNumber, orderCode } = extractOrderIds(res);
  touch(order.id, {
    status: 'guia_generada',
    shalom_pickup_key: pickupKey,
    shalom_order_number: orderNumber,
    shalom_order_code: orderCode,
    shalom_raw: JSON.stringify(res).slice(0, 20000),
  });
  logEvent(order.id, 'guia_generada', orderNumber ? `Guía ${orderNumber}-${orderCode}` : 'Guía registrada (revisa número en Shalom Pro)');

  if (orderNumber && orderCode) {
    await shalom.subscribe(orderNumber, orderCode).catch((e) => logEvent(order.id, 'error', `Suscripción tracking: ${e.message}`));
    const pending = order.total - order.paid_amount;
    await notify(getOrder(order.id),
      `📦 ¡Tu pedido ${order.code} ya fue enviado por Shalom!\n` +
      `Guía: ${orderNumber} · Código: ${orderCode}\n` +
      `Agencia destino: ${order.shalom_agency_name}\n` +
      (pending > 0
        ? `Cuando llegue a la agencia te avisamos para que canceles el saldo de ${money(pending)} y te enviamos la clave de recojo 🔑`
        : 'Cuando llegue a la agencia te enviamos la clave de recojo 🔑'));
  }
  return getOrder(order.id);
}

// Mapea los estados de Shalom (texto libre) a nuestros estados.
export function mapShalomStatus(text) {
  const s = String(text || '').toUpperCase();
  if (/ENTREGAD|FINALIZ/.test(s)) return 'entregado';
  if (/DESTINO|AGENCIA DESTINO|PENDIENTE DE ENTREGA|DISPONIBLE|ARRIB|LLEG/.test(s)) return 'en_agencia';
  if (/TRANSIT|ORIGEN|CAMINO|DESPACH|EMBARC|IN_TRANSIT/.test(s)) return 'en_transito';
  if (/DEVOL/.test(s)) return 'devuelto';
  return null;
}

const STATUS_ORDER = ['nuevo', 'confirmado', 'guia_generada', 'en_transito', 'en_agencia', 'pagado', 'clave_enviada', 'entregado'];

// Aplica una actualización de tracking (webhook o consulta manual).
export async function applyTrackingUpdate(orderNumber, statusText, raw = null) {
  const order = db.prepare('SELECT id FROM orders WHERE shalom_order_number = ?').get(String(orderNumber));
  if (!order) return null;
  const current = getOrder(order.id);
  touch(current.id, { shalom_status: String(statusText).slice(0, 200) });
  const mapped = mapShalomStatus(statusText);
  if (!mapped) return getOrder(current.id);

  // Nunca retroceder (los webhooks pueden llegar desordenados), salvo devoluciones.
  const forward = mapped === 'devuelto' || STATUS_ORDER.indexOf(mapped) > STATUS_ORDER.indexOf(current.status);
  if (!forward) return getOrder(current.id);

  if (mapped === 'en_agencia' && current.payment_status === 'pagado') {
    touch(current.id, { status: 'pagado' });
    logEvent(current.id, 'tracking', `${statusText} (ya pagado → se envía clave)`);
    await sendPickupKey(current.id);
    return getOrder(current.id);
  }

  touch(current.id, { status: mapped });
  logEvent(current.id, 'tracking', String(statusText));
  const o = getOrder(current.id);
  if (mapped === 'en_agencia') {
    const pending = o.total - o.paid_amount;
    await notify(o,
      `🏪 ¡Tu pedido ${o.code} ya llegó a la agencia Shalom ${o.shalom_agency_name}!\n` +
      `Para recibir tu clave de recojo, yapea el saldo de ${money(pending)} al ${config.business.yapeNumber} (${config.business.yapeName}) y envíanos la captura 📲`);
  } else if (mapped === 'en_transito') {
    await notify(o, `🚚 Tu pedido ${o.code} está en camino (guía ${o.shalom_order_number}).`);
  } else if (mapped === 'entregado') {
    await notify(o, `🎉 ¡Pedido ${o.code} entregado! Gracias por tu compra. Si te gustó, cuéntanos y recomiéndanos 🙌`);
  }
  return o;
}

export async function sendPickupKey(orderId) {
  const o = getOrder(orderId);
  if (!o?.shalom_pickup_key) throw new Error('El pedido no tiene clave de recojo');
  touch(o.id, { status: 'clave_enviada' });
  logEvent(o.id, 'clave_enviada', '');
  await notify(getOrder(o.id),
    `🔑 ¡Gracias por tu pago! Datos para recoger tu pedido ${o.code} en Shalom:\n` +
    `Agencia: ${o.shalom_agency_name}\nGuía: ${o.shalom_order_number} · Código: ${o.shalom_order_code}\n` +
    `Clave: ${o.shalom_pickup_key}\nLleva tu DNI (${o.recipient_dni}).`);
  return getOrder(o.id);
}

// Consulta Shalom para todas las guías activas (respaldo si no llegan webhooks).
export async function refreshAllTracking() {
  const active = db.prepare(`SELECT shalom_order_number AS orderNumber, shalom_order_code AS orderCode FROM orders
    WHERE shalom_order_number != '' AND shalom_order_code != '' AND status IN ('guia_generada','en_transito','en_agencia','pagado','clave_enviada')`).all();
  let updated = 0;
  for (let i = 0; i < active.length; i += 50) {
    const batch = active.slice(i, i + 50).map((o) => ({ orderNumber: o.orderNumber, orderCode: o.orderCode }));
    const results = await shalom.trackBatch(batch);
    for (let j = 0; j < batch.length; j++) {
      const statuses = results?.[j]?.statuses || [];
      const last = statuses.at(-1);
      const text = typeof last === 'string' ? last : last ? Object.values(last).filter((v) => typeof v === 'string').join(' ') : '';
      if (text) {
        await applyTrackingUpdate(batch[j].orderNumber, text);
        updated++;
      }
    }
  }
  return { checked: active.length, updated };
}

export async function setStatus(orderId, status) {
  if (!STATUS_LABELS[status]) throw new Error('Estado inválido');
  const o = getOrder(orderId);
  if (!o) throw new Error('Pedido no encontrado');
  if ((status === 'cancelado' || status === 'devuelto') && !['cancelado', 'devuelto'].includes(o.status)) {
    for (const it of o.items) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.quantity, it.product_id);
  }
  touch(o.id, { status });
  logEvent(o.id, 'estado', `${o.status} → ${status}`);
  if (status === 'en_ruta') await notify(o, `🛵 Tu pedido ${o.code} está en ruta. Ten listo ${money(o.total - o.paid_amount)} (efectivo o Yape) para el motorizado.`);
  if (status === 'clave_enviada') return sendPickupKey(o.id);
  return getOrder(o.id);
}
