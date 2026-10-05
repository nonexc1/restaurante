// Registra el webhook del bot de Telegram: npm run telegram:webhook
import { config } from '../src/config.js';

if (!config.telegram.token || !config.publicUrl) {
  console.error('Configura TELEGRAM_BOT_TOKEN y PUBLIC_URL en .env');
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: `${config.publicUrl}/webhooks/telegram`,
    secret_token: config.telegram.secret || undefined,
    allowed_updates: ['message', 'edited_message'],
  }),
});
console.log(await res.json());
