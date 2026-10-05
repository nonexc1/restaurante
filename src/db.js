import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL NOT NULL,
  promo_price REAL,
  cost REAL DEFAULT 0,
  stock INTEGER DEFAULT 0,
  shalom_content TEXT DEFAULT 'PAQUETE S',
  image_url TEXT DEFAULT '',
  faq TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  dni TEXT DEFAULT '',
  department TEXT DEFAULT '',
  province TEXT DEFAULT '',
  district TEXT DEFAULT '',
  address TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,            -- whatsapp | instagram | facebook | telegram | web
  external_id TEXT NOT NULL,        -- id del usuario en el canal
  customer_id INTEGER REFERENCES customers(id),
  display_name TEXT DEFAULT '',
  status TEXT DEFAULT 'abierta',    -- abierta | venta | no_atendida | cerrada
  bot_enabled INTEGER DEFAULT 1,
  unread INTEGER DEFAULT 0,
  ai_history TEXT DEFAULT '[]',     -- historial del bot (append-only, formato Messages API)
  ai_history_started_at TEXT,
  last_message_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(channel, external_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  direction TEXT NOT NULL,          -- in | out
  sender TEXT NOT NULL,             -- cliente | bot | asesor | sistema
  type TEXT DEFAULT 'text',         -- text | image | audio | other
  body TEXT DEFAULT '',
  media_ref TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  conversation_id INTEGER REFERENCES conversations(id),
  delivery_type TEXT NOT NULL,      -- shalom_agencia | lima_delivery
  status TEXT DEFAULT 'nuevo',
  payment_mode TEXT DEFAULT 'adelanto', -- adelanto | completo | contraentrega
  subtotal REAL DEFAULT 0,
  shipping REAL DEFAULT 0,
  total REAL DEFAULT 0,
  advance_required REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  payment_status TEXT DEFAULT 'pendiente', -- pendiente | por_verificar | adelanto_pagado | pagado
  recipient_name TEXT DEFAULT '',
  recipient_first_lastname TEXT DEFAULT '',
  recipient_second_lastname TEXT DEFAULT '',
  recipient_dni TEXT DEFAULT '',
  recipient_phone TEXT DEFAULT '',
  department TEXT DEFAULT '',
  province TEXT DEFAULT '',
  district TEXT DEFAULT '',
  address TEXT DEFAULT '',
  shalom_terminal_id TEXT DEFAULT '',
  shalom_agency_name TEXT DEFAULT '',
  shalom_order_number TEXT DEFAULT '',
  shalom_order_code TEXT DEFAULT '',
  shalom_pickup_key TEXT DEFAULT '',
  shalom_status TEXT DEFAULT '',
  shalom_raw TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_shalom ON orders(shalom_order_number);
`);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// Ejecuta fn dentro de una transacción.
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
