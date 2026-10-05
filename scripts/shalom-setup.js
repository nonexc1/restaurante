// Asistente para conectar tu cuenta de Shalom Pro: npm run shalom:setup
// 1) valida la API key  2) crea una instancia  3) inicia sesión con tus credenciales de pro.shalom.pe
// 4) registra el webhook de tracking  5) te muestra agencias para elegir tu SHALOM_ORIGIN_TERMINAL
import { createInterface } from 'node:readline/promises';
import { config } from '../src/config.js';
import { shalom, findAgencies } from '../src/shalom/client.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const step = (t) => console.log(`\n=== ${t}`);

if (!config.shalom.apiKey) {
  console.error('Primero pon SHALOM_API_KEY en .env (se solicita en https://shalom-api.lat).');
  process.exit(1);
}

step('1. Validando API key');
console.log(await shalom.validate());

let instanceId = config.shalom.instanceId;
if (!instanceId) {
  step('2. Creando instancia');
  const r = await shalom.createInstance(config.business.name || 'Mi tienda');
  instanceId = r.instanceId;
  console.log(`Instancia creada: ${instanceId}  -> copia esto en SHALOM_INSTANCE_ID`);
}

step('3. Login en Shalom Pro');
const username = await rl.question('Usuario/email de pro.shalom.pe: ');
const password = await rl.question('Contraseña: ');
console.log(await shalom.login(instanceId, username, password));

if (config.publicUrl) {
  step('4. Registrando webhook de tracking');
  const w = await shalom.setWebhook(`${config.publicUrl}/webhooks/shalom`);
  console.log(`Secreto del webhook: ${w.webhook?.secret}  -> copia esto en SHALOM_WEBHOOK_SECRET (se muestra solo una vez)`);
} else {
  console.log('\n(4. Omitido: configura PUBLIC_URL para registrar el webhook de tracking)');
}

step('5. Elige tu agencia de ORIGEN (donde dejarás los paquetes)');
const q = await rl.question('Escribe tu distrito/zona (ej. "Lima Malvinas", "La Victoria"): ');
for (const a of await findAgencies(q, 10)) console.log(`ter_id ${a.ter_id}  ·  ${a.nombre}  ·  ${a.direccion}`);
console.log('\nCopia el ter_id elegido en SHALOM_ORIGIN_TERMINAL y reinicia el servidor.');
rl.close();
