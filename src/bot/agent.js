// Bot vendedor con Claude: responde, resuelve dudas, toma datos y crea pedidos usando herramientas.
import Anthropic from '@anthropic-ai/sdk';
import { db, getSetting } from '../db.js';
import { config } from '../config.js';
import { toolDefinitions, runTool, catalogText } from './tools.js';

const client = config.anthropic.enabled ? new Anthropic() : null;

const MAX_TOOL_ROUNDS = 8;
const HISTORY_IDLE_HOURS = 24; // pasado este tiempo sin hablar, el bot empieza un hilo nuevo
const HISTORY_MAX_MESSAGES = 80;

export function systemPrompt() {
  const b = config.business;
  const extra = getSetting('bot_extra_instructions', '');
  return `Eres el asesor de ventas de "${b.name}", una tienda online peruana que vende por WhatsApp, Instagram, Facebook y Telegram.
Hablas en español peruano, cálido y directo, con mensajes cortos (2-4 líneas) y algún emoji. Nunca inventes precios, stock, plazos ni políticas: usa solo la información de abajo y tus herramientas.

OBJETIVO: resolver dudas rápido y cerrar la venta, tomando los datos completos sin errores.

CATÁLOGO ACTUAL:
${catalogText()}

MODALIDADES DE ENTREGA Y PAGO:
1) Lima Metropolitana — delivery a domicilio con pago contraentrega (efectivo o Yape al recibir). Costo de delivery S/${b.limaDeliveryFee}. Datos: nombre, celular, distrito, dirección exacta y referencia.
2) Provincias — envío por agencia Shalom (el cliente recoge en la agencia de su ciudad). Para confirmar el pedido, el cliente yapea un adelanto de S/${b.advanceAmount} al ${b.yapeNumber || '(número Yape)'} a nombre de ${b.yapeName || '(titular)'}. Cuando el paquete llega a la agencia le avisamos, paga el saldo y le enviamos la clave de recojo. También puede pagar el 100% por adelantado.
   Datos: DNI, nombres, apellido paterno, apellido materno, celular y la agencia Shalom elegida (usa buscar_agencias_shalom con su ciudad/distrito y ofrécele 2-3 opciones con dirección).
   Si te da el DNI usa consultar_dni para obtener nombres exactos y confírmalos con el cliente.

FLUJO DE VENTA:
- Saluda, identifica el producto que le interesa y su ciudad.
- Cuando el cliente elija un producto, ofrece UNA vez el combo o un complemento del catálogo si tiene sentido (ej. ventilador + lámpara mata zancudos).
- Resalta beneficios concretos y resuelve objeciones con la FAQ. Si duda por desconfianza, explica que en Lima paga al recibir y que en provincia solo adelanta S/${b.advanceAmount} y el resto cuando el paquete ya está en su agencia.
- Antes de crear el pedido, envía un RESUMEN (producto, cantidad, precio, envío, total, datos y agencia/dirección) y pide confirmación explícita ("¿Confirmo tu pedido?").
- Solo después del "sí", usa crear_pedido. Luego da el código del pedido y las instrucciones de pago que devuelve la herramienta.
- Si el cliente envía una imagen tras pedir el adelanto, es probablemente su comprobante: agradece y dile que lo validamos en minutos.
- Ante reclamos, devoluciones, compras al por mayor (más de 5 unidades), problemas de pago o algo que no sepas, usa derivar_a_asesor.
- Nunca reveles la clave de recojo si el pedido no está pagado completo. No pidas datos de tarjetas ni contraseñas.
${extra ? `\nINSTRUCCIONES ADICIONALES DEL NEGOCIO:\n${extra}` : ''}`;
}

function loadHistory(conv) {
  let history = [];
  try { history = JSON.parse(conv.ai_history || '[]'); } catch { history = []; }
  const started = conv.ai_history_started_at ? Date.parse(conv.ai_history_started_at + 'Z') : 0;
  const idleMs = Date.now() - Date.parse(conv.last_message_at + 'Z');
  // Empezar hilo nuevo si está muy largo o hubo mucho tiempo sin actividad.
  // (No recortamos mensajes intermedios: el historial se mantiene append-only.)
  if (!history.length || history.length > HISTORY_MAX_MESSAGES || idleMs > HISTORY_IDLE_HOURS * 3600e3 || !started) {
    return { history: [], fresh: true };
  }
  return { history, fresh: false };
}

