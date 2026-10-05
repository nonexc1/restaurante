// Herramientas que el bot IA puede usar para atender y cerrar ventas.
import { db } from '../db.js';
import { config } from '../config.js';
import { findAgencies, shalom, extractPerson, isConfigured as shalomReady } from '../shalom/client.js';
import { createOrder } from '../services/orders.js';
import { setConversationStatus } from '../services/conversations.js';

export const toolDefinitions = [
  {
    name: 'ver_catalogo',
    description: 'Lista los productos activos con precio, stock y preguntas frecuentes. Úsala antes de dar precios si no estás seguro.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'buscar_agencias_shalom',
    description: 'Busca agencias Shalom por ciudad, provincia, distrito o zona. Devuelve ter_id, nombre y dirección. Úsala para que el cliente elija su agencia de recojo en provincia.',
    input_schema: {
      type: 'object',
      properties: { texto: { type: 'string', description: 'Ej: "Arequipa Cerro Colorado", "Piura Castilla", "Huancayo"' } },
      required: ['texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_dni',
    description: 'Obtiene nombres y apellidos de un DNI peruano (8 dígitos) para completar la guía sin errores. Úsala cuando el cliente te dé su DNI.',
    input_schema: {
      type: 'object',
      properties: { dni: { type: 'string', description: '8 dígitos' } },
      required: ['dni'],
      additionalProperties: false,
    },
  },
  {
    name: 'crear_pedido',
    description: 'Registra el pedido cuando el cliente YA confirmó producto, cantidad, modalidad de entrega y todos sus datos. Para envío a provincia (shalom_agencia) se requiere DNI, nombres, ambos apellidos, celular y ter_id de la agencia. Para delivery en Lima se requiere nombre, celular, distrito y dirección exacta.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { producto_id: { type: 'integer' }, cantidad: { type: 'integer', minimum: 1 } },
            required: ['producto_id', 'cantidad'],
            additionalProperties: false,
          },
        },
        tipo_entrega: { type: 'string', enum: ['shalom_agencia', 'lima_delivery'] },
        modo_pago: { type: 'string', enum: ['adelanto', 'completo', 'contraentrega'], description: 'adelanto = paga adelanto y saldo al llegar a agencia; completo = paga todo antes; contraentrega = solo delivery Lima' },
        dni: { type: 'string' },
        nombres: { type: 'string' },
        apellido_paterno: { type: 'string' },
        apellido_materno: { type: 'string' },
        celular: { type: 'string' },
        departamento: { type: 'string' },
        provincia: { type: 'string' },
        distrito: { type: 'string' },
        direccion: { type: 'string', description: 'Solo delivery Lima: dirección y referencia' },
        agencia_ter_id: { type: 'string', description: 'ter_id de la agencia Shalom elegida' },
        agencia_nombre: { type: 'string' },
        notas: { type: 'string' },
      },
      required: ['items', 'tipo_entrega', 'nombres', 'celular'],
      additionalProperties: false,
    },
  },
  {
    name: 'estado_pedido',
    description: 'Consulta los pedidos de este cliente y su estado actual (guía, si llegó a agencia, saldo pendiente).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'derivar_a_asesor',
    description: 'Pasa la conversación a un asesor humano y apaga el bot en este chat. Úsala ante reclamos, devoluciones, pedidos mayoristas, problemas de pago o cuando no sepas responder.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string' } },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
];

// forCustomer = texto para enviar directo al cliente (sin ids, stock ni notas internas).
export function catalogText(forCustomer = false) {
  const products = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id').all();
  if (!products.length) return 'No hay productos activos.';
  if (forCustomer) {
    return products.filter((p) => p.stock > 0).map((p) => {
      const price = p.promo_price != null ? `S/${p.promo_price} (antes S/${p.price})` : `S/${p.price}`;
      return `✅ ${p.name} — ${price}`;
    }).join('\n');
  }
  return products.map((p) => {
    const price = p.promo_price != null ? `S/${p.promo_price} (antes S/${p.price})` : `S/${p.price}`;
    return `• [id ${p.id}] ${p.name} — ${price} — stock: ${p.stock > 0 ? p.stock : 'AGOTADO'}\n  ${p.description}${p.faq ? `\n  FAQ: ${p.faq}` : ''}`;
  }).join('\n');
}

const s = (v) => (typeof v === 'string' ? v.trim() : '');

