# Auditoría de egress Supabase — 2026-11-05

Contexto: plan Free, panel de Usage 4,97 / 5 GB de egress; el ciclo reinicia el 09-nov-2026. Al pasar de 5 GB, Supabase aplica restricciones (402 en la API) y el sitio cae.

Método, todo de solo lectura:
- `query_logs` sobre `edge_logs`. La retención alcanza desde el 09-oct, o sea el ciclo entero.
- `SELECT` sobre `storage.objects`, `storage.buckets` y tablas públicas.
- `curl` con HEAD, y GET de 1 byte (`Range: bytes=0-0`) sobre 4 URLs públicas.
- Lectura de `src/`.

Las edge logs **no traen los bytes de respuesta** (lo confirma la doc de Supabase). Los bytes se estiman así: nº de peticiones × tamaño real del objeto o del JSON, este último medido con `octet_length(json_agg(...))` replicando la misma proyección.

## 1. Conclusión primero: la causa principal NO son las imágenes

| Consumidor (ciclo 09-oct → 05-nov) | Evidencia | Egress estimado | Cuota |
|---|---|---|---|
| **Polling del Dashboard admin** (`DashboardPage`: `fetchStats` + `fetchVisitStats` cada 30 s, en 1-2 pestañas abiertas 24/7 del 22-oct al 02-nov) | `GET /rest/v1/order_items` (1 por ciclo): 900 el 22-oct; 5.809, 5.776, 5.760, 5.776, 4.848, 3.022, 2.911, 2.911, 2.888 y 2.341 del 23-oct al 01-nov; 347 el 02-nov. **≈ 43.300 ciclos.** Cada ciclo pide 9 listados completos (`order_items` 31,9 kB, `orders` 11,7 kB, `remittances` 10,7 kB, `zelle_transaction_history` 11,5 kB, `admin_list_product_costs` ≈ 9 kB, `admin_list_combo_costs`, `order/remittance_courier_costs`, `v_effective_courier_cost` 3,7 kB…) ≈ **80 kB** de JSON más unos 7 HEAD de recuento a `site_visits` (hasta 40.270 peticiones/día) | **≈ 3,5 GB** de JSON + ≈ 0,3 GB de cabeceras | sin caché (Database) |
| **Catálogo con base64 antes del 16-oct** (`products?select=*` devolvía `image_file`, 7 MB) | peticiones `products` "pesadas" por día: 39 el 09-oct, 72 el 12-oct, 26 el 14-oct, 0 desde el 17-oct (fix `b87b9cee` / `6cbde247`) | **≈ 1-2 GB** (≈ 40/día × 7 MB × 6-7 días) | sin caché (Database) |
| Imágenes públicas de Storage | GET 200 por día: 18 (09-oct), 214 (18-oct), 1.597 (22-oct), 495 (23-oct), 73-286 en el resto, 1.500 (04→05-nov). Media ≈ 128 kB | ≈ 0,7-0,9 GB en el ciclo | **mayormente cacheado** (`cf-cache-status: HIT`, cuota *Cached Egress* aparte) |
| Resto de REST, auth y realtime | p. ej. hoy: `admin_refund_counts` 2.776, `get_pending_orders_count` 2.695, `HEAD remittances` 2.694 (Header, cada 30 s), `exchange_rates` 2.779, `auth/token` 1.299, websocket 196 | ≈ 30 MB/día suponiendo ~1 kB por petición (supuesto, no medido) | sin caché |

Suma sin caché: 3,8 + 1,5 + ~0,4 ≈ **5,5 GB**, del orden de los 4,97 GB del panel. **Lo que agota la cuota es el polling del Dashboard admin.** El base64 legado contribuyó, pero ya está corregido. Las imágenes van, en su mayor parte, contra la cuota *Cached Egress*, que es independiente (doc de Supabase: "Cached and uncached egress have independent quotas"; Free = 5 GB / 5 GB).

Corrección aplicada en esta rama, antes de B-E:
- Los ticks de polling se saltan con la pestaña oculta (`document.hidden`), vía `skipWhileRefreshBlocked`, que ya usan todos los pollers.
- El intervalo del Dashboard pasa de 30 s a 5 min. Pedidos y remesas ya refrescan por realtime; `site_visits` no está en la publicación realtime y es la única razón del poll.

