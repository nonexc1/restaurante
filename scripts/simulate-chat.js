// Chatea con el bot desde la terminal como si fueras un cliente: npm run simulate
import { createInterface } from 'node:readline/promises';
import { db } from '../src/db.js';
import { seedIfEmpty } from '../src/seed.js';
import { handleIncoming } from '../src/bot/inbound.js';

seedIfEmpty();
const externalId = `terminal-${Date.now()}`;
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log('Escribe como cliente (Ctrl+C para salir). "/img" simula enviar una foto (voucher).\n');
let lastId = 0;
for (;;) {
  const text = await rl.question('Cliente> ');
  const isImg = text.trim() === '/img';
  await handleIncoming({ channel: 'web', externalId, name: 'Cliente terminal', type: isImg ? 'image' : 'text', text: isImg ? '' : text });
  const conv = db.prepare(`SELECT id FROM conversations WHERE channel = 'web' AND external_id = ?`).get(externalId);
  const out = db.prepare(`SELECT * FROM messages WHERE conversation_id = ? AND id > ? AND direction = 'out' ORDER BY id`).all(conv.id, lastId);
  for (const m of out) console.log(`\n[${m.sender}] ${m.body}\n`);
  lastId = db.prepare('SELECT MAX(id) m FROM messages WHERE conversation_id = ?').get(conv.id).m;
}
