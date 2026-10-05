// Configuración central: todo sale de variables de entorno (.env).
const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  dbPath: env.DB_PATH || 'data/crm.db',
  admin: {
    user: env.ADMIN_USER || 'admin',
    password: env.ADMIN_PASSWORD || '',
  },
  business: {
    name: env.BUSINESS_NAME || 'Mi Tienda',
    yapeNumber: env.YAPE_NUMBER || '',
    yapeName: env.YAPE_NAME || '',
    advanceAmount: Number(env.ADVANCE_AMOUNT || 20), // adelanto para envíos a provincia
    limaDeliveryFee: Number(env.LIMA_DELIVERY_FEE || 10),
  },
  anthropic: {
    enabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    model: env.BOT_MODEL || 'claude-opus-5-5',
    effort: env.BOT_EFFORT || 'low',
  },
  whatsapp: {
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
  },
  meta: {
    verifyToken: env.META_VERIFY_TOKEN || '',
    appSecret: env.META_APP_SECRET || '',
    pageToken: env.FB_PAGE_TOKEN || '',
    igToken: env.IG_TOKEN || env.FB_PAGE_TOKEN || '',
    graphVersion: env.META_GRAPH_VERSION || 'v21.0',
  },
  telegram: {
    token: env.TELEGRAM_BOT_TOKEN || '',
    secret: env.TELEGRAM_WEBHOOK_SECRET || '',
  },
  shalom: {
    baseUrl: env.SHALOM_API_URL || 'https://api.shalom-api.lat',
    apiKey: env.SHALOM_API_KEY || '',
    instanceId: env.SHALOM_INSTANCE_ID || '',
    originTerminal: env.SHALOM_ORIGIN_TERMINAL || '', // ter_id de tu agencia de origen
    webhookSecret: env.SHALOM_WEBHOOK_SECRET || '',
    defaultContent: env.SHALOM_DEFAULT_CONTENT || 'PAQUETE S',
    declaracion: env.SHALOM_DECLARACION || 'Electrodomésticos',
  },
};