## 2. Cabeceras actuales de imágenes (GET de 1 byte y HEAD)

| URL (bucket `product-images`) | Content-Length | Content-Type | Cache-Control (GET) | CDN |
|---|---|---|---|---|
| `migrated/products/67689da0….jpg` | 97.815 | image/jpeg | `public, max-age=3600` | HIT |
| `migrated/products/e2fc15a3….jpg` | 107.052 | image/jpeg | (HEAD) `private, no-cache` | DYNAMIC |
| `carousel/b8a12f47…/1793802900347-bbiwtp.jpg` | 141.878 | image/jpeg | (HEAD) `private, no-cache` | DYNAMIC |
| `carousel/f19c0266…/1793102849758-nmwx3c.jpg` | 134.829 | image/jpeg | (HEAD) `private, no-cache` | DYNAMIC |

- Las respuestas HEAD dicen `private, no-cache` y `DYNAMIC`. El GET real devuelve `public, max-age=3600` con `HIT`. Lo que vale para el navegador es el GET.
- `storage.objects.metadata.cacheControl` = `max-age=3600` en **todos** los buckets: el código sube con `cacheControl: '3600'`.
- Por eso un visitante que vuelve pasada 1 h revalida (304, sin cuerpo: 1.120 hoy) o vuelve a bajar la imagen. Con 1 año y nombres únicos esto desaparece.

## 3. Inventario de Storage (metadatos, sin descargar nada)

| Bucket | Objetos | MB | Máx. | Público | MIME permitidos |
|---|---|---|---|---|---|
| order-documents | 123 | 28,7 | 2,9 MB | no | jpeg, png, webp |
| product-images | 114 | 15,0 | 480 kB | sí | jpeg, jpg, png, svg (**sin webp**) |
| remittance-proofs | 35 | 15,0 | 3,8 MB | no | jpeg, png, jpg, webp, pdf |
| order-delivery-proofs | 41 | 5,3 | 1,9 MB | no | (todos) |
| remittance-delivery-proofs | 11 | 1,6 | 221 kB | no | (todos) |
| publications | 1 | 0,18 | 186 kB | sí | jpeg, png, webp, gif |

- **`product-images` rechaza `image/webp`.** Para subir WebP ahí hace falta una migración aditiva, que se deja preparada y SIN aplicar. Mientras tanto, la app sigue subiendo JPEG a ese bucket.
- Hoy, el 81 % de los bytes de imagen servidos (136,9 de 168,7 MB) son objetos legados `migrated/*`. B no los toca; solo C (lazy) y D (script) los reducen.
- Comprobantes: hoy hay 12 `object/sign` y 2 descargas. Su egress es despreciable frente al resto.

## 4. Puntos de código que descargan datos pesados

- **Polling**:
  - `DashboardPage.jsx` (30 s → corregido a 5 min, y nada con la pestaña oculta).
  - `Header.jsx` badge (30 s, 3 llamadas): sin guard hasta esta rama.
  - `usePendingRemittances` / `useRefundQueue` (30 s), `useRefundCounts` (60 s), `ZelleAccountSelector` (30 s), `SettingsCouriersTab` (reintento).
  - `CurrencyContext` (`exchange_rates` cada 5 min; 2.779 GET/día de filas de ~100 B).
- **Realtime**: `useRealtimeOrders` / `useRealtimeRemittances` disparan `fetchStats` completo por evento. Hay 196 conexiones websocket/día; los bytes de realtime no aparecen en las logs.
- **Proyecciones `select('*')`** de tablas pequeñas: `testimonials` 296/día, `carousel_slides` 192/día, `publications` 157/día, `remittances … remittance_types(*)` 186/día. Todas suman < 1 MB/día.
- `business_visual_settings?select=settings`: 270/día × 3,4 kB ≈ 0,9 MB/día.
- **Imágenes sin `loading="lazy"`**:
  - El catálogo (`ProductsPage`) renderiza 59 productos + 9 combos con `<img>` eager: cada visita baja **68 imágenes = 7,28 MB**.
  - Lo mismo en BlogPage, publicaciones de Home, miniaturas de Ajustes y avatares.
