// Envío de mensajes salientes por canal + parseo de webhooks entrantes.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const graph = (path) => `https://graph.facebook.com/${config.meta.graphVersion}${path}`;

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url.split('?')[0]} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// Divide textos largos (WhatsApp ~4096, Messenger/IG 2000, Telegram 4096).
function chunks(text, max) {
  const out = [];
  let rest = String(text);
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

export const senders = {
  async whatsapp(to, text) {
    if (!config.whatsapp.token) throw new Error('WHATSAPP_TOKEN no configurado');
    for (const part of chunks(text, 4000)) {
      await postJson(graph(`/${config.whatsapp.phoneNumberId}/messages`), {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: part },
      }, { Authorization: `Bearer ${config.whatsapp.token}` });
    }
  },

  async facebook(to, text) {
    if (!config.meta.pageToken) throw new Error('FB_PAGE_TOKEN no configurado');
    for (const part of chunks(text, 1900)) {
      await postJson(graph(`/me/messages?access_token=${encodeURIComponent(config.meta.pageToken)}`), {
        recipient: { id: to },
        messaging_type: 'RESPONSE',
        message: { text: part },
      });
    }
  },

  async instagram(to, text) {
    if (!config.meta.igToken) throw new Error('IG_TOKEN / FB_PAGE_TOKEN no configurado');
    for (const part of chunks(text, 900)) {
      await postJson(graph(`/me/messages?access_token=${encodeURIComponent(config.meta.igToken)}`), {
        recipient: { id: to },
        message: { text: part },
      });
    }
  },

  async telegram(to, text) {
    if (!config.telegram.token) throw new Error('TELEGRAM_BOT_TOKEN no configurado');
    for (const part of chunks(text, 4000)) {
      await postJson(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, { chat_id: to, text: part });
    }
  },

  // Canal "web": usado por el simulador del panel; no envía nada hacia afuera.
  async web() {},
};

export async function sendText(channel, to, text) {
  const fn = senders[channel];
  if (!fn) throw new Error(`Canal desconocido: ${channel}`);
  return fn(to, text);
}

// ---------- Verificación de firmas

export function verifyMetaSignature(rawBody, header) {
  if (!config.meta.appSecret) return true; // sin secreto configurado no se puede verificar (solo desarrollo)
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', config.meta.appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyTelegramSecret(header) {
  if (!config.telegram.secret) return true;
  return header === config.telegram.secret;
}

// ---------- Parseo de webhooks → mensajes normalizados
// { channel, externalId, name, type, text, mediaRef, messageId }

export function parseMetaWebhook(body) {
  const out = [];
  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name || '']));
        for (const m of value.messages || []) {
          const base = { channel: 'whatsapp', externalId: m.from, name: names[m.from] || '', messageId: m.id };
          if (m.type === 'text') out.push({ ...base, type: 'text', text: m.text?.body || '' });
          else if (m.type === 'image') out.push({ ...base, type: 'image', text: m.image?.caption || '', mediaRef: m.image?.id || '' });
          else if (m.type === 'audio') out.push({ ...base, type: 'audio', text: '', mediaRef: m.audio?.id || '' });
          else if (m.type === 'button') out.push({ ...base, type: 'text', text: m.button?.text || '' });
          else if (m.type === 'interactive') {
            const r = m.interactive?.button_reply || m.interactive?.list_reply || {};
            out.push({ ...base, type: 'text', text: r.title || '' });
          } else if (m.type === 'location') {
            out.push({ ...base, type: 'text', text: `[Ubicación] ${m.location?.name || ''} ${m.location?.address || ''} (${m.location?.latitude},${m.location?.longitude})` });
          } else out.push({ ...base, type: 'other', text: `[${m.type}]` });
        }
      }
    }
  } else if (body.object === 'page' || body.object === 'instagram') {
    const channel = body.object === 'page' ? 'facebook' : 'instagram';
    for (const entry of body.entry || []) {
      for (const ev of entry.messaging || []) {
        const msg = ev.message;
        if (!msg || msg.is_echo) continue;
        const base = { channel, externalId: ev.sender?.id, name: '', messageId: msg.mid };
        const image = (msg.attachments || []).find((a) => a.type === 'image');
        if (msg.text) out.push({ ...base, type: 'text', text: msg.text });
        else if (image) out.push({ ...base, type: 'image', text: '', mediaRef: image.payload?.url || '' });
        else if (msg.attachments?.length) out.push({ ...base, type: 'other', text: `[${msg.attachments[0].type}]` });
      }
    }
  }
  return out;
}

export function parseTelegramUpdate(update) {
  const m = update.message || update.edited_message;
  if (!m?.chat) return [];
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || '';
  const base = { channel: 'telegram', externalId: String(m.chat.id), name, messageId: String(m.message_id) };
  if (m.text) return [{ ...base, type: 'text', text: m.text }];
  if (m.photo?.length) return [{ ...base, type: 'image', text: m.caption || '', mediaRef: m.photo.at(-1).file_id }];
  if (m.voice) return [{ ...base, type: 'audio', text: '', mediaRef: m.voice.file_id }];
  if (m.contact) return [{ ...base, type: 'text', text: `[Contacto] ${m.contact.phone_number}` }];
  return [{ ...base, type: 'other', text: '[mensaje no soportado]' }];
}
