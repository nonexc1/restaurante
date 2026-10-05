# Cómo conectar WhatsApp, Instagram, Facebook, Telegram, Claude y Shalom

Todos los webhooks necesitan una **URL pública con HTTPS** (`PUBLIC_URL`). Primero publica el CRM
(ver README → "Publicarlo en internet") y luego sigue estos pasos.

## 1. Bot IA (Claude)
1. Crea una cuenta en <https://console.anthropic.com>, agrega saldo y genera una **API key**.
2. Pon `ANTHROPIC_API_KEY=...` en `.env` y reinicia.
3. Prueba en el panel → **Probar bot**. Ajusta el tono, promociones y políticas en **Ajustes → Instrucciones extra**.
4. Sin API key el CRM funciona en "modo básico": saluda con el catálogo y deja el chat para un asesor.

## 2. Meta: WhatsApp, Facebook Messenger e Instagram (una sola app)
1. En <https://developers.facebook.com> crea una app tipo **Empresa** y vincúlala a tu **Business Manager**.
2. **Webhook** (Configuración de la app → Webhooks o en cada producto):
   - URL: `https://TU-DOMINIO/webhooks/meta`
   - Token de verificación: el mismo valor de `META_VERIFY_TOKEN`
   - Copia el **App Secret** (Configuración → Básica) en `META_APP_SECRET`.
3. **WhatsApp** (producto "WhatsApp"):
   - Agrega tu número (que no esté en la app de WhatsApp del celular, o migra el de WhatsApp Business).
   - Crea un **usuario del sistema** en Business Manager con permiso `whatsapp_business_messaging` y genera un
     **token permanente** → `WHATSAPP_TOKEN`. Copia el **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
   - En Webhooks suscríbete al campo `messages`.
   - Ventana de 24 h: puedes responder libremente durante 24 h desde el último mensaje del cliente. Para escribir
     después (p. ej. avisar que llegó a la agencia días después) Meta exige **plantillas aprobadas**. Si el cliente
     no ha escrito en 24 h, el aviso puede fallar: el CRM lo registra como "⚠️ No se pudo enviar" para que lo hagas manual.
     Recomendación: crea plantillas "pedido_en_agencia" y "clave_recojo" en WhatsApp Manager.
4. **Facebook Messenger** (producto "Messenger"): conecta tu página, genera el **token de la página** →
   `FB_PAGE_TOKEN` y suscribe la página a `messages`.
5. **Instagram** (producto "Instagram" / Messenger API para Instagram): la cuenta debe ser profesional y estar
   vinculada a tu página. Usa el token de la página (o pon uno específico en `IG_TOKEN`) y suscribe `messages`.
6. Para salir de "modo desarrollo" y atender a cualquier cliente, pasa la **revisión de la app** pidiendo
   `whatsapp_business_messaging`, `pages_messaging` e `instagram_manage_messages`.
7. Anuncios: crea campañas con objetivo **Interacción → Mensajes** con destino WhatsApp, Messenger o Instagram.

## 3. Telegram
1. Habla con **@BotFather** → `/newbot` → copia el token en `TELEGRAM_BOT_TOKEN`.
2. Inventa un texto en `TELEGRAM_WEBHOOK_SECRET`.
3. Ejecuta `npm run telegram:webhook` (con `PUBLIC_URL` configurada).

## 4. Shalom (guías, tracking y clave de recojo)
Shalom no publica una API oficial para tiendas; el CRM usa **Shalom API Perú** (<https://shalom-api.lat>), un servicio
independiente compatible con **Shalom Pro** que genera guías reales con **tus** credenciales.
1. Crea tu cuenta empresa en **Shalom Pro** (shalom.com.pe → Empresas → Shalom Pro).
2. Solicita tu **API key** en shalom-api.lat → `SHALOM_API_KEY`. (Tiene planes con cuota mensual.)
3. Ejecuta `npm run shalom:setup`: valida la key, crea una **instancia**, inicia sesión en Shalom Pro, registra el
   **webhook de tracking** y te muestra agencias para elegir tu origen. Copia en `.env`:
   `SHALOM_INSTANCE_ID`, `SHALOM_WEBHOOK_SECRET`, `SHALOM_ORIGIN_TERMINAL`.
4. Ajusta `SHALOM_DEFAULT_CONTENT` (SOBRE, PAQUETE XS/S/M/L) y en cada producto su **Tamaño Shalom**.

Flujo dentro del CRM:
1. El bot crea el pedido con DNI, nombres, celular y agencia destino (`ter_id`).
2. Registras el **adelanto** (verificado en tu Yape) → el pedido pasa a *Confirmado*.
3. Botón **Generar guía Shalom** → crea la guía con una **clave aleatoria**, suscribe el tracking y avisa al cliente.
4. **Etiqueta** → imprime el PDF y pégalo en la caja. Lleva el paquete a tu agencia de origen.
5. Cuando Shalom marca el paquete en la agencia destino (webhook o botón *Actualizar tracking*), el CRM le pide el
   saldo al cliente. Al registrar el pago completo, **envía la clave automáticamente**.

> Nota: las respuestas de Shalom Pro son un "espejo" de su sistema y su formato puede cambiar. Si después de generar la
> guía no aparece el N° de guía/código, cópialos desde pro.shalom.pe al pedido (campos editables) y todo sigue igual.