export async function runTool(name, input, ctx) {
  switch (name) {
    case 'ver_catalogo':
      return catalogText();

    case 'buscar_agencias_shalom': {
      if (!shalomReady()) return 'Shalom API no está configurada. Pide al cliente su ciudad y distrito y anótalos; un asesor elegirá la agencia.';
      const list = await findAgencies(s(input.texto), 6);
      if (!list.length) return `No encontré agencias para "${input.texto}". Pide otra referencia (provincia o ciudad cercana).`;
      return JSON.stringify(list);
    }

    case 'consultar_dni': {
      const dni = s(input.dni).replace(/\D/g, '');
      if (dni.length !== 8) return 'DNI inválido: debe tener 8 dígitos.';
      if (!shalomReady() || !config.shalom.instanceId) return 'Consulta de DNI no disponible; pide al cliente nombres y apellidos completos.';
      try {
        const person = extractPerson(await shalom.dni(dni));
        if (!person.name) return 'No se encontraron datos para ese DNI; pide nombres y apellidos completos.';
        return JSON.stringify({ dni, ...person });
      } catch (e) {
        return `No se pudo consultar el DNI (${e.message}). Pide nombres y apellidos completos.`;
      }
    }

    case 'crear_pedido': {
      const tipo = input.tipo_entrega;
      if (!Array.isArray(input.items) || !input.items.length) return 'ERROR: faltan productos.';
      if (tipo === 'shalom_agencia') {
        const faltan = ['dni', 'apellido_paterno', 'agencia_ter_id'].filter((k) => !s(input[k]));
        if (faltan.length) return `ERROR: faltan datos para envío Shalom: ${faltan.join(', ')}. Pídelos al cliente.`;
        if (s(input.dni).replace(/\D/g, '').length !== 8) return 'ERROR: el DNI debe tener 8 dígitos.';
      } else if (tipo === 'lima_delivery') {
        const faltan = ['distrito', 'direccion'].filter((k) => !s(input[k]));
        if (faltan.length) return `ERROR: faltan datos para delivery: ${faltan.join(', ')}.`;
      } else return 'ERROR: tipo_entrega inválido.';
      try {
        const order = createOrder({
          conversationId: ctx.conversation.id,
          customerId: ctx.conversation.customer_id,
          items: input.items.map((i) => ({ productId: i.producto_id, quantity: i.cantidad })),
          deliveryType: tipo,
          paymentMode: input.modo_pago,
          recipientDni: s(input.dni).replace(/\D/g, ''),
          recipientName: s(input.nombres),
          recipientFirstLastname: s(input.apellido_paterno),
          recipientSecondLastname: s(input.apellido_materno),
          recipientPhone: s(input.celular).replace(/\D/g, ''),
          department: s(input.departamento),
          province: s(input.provincia),
          district: s(input.distrito),
          address: s(input.direccion),
          shalomTerminalId: s(input.agencia_ter_id),
          shalomAgencyName: s(input.agencia_nombre),
          notes: s(input.notas),
        });
        return JSON.stringify({
          ok: true,
          codigo: order.code,
          total: order.total,
          envio: order.shipping,
          adelanto_requerido: order.advance_required,
          modo_pago: order.payment_mode,
          items: order.items.map((i) => `${i.quantity} x ${i.name} @ S/${i.unit_price}`),
          instrucciones_pago: order.advance_required > 0
            ? `Yapear S/${order.advance_required} al ${config.business.yapeNumber} (${config.business.yapeName}) y enviar captura.`
            : 'Paga al recibir (efectivo o Yape al motorizado).',
        });
      } catch (e) {
        return `ERROR: ${e.message}`;
      }
    }

    case 'estado_pedido': {
      const orders = db.prepare(`SELECT * FROM orders WHERE conversation_id = ? OR (customer_id = ? AND customer_id IS NOT NULL)
        ORDER BY id DESC LIMIT 5`).all(ctx.conversation.id, ctx.conversation.customer_id);
      if (!orders.length) return 'Este cliente no tiene pedidos.';
      return JSON.stringify(orders.map((o) => ({
        codigo: o.code, estado: o.status, estado_shalom: o.shalom_status, total: o.total, pagado: o.paid_amount,
        saldo: +(o.total - o.paid_amount).toFixed(2), pago: o.payment_status, guia: o.shalom_order_number,
        codigo_guia: o.shalom_order_code, agencia: o.shalom_agency_name, creado: o.created_at,
        // la clave solo se entrega cuando el pedido está pagado completo
        clave: o.payment_status === 'pagado' ? o.shalom_pickup_key : '(se entrega al cancelar el saldo)',
      })));
    }

    case 'derivar_a_asesor':
      db.prepare('UPDATE conversations SET bot_enabled = 0 WHERE id = ?').run(ctx.conversation.id);
      setConversationStatus(ctx.conversation.id, 'no_atendida');
      ctx.handedOff = true;
      return `Derivado a asesor (motivo: ${s(input.motivo)}). Despídete diciendo que un asesor le escribirá en breve.`;

    default:
      return `ERROR: herramienta desconocida ${name}`;
  }
}