- **Comprobantes en listados admin**: `AdminRemittancesTab` y `OrderDetailsModal` solo firman y pintan el comprobante dentro del detalle o modal abierto, no en la fila del listado. Esto está verificado leyendo el código; no hace falta cambio.

## 5. Estimación por visitante (pesos reales)

- Home: 1 cartel del carrusel (≈ 170 kB; solo se monta el activo) + portada de publicación (181 kB) ≈ **0,35 MB**.
- Catálogo `/products`: 68 imágenes ≈ **7,28 MB** (eager).
- Visitante típico (Home + catálogo) ≈ **7,6 MB** → **5 GB / 7,6 MB ≈ 670 visitas** sin caché del navegador. Esta cuenta va contra la cuota *Cached* si hay HIT en el CDN.
- Con lazy loading, el primer render pide solo las imágenes que caben en pantalla más el margen de Chromium (~1.250-2.500 px). Medido en el e2e de esta rama (`catalog-images.spec.js`), ver TRACKING_PROGRESS.
- Con WebP a ≤ 1200 px y q≈0,8 se espera un 25-50 % menos que el JPEG actual (supuesto). La razón real se medirá en el dry-run del script D, solo con metadatos.

## 6. Evaluación: Vercel delante de Storage (rewrite `/storage/*`) — NO implementado

Idea: añadir a `vercel.json` el rewrite `{ "source": "/storage/:path*", "destination": "https://qcwnlbpultscerwdnzbm.supabase.co/storage/v1/object/public/:path*" }`.

- **Caché.** Según la doc de Vercel ("rewrites"), los proyectos creados antes del 06-abr-2026 no cachean rewrites externos salvo que se añada `x-vercel-enable-rewrite-caching: 1`. Respetarían el `Cache-Control` de origen (`max-age=3600`); se puede forzar más con `CDN-Cache-Control` en `vercel.json`. No verificado si este proyecto es anterior o posterior a esa fecha.
- **Ganancia real.** El egress de Supabase pasaría a ser de 1 descarga por objeto y por región de Vercel cada TTL, en vez de 1 por visitante y hora. El tráfico sale de la cuota Fast Data Transfer de Vercel (Hobby: 100 GB/mes según su doc de precios). No verificado en el panel de esta cuenta.
- **Límites Hobby.** Hobby es para uso personal y no comercial según los términos de Vercel. Una tienda con ventas reales no encaja, así que habría que pasar a Pro (20 USD/mes). Por comparación, Supabase Pro (25 USD) da 250 GB / 250 GB y resuelve el problema de raíz. Este punto de términos debe confirmarlo el dueño.
- **URLs ya guardadas en BD.** `products.image_url` y `carousel_slides.image_url` apuntan a `*.supabase.co`, así que el rewrite solo ayuda si se reescriben en render (un mapper `toCdnUrl()`) o en BD (script D). Ninguna de las dos está hecha.
- **Riesgo.** Hay que cachear solo `object/public`, nunca `sign` ni `authenticated`, porque los comprobantes privados no deben pasar por una caché compartida.
- **Recomendación.** No ahora. Primero cortar el polling, que es la causa, y aplicar lazy + caché de 1 año. Reevaluar si las imágenes vuelven a acercarse a la cuota *Cached*.

## 7. Lo que NO pude verificar

- Qué medidor es el 4,97 GB: la doc dice que "Total Egress" incluye el cached. Hay que mirarlo en Usage → Egress vs Cached Egress.
- Bytes reales por respuesta: las logs no los traen, y no se sabe si se cuentan comprimidos con gzip o no. Los ~80 kB por ciclo del Dashboard son JSON sin comprimir.
- HIT/MISS del CDN por petición: no figura en edge_logs.
- Los días del ciclo no muestreados: 10, 11, 13, 15, 16, 19 y 20 de octubre, y 3 y 4 de noviembre. Las cifras de esos días están interpoladas.
- Bytes de realtime (websocket) y de las 426 respuestas 206 (rangos, 2 IPs).
- Si el proyecto Vercel es anterior al 06-abr-2026 (caché de rewrites) y los términos exactos de Hobby para esta cuenta.
