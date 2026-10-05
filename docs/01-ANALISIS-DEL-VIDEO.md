# Análisis del video ("2k a 10K x Día — Tiempo real")

> Analicé el video cuadro por cuadro (1 imagen cada 6 segundos, 4 min 54 s). El audio no se pudo transcribir
> porque el entorno no tenía acceso a modelos de voz, así que todo lo de abajo sale de lo que **se ve en pantalla**.

## Qué muestra

| Momento | Qué se ve | Qué significa |
|---|---|---|
| 0:00–0:12 | Escritorio lleno de **guías/tickets impresos con código QR** | Guías de envío (etiquetas Shalom) de pedidos del día. |
| 0:12–0:36 | **Alibaba**: "Aire acondicionado / calefactor mural frío-calor con control remoto" a **S/43.27 (2–8 u.), S/33.50 (9–999), S/27.39 (1,000–9,999), S/21.68 (≥10,000)** | El producto se compra en China a S/22–43 la unidad (sin flete ni impuestos). |
| 0:36–0:48 | **Meta Ads Manager**: conjunto "Nuevo conjunto de anuncios de Ventas", **449 conversaciones**, **S/0.49 por conversación**, **S/217.98 gastados**, público estimado 10.9–12.8 millones | Anuncios de "Mensajes" (clic a WhatsApp). Costo por chat muy bajo. |
| 0:48–1:12 | Segmentación: **Perú** pero **excluye Lima (+40 km) e Iquitos (+80 km)** | Vende un **calefactor** solo a provincias frías (sierra: Puno, Cusco, Arequipa, Junín, etc.). Excluye Lima e Iquitos porque no hace frío. |
| 1:12–1:24 | CRM con canales **WhatsApp, Instagram, Facebook, Telegram**; carpetas "Todas 540, Ventas 23, No atendidas 40, Recordatorios, Pedidos"; saldo en US$ | Por la URL (`…/dashboard/conversations`), el saldo en US$ y el menú, parece ser **YaVendió** (yavendio.com): CRM con bot IA que cobra por uso y tiene integración con Shalom. |
| 1:24–1:36 | WhatsApp Web con muchos chats: "Gracias por contactarnos 😊 ¿En qué puedo ayudarte?", "¡Hola! Solo queríamos recordarte que tu pedido…" | Bot que responde al instante + mensajes de **recordatorio** automáticos. |
| 1:36–2:06 | Panel con pedidos "Aire acondicionado / calefactor frío-calor", estados **Registrado → Caja preparada → Agencia Shalom → Finalizado**, botones **VER GUÍA · VER CLAVE · RASTREAR · IMPRIMIR ETIQUETA**, códigos tipo `98414652 / T3MM` | Sistema propio ("X DROP v4.11 SUPERADMIN") conectado a Shalom: genera la guía, imprime etiqueta, rastrea y **controla la clave de recojo**. |
| 2:06–2:12 | Tabla con **DNI, cliente, teléfono, destino**, búsqueda "por DNI, cliente, pedido o vendedor" | Para cada pedido se toma el DNI (obligatorio para Shalom). |
| 2:12–3:48 | Habla a cámara | (audio no disponible) |
| 4:00–4:54 | **Supermercado "Mio"**: el mismo calefactor mural a **S/129.00** | Prueba de precio: en tienda física se vende a S/129 lo que en China cuesta ~S/25–35. |

## El modelo que usa (resumido)

1. **Producto**: calefactor mural "frío-calor" importado de China (costo ~S/25–43 + flete/impuestos).
2. **Tráfico**: anuncios de Meta (y TikTok Ads) que abren chat de WhatsApp, segmentados a provincias frías.
3. **Atención**: bot IA en YaVendió responde y toma datos; recordatorios automáticos.
4. **Logística**: envío por **agencia Shalom**. El vendedor genera la guía y **se queda con la clave de recojo**.
5. **Cobro**: el cliente paga (adelanto y/o saldo por Yape) y recién ahí recibe la clave para retirar el paquete
   (por eso el botón "VER CLAVE"). Así se evita el riesgo del contraentrega "puro".
6. **Escala**: "2k a 10k por día" = S/2,000–10,000 de **facturación** diaria (no utilidad).

## Lo que hay que tener en cuenta

- **Facturación ≠ ganancia.** Con S/218 de anuncios obtuvo 449 chats; si cierra 10–15 % son ~45–65 ventas.
  A S/129 son ~S/6–8 mil de venta, pero hay que restar producto, envío, devoluciones y comisiones.
- **El producto es de temporada.** Un calefactor vende de **mayo a agosto** en la sierra. Hoy (octubre) entramos
  a verano, así que **copiar ese mismo producto ahora sería entrar tarde**. Ver el plan de negocio para el producto de verano.
- **"Frío-calor" es engañoso**: estos equipos calientan con resistencia y en modo "frío" solo ventilan. Venderlo
  como aire acondicionado genera reclamos y devoluciones. En nuestra ficha lo decimos claro.
- **El CRM que usa (YaVendió) se puede reemplazar** por el que está en este repositorio: hace lo mismo
  (bandeja omnicanal, bot IA, pedidos, guías Shalom, clave de recojo) sin pagar mensualidad por el CRM.
