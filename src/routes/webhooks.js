import { Router } from 'express';
import { config } from '../config.js';
import { parseMetaWebhook, parseTelegramUpdate, verifyMetaSignature, verifyTelegramSecret } from '../channels/index.js';
import { handleIncoming } from '../bot/inbound.js';
import { verifyWebhookSignature, extractOrderIds } from '../shalom/client.js';
import { applyTrackingUpdate } from '../services/orders.js';

export const webhooks = Router();

// ---- Meta (WhatsApp Cloud API, Messenger e Instagram usan la misma app)
webhooks.get('/meta', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.meta.verifyToken && config.meta.verifyToken;
  if (ok) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

webhooks.post('/meta', (req, res) => {
  if (!verifyMetaSignature(req.rawBody || '', req.get('x-hub-signature-256'))) return res.sendStatus(401);
  res.sendStatus(200); // responder rápido; Meta reintenta si tardamos
  for (const msg of parseMetaWebhook(req.body)) {
    handleIncoming(msg).catch((e) => console.error('[meta] ', e));
  }
});

// ---- Telegram
webhooks.post('/telegram', (req, res) => {
  if (!verifyTelegramSecret(req.get('x-telegram-bot-api-secret-token'))) return res.sendStatus(401);
  res.sendStatus(200);
  for (const msg of parseTelegramUpdate(req.body)) {
    handleIncoming(msg).catch((e) => console.error('[telegram] ', e));
  }
});

// ---- Shalom (cambios de estado de guías suscritas)
webhooks.post('/shalom', async (req, res) => {
  if (!verifyWebhookSignature(req.rawBody || '', req.get('x-shalom-signature'))) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const body = req.body || {};
    const data = body.data || body;
    const orderNumber = data.orderNumber || extractOrderIds(data).orderNumber;
    const status = data.status || data.lastStatus || data.estado || data.canonicalStatus || body.event || '';
    if (orderNumber && status) await applyTrackingUpdate(orderNumber, status, data);
  } catch (e) {
    console.error('[shalom webhook]', e);
  }
});
