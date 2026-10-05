// Punto de entrada de todos los mensajes de clientes (de cualquier canal).
import { db } from '../db.js';
import { config } from '../config.js';
import { upsertConversation, saveMessage, sendToConversation, getConversation, setConversationStatus } from '../services/conversations.js';
import { logEvent } from '../services/orders.js';
import { replyWithClaude, replyWithoutAI } from './agent.js';

const queues = new Map(); // serializa el procesamiento por conversación
const seen = new Set(); // deduplicación de reintentos de webhooks

function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  queues.set(key, next);
  return next;
}

export function handleIncoming(msg) {
  if (msg.messageId) {
    const id = `${msg.channel}:${msg.messageId}`;
    if (seen.has(id)) return Promise.resolve();
    seen.add(id);
    if (seen.size > 5000) seen.delete(seen.values().next().value);
  }
  return enqueue(`${msg.channel}:${msg.externalId}`, () => processIncoming(msg));
}

async function processIncoming(msg) {
  const conv = upsertConversation(msg); // estado previo (last_message_at antes de este mensaje)
  const isFirstMessage = !db.prepare('SELECT 1 FROM messages WHERE conversation_id = ? LIMIT 1').get(conv.id);
  saveMessage(conv.id, { direction: 'in', sender: 'cliente', type: msg.type, body: msg.text || '', mediaRef: msg.mediaRef || '' });
  if (conv.status === 'cerrada') setConversationStatus(conv.id, 'abierta');

  let textForBot = msg.text || '';
  if (msg.type === 'image') {
    const pending = db.prepare(`SELECT * FROM orders WHERE conversation_id = ? AND payment_status IN ('pendiente','adelanto_pagado')
      AND status NOT IN ('cancelado','devuelto','entregado') ORDER BY id DESC LIMIT 1`).get(conv.id);
    if (pending) {
      db.prepare(`UPDATE orders SET payment_status = 'por_verificar', updated_at = datetime('now') WHERE id = ?`).run(pending.id);
      logEvent(pending.id, 'comprobante', 'El cliente envió una imagen (posible voucher Yape/Plin). Verificar y registrar pago.');
      textForBot = `[El cliente envió una imagen, probablemente el comprobante de pago del pedido ${pending.code}. Ya quedó marcado para verificación del asesor.] ${msg.text || ''}`;
    } else {
      textForBot = `[El cliente envió una imagen] ${msg.text || ''}`;
    }
  } else if (msg.type === 'audio') {
    textForBot = '[El cliente envió una nota de voz que no puedes escuchar. Pídele amablemente que lo escriba.]';
  } else if (msg.type === 'other') {
    textForBot = `[El cliente envió un contenido no soportado: ${msg.text}]`;
  }

  const fresh = getConversation(conv.id);
  if (!fresh.bot_enabled) return;

  try {
    const reply = config.anthropic.enabled
      ? await replyWithClaude({ ...fresh, last_message_at: conv.last_message_at }, textForBot)
      : replyWithoutAI(fresh, textForBot, isFirstMessage);

    if (reply.text) await sendToConversation(conv.id, reply.text, 'bot');
    if (reply.handedOff) {
      db.prepare('UPDATE conversations SET bot_enabled = 0 WHERE id = ?').run(conv.id);
      setConversationStatus(conv.id, 'no_atendida');
      if (!reply.text) await sendToConversation(conv.id, 'Te comunico con un asesor, en breve te escribe 🙌', 'bot').catch(() => {});
    } else if (!config.anthropic.enabled && !isFirstMessage) {
      setConversationStatus(conv.id, 'no_atendida');
    }
  } catch (err) {
    console.error('[bot] error:', err);
    saveMessage(conv.id, { direction: 'out', sender: 'sistema', body: `⚠️ Error del bot: ${err.message}. Atiende manualmente.` });
    setConversationStatus(conv.id, 'no_atendida');
  }
}
