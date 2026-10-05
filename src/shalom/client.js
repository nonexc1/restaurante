// Cliente de Shalom API Perú (https://api.shalom-api.lat).
// Documentación: https://shalom-api.lat/docs — servicio independiente compatible con Shalom Pro.
// Las operaciones "Shalom Pro" (crear guías, DNI, pendientes) necesitan una instancia logueada
// con TUS credenciales de pro.shalom.pe (ver scripts/shalom-setup.js).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export class ShalomError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const AGENCY_CACHE_MS = 24 * 60 * 60 * 1000; // el catálogo se actualiza a diario
let agencyCache = { at: 0, data: null };

export function isConfigured() {
  return Boolean(config.shalom.apiKey);
}

async function request(method, path, { body, query, raw = false, retries = 3 } = {}) {
  if (!config.shalom.apiKey) throw new ShalomError('SHALOM_API_KEY no configurada', 0);
  const url = new URL(config.shalom.baseUrl + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        'x-api-key': config.shalom.apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      throw new ShalomError(`Shalom ${method} ${path} -> ${res.status}: ${parsed?.error || text}`, res.status, parsed);
    }
    if (raw) return res;
    return res.json();
  }
}

const instanceId = () => {
  if (!config.shalom.instanceId) throw new ShalomError('SHALOM_INSTANCE_ID no configurado (corre npm run shalom:setup)', 0);
  return config.shalom.instanceId;
};

export const shalom = {
  validate: () => request('GET', '/validate'),

  // ---- Agencias y ubicaciones
  async agencies() {
    if (agencyCache.data && Date.now() - agencyCache.at < AGENCY_CACHE_MS) return agencyCache.data;
    const res = await request('GET', '/agencies');
    agencyCache = { at: Date.now(), data: res.data || [] };
    return agencyCache.data;
  },
  searchAgencies: (params) => request('GET', '/agencies/search', { query: params }),
  departments: () => request('GET', '/locations/departments'),

  // ---- Instancias Shalom Pro
  createInstance: (name) => request('POST', '/instances', { body: { name } }),
  listInstances: () => request('GET', '/instances'),
  instanceStatus: () => request('POST', '/instances/status', { body: { instanceId: instanceId() } }),
  login: (id, username, password) => request('POST', '/instances/login', { body: { instanceId: id, username, password } }),

  // ---- Envíos
  quote: (origin, destination) => request('POST', '/account/quote', { body: { origin, destination } }),
  dni: (dni) => request('GET', `/account/dni/${encodeURIComponent(dni)}`),
  register: (shipment) => request('POST', '/account/register', { body: { instanceId: instanceId(), ...shipment } }),
  pending: () => request('POST', '/account/pending-shipments', { body: { instanceId: instanceId() } }),

  // ---- Tracking
  track: (orderNumber, orderCode) => request('POST', '/track', { body: { orderNumber, orderCode } }),
  trackBatch: (orders) => request('POST', '/track/batch', { body: { orders } }),
  label: (orderNumber, orderCode) => request('GET', '/track/label', { query: { orderNumber, orderCode }, raw: true }),
  voucher: (orderNumber, orderCode, format = 'pdf') =>
    request('GET', '/track/voucher', { query: { orderNumber, orderCode, format }, raw: true }),

  // ---- Webhooks
  setWebhook: (url, rotateSecret = false) => request('PUT', '/webhooks', { body: { url, rotateSecret } }),
  subscribe: (orderNumber, orderCode) => request('POST', '/tracking/subscriptions', { body: { orderNumber, orderCode } }),
  unsubscribe: (orderNumber, orderCode) =>
    request('DELETE', '/tracking/subscriptions', { query: { orderNumber, orderCode } }),
};

// Busca agencias por texto (departamento/provincia/distrito/zona) usando el catálogo cacheado.
export async function findAgencies(text, limit = 5) {
  const words = normalize(text).split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  const all = await shalom.agencies();
  return all
    .map((a) => {
      const hay = normalize(`${a.departamento} ${a.provincia} ${a.zona} ${a.lugar_over} ${a.nombre} ${a.direccion}`);
      const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(({ a }) => ({
      ter_id: a.ter_id,
      nombre: a.nombre || `${a.departamento} / ${a.provincia} / ${a.lugar_over}`,
      direccion: a.direccion,
      departamento: a.departamento,
      provincia: a.provincia,
      horario: a.hora_atencion,
      aereo: a.ter_aereo === 1,
    }));
}

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Las respuestas de Shalom Pro son un "espejo" del sistema de Shalom y su forma puede variar.
// Busca recursivamente el número de orden (8 dígitos) y el código (4 caracteres).
export function extractOrderIds(payload) {
  let orderNumber = '';
  let orderCode = '';
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const k = key.toLowerCase();
      if (typeof value === 'string' || typeof value === 'number') {
        const v = String(value).trim();
        if (!orderNumber && /^(ose_)?(num|numero|nro|orden|order_?number|guia)/.test(k) && /^\d{6,10}$/.test(v)) orderNumber = v;
        if (!orderCode && /(codigo|code|order_?code|cod_?seg)/.test(k) && /^[A-Z0-9]{4}$/i.test(v)) orderCode = v.toUpperCase();
      } else {
        visit(value);
      }
    }
  };
  visit(payload);
  return { orderNumber, orderCode };
}

// Extrae nombres desde la respuesta RENIEC espejo (forma variable).
export function extractPerson(payload) {
  const flat = {};
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') visit(v);
      else flat[k.toLowerCase()] = v;
    }
  };
  visit(payload);
  const pick = (...keys) => keys.map((k) => flat[k]).find((v) => typeof v === 'string' && v.trim()) || '';
  return {
    name: pick('nombres', 'name', 'nombre', 'prenombres'),
    firstLastname: pick('apellido_paterno', 'apellidopaterno', 'ape_paterno', 'paterno', 'firstname'),
    secondLastname: pick('apellido_materno', 'apellidomaterno', 'ape_materno', 'materno', 'lastname'),
  };
}

// Verifica X-Shalom-Signature: t=<unix>,v1=<hex> con HMAC-SHA256("<t>.<rawBody>").
export function verifyWebhookSignature(rawBody, header, secret = config.shalom.webhookSecret, toleranceSec = 600) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(parts.v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
