// Productos iniciales (precios y costos referenciales: ajústalos con tus cotizaciones reales).
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const PRODUCTS = [
  {
    sku: 'VENT-PLEG-01',
    name: 'Ventilador recargable plegable de pie (sin cables)',
    description: 'Ventilador telescópico que se pliega como maletín. Batería recargable de larga duración (ideal para cortes de luz), 4 velocidades, control remoto, altura regulable de mesa a pie. Carga USB-C.',
    price: 159, promo_price: 139, cost: 70, stock: 50, shalom_content: 'PAQUETE M',
    faq: 'Batería: 8-20 h según velocidad. Carga completa: ~5 h. Garantía 30 días por fallas de fábrica. Se usa enchufado mientras carga. No necesita instalación.',
  },
  {
    sku: 'ZANC-LAMP-01',
    name: 'Lámpara mata zancudos recargable (UV + raqueta 2 en 1)',
    description: 'Atrapa y elimina zancudos sin químicos ni olor. Luz UV que los atrae + modo raqueta eléctrica. Recargable USB, segura para niños y mascotas (rejilla protegida).',
    price: 59, promo_price: 49, cost: 14, stock: 100, shalom_content: 'PAQUETE XS',
    faq: 'Cubre una habitación (~20 m²). Úsala de noche con la luz apagada. Batería ~8 h. No reemplaza el repelente ni las medidas contra el dengue, las complementa.',
  },
  {
    sku: 'COMBO-VERANO-01',
    name: 'Combo Verano: ventilador recargable + lámpara mata zancudos',
    description: 'El combo para el calor y los zancudos de este verano. Ahorras S/19 frente a comprarlos por separado.',
    price: 188, promo_price: 169, cost: 84, stock: 40, shalom_content: 'PAQUETE M',
    faq: 'Incluye 1 ventilador recargable plegable + 1 lámpara mata zancudos 2 en 1.',
  },
  {
    sku: 'CLIMA-MURAL-01',
    name: 'Calefactor mural frío-calor con control remoto (temporada invierno)',
    description: 'Calefactor de pared 2 en 1 con pantalla digital, temporizador y control remoto. Calienta un dormitorio en minutos.',
    price: 149, promo_price: 129, cost: 55, stock: 0, shalom_content: 'PAQUETE M', active: 0,
    faq: 'Es un calefactor con modo ventilación: NO enfría como un aire acondicionado de compresor. Consumo ~2000 W en calor.',
  },
];

export function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) n FROM products').get().n > 0) return false;
  const insert = db.prepare(`INSERT INTO products (sku, name, description, price, promo_price, cost, stock, shalom_content, faq, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of PRODUCTS) {
    insert.run(p.sku, p.name, p.description, p.price, p.promo_price, p.cost, p.stock, p.shalom_content, p.faq, p.active ?? 1);
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(seedIfEmpty() ? 'Productos de ejemplo creados.' : 'Ya existen productos; no se cambió nada.');
}
