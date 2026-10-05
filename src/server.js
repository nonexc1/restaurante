import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { api } from './routes/api.js';
import { webhooks } from './routes/webhooks.js';
import { seedIfEmpty } from './seed.js';
import { refreshAllTracking } from './services/orders.js';
import { isConfigured as shalomReady } from './shalom/client.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);

// Guardamos el cuerpo crudo para verificar firmas (Meta, Shalom).
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/webhooks', webhooks);

// Autenticación básica para el panel y su API.
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function auth(req, res, next) {
  if (!config.admin.password) {
    return res.status(503).send('Configura ADMIN_PASSWORD en el archivo .env para usar el panel.');
  }
  const [type, value] = (req.get('authorization') || '').split(' ');
  if (type === 'Basic' && value) {
    const [user, ...rest] = Buffer.from(value, 'base64').toString().split(':');
    if (safeEqual(user, config.admin.user) && safeEqual(rest.join(':'), config.admin.password)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="CRM", charset="UTF-8"').sendStatus(401);
}

app.use('/api', auth, api);
app.use('/', auth, express.static(join(here, '..', 'public')));

seedIfEmpty();

// Respaldo: cada 2 horas consulta el tracking de las guías activas por si se perdió algún webhook.
if (shalomReady()) {
  setInterval(() => refreshAllTracking().catch((e) => console.error('[tracking]', e.message)), 2 * 3600e3).unref();
}

const server = app.listen(config.port, () => {
  const products = db.prepare('SELECT COUNT(*) n FROM products').get().n;
  console.log(`CRM listo en http://localhost:${config.port}  (productos: ${products})`);
  console.log(`  Bot IA: ${config.anthropic.enabled ? `Claude (${config.anthropic.model})` : 'modo básico (sin ANTHROPIC_API_KEY)'}`);
  console.log(`  Shalom: ${shalomReady() ? 'API configurada' : 'sin configurar'}`);
  if (config.publicUrl) {
    console.log(`  Webhook Meta:     ${config.publicUrl}/webhooks/meta`);
    console.log(`  Webhook Telegram: ${config.publicUrl}/webhooks/telegram`);
    console.log(`  Webhook Shalom:   ${config.publicUrl}/webhooks/shalom`);
  }
});

export { app, server };
