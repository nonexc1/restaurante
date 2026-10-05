import { db } from '../db.js';
import { sendText } from '../channels/index.js';
import { bus } from './events.js';

export function upsertConversation({ channel, externalId, name }) {
  let conv = db.prepare('SELECT * FROM conversations WHERE channel = ? AND external_id = ?').get(channel, externalId);
  if (!conv) {
    const phone = channel === 'whatsapp' ? externalId : '';
    const customer = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(name || '', phone);
    db.prepare('INSERT INTO conversations (channel, external_id, customer_id, display_name) VALUES (?, ?, ?, ?)')
      .run(channel, externalId, customer.lastInsertRowid, name || externalId);
    conv = db.prepare('SELECT * FROM conversations WHERE channel = ? AND external_id = ?').get(channel, externalId);
  } else if (name && (!conv.display_name || conv.display_name === externalId)) {
    db.prepare('UPDATE conversations SET display_name = ? WHERE id = ?').run(name, conv.id);
    conv.display_name = name;
  }
  return conv;
}

export function getConversation(id) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

export function saveMessage(conversationId, { direction, sender, type = 'text', body = '', mediaRef = '' }) {
  const r = db.prepare(
    'INSERT INTO messages (conversation_id, direction, sender, type, body, media_ref) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, direction, sender, type, body, mediaRef);
  db.prepare(
    `UPDATE conversations SET last_message_at = datetime('now'), unread = CASE WHEN ? = 'in' THEN unread + 1 ELSE unread END WHERE id = ?`
  ).run(direction, conversationId);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid);
  bus.emit('message', { conversationId, message: msg });
  return msg;
}

// Envía un texto al cliente por su canal y lo registra en la conversación.
export async function sendToConversation(conversationId, text, sender = 'bot') {
  const conv = getConversation(conversationId);
  if (!conv) throw new Error('Conversación no encontrada');
  try {
    await sendText(conv.channel, conv.external_id, text);
  } catch (err) {
    console.error(`[${conv.channel}] error enviando a ${conv.external_id}:`, err.message);
    saveMessage(conversationId, { direction: 'out', sender: 'sistema', body: `⚠️ No se pudo enviar: ${err.message}` });
    throw err;
  }
  return saveMessage(conversationId, { direction: 'out', sender, body: text });
}

export function setConversationStatus(conversationId, status) {
  db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(status, conversationId);
}
