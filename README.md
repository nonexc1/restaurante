# VendeBot CRM — ventas por chat + bot IA + envíos Shalom (Perú)

CRM omnicanal para vender por **WhatsApp, Instagram, Facebook Messenger y Telegram**, con un **bot de IA (Claude)**
que responde 24/7, toma los datos del cliente, **crea los pedidos** y está conectado a **Shalom** para generar guías,
imprimir etiquetas, rastrear envíos y entregar la **clave de recojo** solo cuando el cliente pagó.

Incluye el análisis del video de referencia y un plan de negocio completo:

| Documento | Contenido |
|---|---|
| [docs/01-ANALISIS-DEL-VIDEO.md](docs/01-ANALISIS-DEL-VIDEO.md) | Qué hace el vendedor del video: producto, anuncios, CRM, logística y cobro. |
| [docs/02-PLAN-DE-NEGOCIO.md](docs/02-PLAN-DE-NEGOCIO.md) | Producto recomendado para el verano 2026–2027, dónde comprarlo, modelo de cobro, números y cómo empezar. |
| [docs/03-CONEXION-CANALES.md](docs/03-CONEXION-CANALES.md) | Paso a paso para conectar Meta (WhatsApp/IG/FB), Telegram, Claude y Shalom. |

## Qué hace

- **Bandeja única** de conversaciones de todos los canales, con filtros (Ventas, No atendidas, Cerradas) y
  actualización en tiempo real. Puedes responder tú y el bot se pausa en ese chat.
- **Bot vendedor con IA**: responde dudas con tu catálogo y FAQ, ofrece el combo, busca la **agencia Shalom** más
  cercana, valida el **DNI**, muestra un resumen y crea el pedido tras la confirmación. Deriva a un humano ante
  reclamos, mayoristas o problemas.
- **Pedidos** con estados: nuevo → confirmado → guía generada → en tránsito → en agencia → pagado → clave enviada →
  entregado (o delivery Lima: confirmado → en ruta → entregado).
- **Cobro seguro**: Lima contraentrega; provincias adelanto + saldo. Si el cliente envía la foto del voucher, el
  pedido queda "por verificar"; tú confirmas el Yape y el CRM avisa al cliente.
- **Shalom**: generar guía, etiqueta PDF, tracking por webhook firmado (y respaldo cada 2 h), aviso automático al
  cliente cuando llega a su agencia y envío de la clave al pagar.
- **Productos** con precio, promo, costo, margen, stock (se descuenta al vender y se repone al cancelar) y FAQ.
- **Simulador** para probar el bot sin conectar ningún canal.

## Instalación (local)

Requisitos: **Node.js 22.5 o superior** (usa SQLite integrado, no necesita base de datos externa).

```bash
npm install
cp .env.example .env      # completa al menos ADMIN_PASSWORD (y ANTHROPIC_API_KEY para el bot IA)
npm start                 # abre http://localhost:3000  (usuario: admin / tu ADMIN_PASSWORD)
```

- `npm run simulate` — conversa con el bot desde la terminal (escribe `/img` para simular un voucher).
- `npm test` — pruebas del flujo de pedidos, firmas de webhooks y parseo de canales.
- `npm run shalom:setup` — conecta tu cuenta de Shalom Pro.
- `npm run telegram:webhook` — registra el webhook del bot de Telegram.

## Publicarlo en internet

Los canales necesitan una URL **HTTPS** pública. Opciones:
- **Railway / Render / Fly.io**: crea un servicio desde este repositorio, comando `npm start`, agrega las variables
  del `.env` y un **volumen/disco persistente** montado en `data/` (ahí vive la base SQLite).
- **VPS** (DigitalOcean, Contabo, etc.): `npm install && npm start` con `pm2` y Nginx + Let's Encrypt.
- Para pruebas: `cloudflared tunnel --url http://localhost:3000` o `ngrok http 3000`.

Pon la URL en `PUBLIC_URL` y configura los webhooks:

| Canal | URL del webhook |
|---|---|
| WhatsApp, Facebook, Instagram | `https://TU-DOMINIO/webhooks/meta` |
| Telegram | `https://TU-DOMINIO/webhooks/telegram` |
| Shalom (tracking) | `https://TU-DOMINIO/webhooks/shalom` |

## Estructura

```
src/
  server.js            Express: panel, API y webhooks
  config.js            variables de entorno
  db.js                SQLite (productos, clientes, conversaciones, mensajes, pedidos)
  channels/index.js    envío y parseo de WhatsApp, Messenger, Instagram, Telegram
  bot/agent.js         bot vendedor con Claude (herramientas + historial por chat)
  bot/tools.js         catálogo, agencias Shalom, DNI, crear pedido, estado, derivar
  bot/inbound.js       procesa cada mensaje entrante (cola por chat, vouchers)
  services/orders.js   ciclo de vida del pedido, pagos, guías, tracking, clave
  shalom/client.js     cliente de Shalom API (guías, tracking, agencias, webhooks)
public/                panel web (HTML/CSS/JS sin dependencias)
scripts/               simulador, setup de Shalom y Telegram
docs/                  análisis del video y plan de negocio
```

## Seguridad
- El panel y la API están protegidos con usuario/contraseña (`ADMIN_USER` / `ADMIN_PASSWORD`). Úsalo siempre con HTTPS.
- Los webhooks verifican firmas: Meta (`X-Hub-Signature-256` con `META_APP_SECRET`), Telegram (`secret_token`) y
  Shalom (`X-Shalom-Signature` HMAC-SHA256).
- La clave de recojo nunca se envía ni la revela el bot si el pedido no está pagado completo.
- Nunca subas tu `.env` al repositorio (ya está en `.gitignore`).