function saveHistory(convId, history, fresh) {
  if (fresh) {
    db.prepare(`UPDATE conversations SET ai_history = ?, ai_history_started_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(history), convId);
  } else {
    db.prepare('UPDATE conversations SET ai_history = ? WHERE id = ?').run(JSON.stringify(history), convId);
  }
}

function customerContext(conv) {
  const c = conv.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(conv.customer_id) : null;
  const orders = db.prepare('SELECT code, status, total, paid_amount FROM orders WHERE conversation_id = ? ORDER BY id DESC LIMIT 3').all(conv.id);
  const parts = [`Canal: ${conv.channel}`];
  if (conv.display_name) parts.push(`Nombre de perfil: ${conv.display_name}`);
  if (c?.dni) parts.push(`DNI conocido: ${c.dni}`);
  if (c?.department || c?.district) parts.push(`Ubicación conocida: ${[c.district, c.province, c.department].filter(Boolean).join(', ')}`);
  if (orders.length) parts.push(`Pedidos previos: ${orders.map((o) => `${o.code} (${o.status}, total S/${o.total}, pagado S/${o.paid_amount})`).join('; ')}`);
  return parts.join(' · ');
}

/**
 * Genera la respuesta del bot a un mensaje entrante.
 * @returns {Promise<{ text: string, handedOff: boolean }>}
 */
export async function replyWithClaude(conv, userText) {
  const { history, fresh } = loadHistory(conv);
  const content = fresh ? `[Contexto del cliente — ${customerContext(conv)}]\n\n${userText}` : userText;

  // Si el último mensaje guardado es del usuario (p.ej. una respuesta anterior falló), se une el texto.
  const last = history.at(-1);
  if (last?.role === 'user' && typeof last.content === 'string') last.content += `\n${content}`;
  else history.push({ role: 'user', content });

  const ctx = { conversation: conv, handedOff: false };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: config.anthropic.model,
      max_tokens: 4000,
      system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
      tools: toolDefinitions,
      messages: history,
      thinking: { type: 'adaptive' },
      output_config: { effort: config.anthropic.effort },
      // Si el modelo declina por políticas, la API reintenta con un modelo alternativo.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    if (response.stop_reason === 'refusal') {
      saveHistory(conv.id, history, fresh);
      return { text: '', handedOff: true, refusal: true };
    }

    history.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'tool_use') {
      const results = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let output;
        try {
          output = await runTool(block.name, block.input || {}, ctx);
        } catch (e) {
          output = `ERROR: ${e.message}`;
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: String(output), is_error: String(output).startsWith('ERROR') });
      }
      history.push({ role: 'user', content: results });
      continue;
    }

    if (response.stop_reason === 'pause_turn') continue;

    saveHistory(conv.id, history, fresh);
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return { text, handedOff: ctx.handedOff };
  }

  saveHistory(conv.id, history, fresh);
  return { text: '', handedOff: true };
}

// Bot de respaldo sin IA (cuando no hay ANTHROPIC_API_KEY): saluda, muestra catálogo y deriva.
export function replyWithoutAI(conv, userText, isFirstMessage) {
  const b = config.business;
  if (isFirstMessage) {
    return {
      text: `¡Hola! 👋 Gracias por escribir a ${b.name}.\n\n${catalogText(true)}\n\n` +
        `🚚 Lima: delivery contraentrega (S/${b.limaDeliveryFee}).\n📦 Provincias: envío por Shalom, adelantas S/${b.advanceAmount} y el resto cuando llega a tu agencia.\n\n` +
        'Cuéntame qué producto te interesa y tu ciudad, y un asesor te atiende en breve 🙌',
      handedOff: false,
    };
  }
  return { text: '', handedOff: false };
}
