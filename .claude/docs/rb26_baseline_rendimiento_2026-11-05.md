# RB-26 - Linea base de rendimiento en red lenta (produccion, paginas publicas)

Fecha de medicion: 2026-11-05 (00:00-00:25 -03). Objetivo: https://papuenvios.vercel.app (build `index-CJowPkQl.js`, commit desplegado no verificado; HEAD del repo = 8e46e97d).
Metodo: Playwright + Chromium headless (node_modules del checkout principal), CDP `Network.emulateNetworkConditions` (400 kbps down/up, 400 ms RTT) + `Emulation.setCPUThrottlingRate` 4x. Cache fria = contexto nuevo; cache caliente = segunda carga en el mismo contexto (cache HTTP real activa). Movil 375x667 DPR2 (UA Pixel 5) y escritorio 1280x800. Metricas con PerformanceObserver (paint, LCP, layout-shift sin input, longtask). TBT aproximado = suma de (duracion-50ms) de long tasks posteriores al FCP hasta que la red queda quieta (cap 45 s tras `load`).
Solo lectura: unicamente GET/HEAD/OPTIONS (preflight del navegador) a produccion. Filtro CDP `Fetch` que aborta cualquier otro metodo hacia `*.supabase.co`; unica excepcion deliberada: 2 RPC `POST` que son SELECT puro verificados en `supabase/migrations` (`get_public_landing_stats`, `get_testimonial_author_profiles`; ambas `LANGUAGE sql`, solo `SELECT`). 0 peticiones bloqueadas en todas las corridas de rendimiento (la app no intento ninguna escritura; `trackPageVisit` esta tras el opt-in de analitica). Sin login, sin cookies de sesion. Nota de transparencia: la captura de fixtures para RB-04 (`capture-fixtures.mjs`, GET de `/`, `/products`, `/blog`, `/remittances`) se ejecuto sin ese filtro; luego se repitio la misma navegacion con el filtro (`prod-guarded-check.mjs`) y no hubo ningun intento no-GET. Tambien se hicieron GET completos de imagenes publicas de Storage (`catalog_imgs.py`, `imginfo.py`) para medir su peso real.

Datos crudos: `/tmp/claude-1000/-home-juan-Workspace-papuenvios/336dfa85-b0ad-4837-bfcd-48871f088179/scratchpad/baseline/perf/*.json` (una corrida por combinacion) y `perf_rep2/`, `perf_rep3/` (2 repeticiones extra de movil/home). Tabla completa auto-generada: `.../baseline/perf_summary.md`. Capturas de la pagina final: `.../baseline/perf/*.png`.

## Advertencias de fiabilidad (leer antes de usar los numeros)

- **Host con carga alta**: `uptime` marco load average ~50 sobre 16 cores y 11/14 GB de RAM usados durante la medicion (otros agentes trabajando). El CPU 4x de CDP es un multiplicador relativo; con el host saturado el tiempo de evaluacion de JS y por tanto FCP/TBT tienen mucho ruido. Evidencia: movil/home en frio dio FCP 16.0 / 18.7 / 22.2 s y LCP 37.9 / 30.6 / 52.8 s en 3 repeticiones. **Tomar rangos, no cifras exactas.** El ancho de banda (descarga de 430 KB de JS = 8-10 s) es determinista y es la parte fiable.
- Una sola corrida por combinacion para el resto de paginas (3 para movil/home).
- Corte de 45 s: en `/products` en frio 66 de 68 imagenes seguian en vuelo al cerrar la medicion, asi que sus bytes NO estan en la columna "transferido" (se midieron aparte, ver hallazgo 4).
- Los OPTIONS de CORS se ven en CDP con duraciones de 1-3 ms: el throttling no los penaliza, por lo que su coste real en 3G NO esta medido (ver hallazgo 9).

## Resultados (Slow 3G 400 kbps / 400 ms RTT, CPU 4x)

| vp | pagina | cache | FCP ms | LCP ms | CLS | TBT ms | requests | KB transferidos | header visible (fin splash) ms | elemento LCP |
|---|---|---|---|---|---|---|---|---|---|---|
| movil | home | fria | 15980 (rep: 18672, 22212) | 37884 (rep: 30616, 52796) | 0.008 | 7877 (rep: 256, 15862) | 47 | 1104 | 22242 | div hero (background-image CSS) |
| movil | home | caliente | 3580 (rep: 4012, 4536) | 8632 (rep: 10336, 21416) | 0.004 | 5886 | 29 | 33 (rep3: 631 - las imagenes se re-descargaron) | 4686 | div hero |
| movil | products | fria | 16064 | 18068 | 0.001 | 17177 | 99 | 577 (+ ~66 imgs sin terminar) | 19012 | banner de cookies (`p`) |
| movil | products | caliente | 10136 | 10848 | 0.000 | 9310 | 86 | 205 | 12958 | banner de cookies |
| movil | blog | fria | 19640 | 19640 | 0.005 | 750 | 34 | 741 | 21924 | banner de cookies |
| movil | blog | caliente | 6100 | 6100 | 0.000 | 651 | 20 | 27 | 8599 | banner de cookies |
| movil | login | fria | 25244 | 25244 | 0.000 | 900 | 31 | 558 | 27293 | banner de cookies |
| movil | login | caliente | 1216 | 1216 | 0.000 | 778 | 18 | 26 | 4701 | banner de cookies |
| escritorio | home | fria | 11632 | 29016 | 0.002 | 3784 | 47 | 1103 | 14898 | div hero |
| escritorio | home | caliente | 3952 | 8184 | 0.000 | 2307 | 29 | 33 | 5601 | div hero |
| escritorio | products | fria | 23652 | 23652 | 0.080 | 10804 | 99 | 577 | 26448 | banner de cookies |
| escritorio | products | caliente | 5236 | 5236 | 0.000 | 5481 | 86 | 71 | 7290 | banner de cookies |
| escritorio | blog | fria | 19648 | 22444 | 0.031 | 4266 | 34 | 741 | 23845 | banner de cookies |
| escritorio | blog | caliente | 1144 | 1144 | 0.000 | 1158 | 20 | 27 | 5202 | banner de cookies |
| escritorio | login | fria | 14856 | 16600 | 0.030 | 3081 | 22 | 558 | 18616 | banner de cookies |
| escritorio | login | caliente | 1216 | 1216 | 0.000 | 523 | 18 | 26 | 4397 | banner de cookies |

Lectura: el FCP (que es el splash pintado por JS) llega a los 11-25 s en frio porque el HTML de 498 bytes esta vacio (`<div id="root">`) y nada pinta hasta descargar 430 KB de JS (termina a ~10-11 s) y evaluarlo (long tasks de 1.2 s a 7.9 s medidos). El LCP real de la home (imagen hero) llega a los 30-53 s. CLS es bueno salvo `/products` escritorio (0.080, cerca del limite 0.1: salto de lista vacia a grilla).

### Desglose por origen (cache fria, nº de requests / KB transferidos)

| pagina | HTML | JS | CSS | fuentes | Supabase REST | Supabase Storage imagenes | otras imagenes (ui-avatars / Google) | preflights OPTIONS | total |
|---|---|---|---|---|---|---|---|---|---|
| home | 1 / 1 | 1 / 420 | 1 / 14 | 4 / 95 | 18 / 33 | 3 / 532 | 3 / 8 | 16 | 47 |
| products | 1 / 1 | 1 / 420 | 1 / 14 | 4 / 95 | 12 / 28 | 68 / 19* | 0 | 12 | 99 |
| blog | 1 / 1 | 1 / 420 | 1 / 14 | 4 / 95 | 13 / 29 | 1 / 182 | 0 | 13 | 34 |
| login | 1 / 1 | 1 / 420 | 1 / 14 | 4 / 95 | 12 / 28 | 0 | 0 | 12 | 31 |

(*) solo 1 de 68 imagenes termino dentro de la ventana; el peso real del catalogo es 7.45 MB (hallazgo 4). Supabase Auth: 0 requests (sin sesion). Sin Service Worker (`navigator.serviceWorker.getRegistrations()` = 0, sin `<link rel=manifest>`, `/sw.js` y `/manifest.webmanifest` devuelven el index.html con 200).

### Bundle inicial y chunks lazy

- `index-CJowPkQl.js`: 1,453,677 B crudos / **429,598 B en red** (`content-encoding: br` servido por Vercel; con Brotli q11 local seria 338,621 B, gzip -9 = 423,443 B). Un unico bundle con TODAS las paginas publicas y de usuario importadas de forma estatica en `src/App.jsx` (Home, Products, ProductDetail, Remittances, SendRemittance, MyRemittances, MyRecipients, Cart, Login, UserPanel, Blog, Privacy, Terms) mas supabase-js, framer-motion (63 archivos lo importan), radix, lucide.
- `index-Dy1allcE.css`: 90,047 B crudos / 14,719 B br. Bloquea el render pero es pequeno.
- Chunks lazy (solo admin, `React.lazy` en App.jsx:28-31): DashboardPage 206 KB crudo / 45 KB br; AdminPage 87 KB / 22.5 KB; SettingsPage 235 KB / 54.7 KB; UserManagement 46 KB / 12 KB. Funcionan bien: el usuario publico no los descarga.
- Fuentes: 4 pesos de Inter (`@fontsource/inter`, woff2 latin) 23-24 KB cada uno = 95 KB, solicitadas recien tras el primer render (a los ~12.8 s).

### Cache-Control (verificado con `curl -I` y en las respuestas capturadas)

| recurso | Cache-Control |
|---|---|
| `/` y `/<ruta>` (index.html) | `public, max-age=0, must-revalidate` (correcto para HTML) |
| `/assets/index-CJowPkQl.js` (con hash) | `public, max-age=0, must-revalidate` **(deberia ser immutable)** |
| `/assets/index-Dy1allcE.css` (con hash) | idem |
| `/assets/inter-*.woff2` (con hash) | idem |
| `/favicon.svg` | idem |
| imagenes de Supabase Storage | `public, max-age=3600` (1 h) |
| ui-avatars.com | `public, max-age=31536000` |
| REST de Supabase | sin Cache-Control |

Efecto medido en cache caliente: el JS y el CSS vuelven a pedirse y reciben `304` (jsEnd ~1.0-1.2 s, es decir 1 RTT completo + el trabajo en serie), y las 4 fuentes tambien revalidan. Con `immutable` se evitarian esas idas y vueltas.

### Imagenes (peso, formato, dimensiones vs mostrado)

| imagen | peso | formato | natural | mostrado | notas |
|---|---|---|---|---|---|
| hero carrusel `b87b3dde...jpg` | 215 KB | JPEG | 1066x600 | 100% ancho, ~375x300 movil | background-image CSS, no `<img>`; cache 1 h |
| cover publicacion `cover_...2u2t60.jpg` | 186 KB | JPEG | 800x800 | 277x144 movil / 377x144 esc. (x2.1-2.9 de ancho; recorte con object-cover) | `loading=auto`, sin width/height |
| 2º hero `1793802900347-bbiwtp.jpg` | 142 KB | JPEG | 1070x602 | idem hero | se descarga aunque no se vea (carrusel) |
| catalogo (68 imgs) | **7.45 MB total, media 110 KB, max 185 KB** | 68/68 JPEG (0 WebP/AVIF) | casi todas 800x800 (algunas 447x447) | 276-298 px | `loading` por defecto (eager), sin `width/height`, sin `srcset`, sin `fetchpriority` |

Medido con GET completos y sin throttling (script `catalog_imgs.py`). A 50 KB/s la descarga completa del catalogo tardaria ~150 s.

### Peticiones duplicadas y cascadas (Supabase, cache fria)

Duplicadas en la home: `testimonials?select=*&order=created_at.desc&is_visible=eq.true` x2, `rpc/get_testimonial_author_profiles` x2, `carousel_slides` x2 (con y sin `is_active=eq.true`), `exchange_rates` con dos patrones distintos, avatar de Google `.../a/ACg8oc...=s96-c` x2. En `/login`, `/blog` y `/products` la app dispara el mismo juego de 12 consultas (products, inventory, combo_products, combo_items, product_categories, testimonials, carousel_slides, currencies, exchange_rates, business_visual_settings...) aunque la pagina no use el catalogo.

Cascada (movil/home, rep 1, tiempos en ms desde la navegacion):
1. 0-10721: HTML + JS 430 KB (JS termina a 10.7 s).
2. 14512-17636: oleada 1 (providers): `exchange_rates`, `business_visual_settings`, `products`, `inventory`, `combo_products`, `combo_items` (6 GET en ~3 s; primera de 754 ms por DNS+TLS al origen Supabase sin `preconnect`).
3. **24691-26842: oleada 2, ~8 s despues**, solo cuando el splash se desmonta y monta `HomePage`: `product_categories`, `testimonials`, `carousel_slides`, `currencies`, `rpc/get_public_landing_stats`, `testimonials` (dup), `carousel_slides` (dup), `publications`, `offers`, `rpc/get_testimonial_author_profiles` x2, `exchange_rates`.
4. 26459-35799: la imagen hero (215 KB) solo se descubre tras la respuesta de `carousel_slides` (es un `background-image` inline en HomePage.jsx:306) y tarda 9.3 s en bajar compitiendo con la cover de 186 KB (8.4 s) y el 2º hero (4.8 s). LCP = 37.9 s.

## Los 10 mayores problemas, ordenados por impacto/esfuerzo (sin implementar)

| # | Problema | Evidencia | Arreglo propuesto | Esfuerzo | Impacto esperado |
|---|---|---|---|---|---|
| 1 | **Assets con hash sin cache inmutable** | `index-CJowPkQl.js`, `index-Dy1allcE.css`, `inter-*.woff2`: `Cache-Control: public, max-age=0, must-revalidate`. En cache caliente el JS/CSS hacen 304 (jsEnd 1.0-1.2 s) y las fuentes revalidan. `vercel.json` solo tiene `rewrites`. | En `vercel.json` anadir `headers` para `source: "/assets/(.*)"` -> `Cache-Control: public, max-age=31536000, immutable`. | XS (5 lineas) | Visitas repetidas: elimina ~6 revalidaciones (1 RTT = 0.4-1 s c/u en serie parcial) y hace que el repeat view sea instantaneo. No cambia la 1ª visita. |
| 2 | **Splash artificial de 2.5 s en cada carga** | `src/App.jsx:152` `setTimeout(() => setIsLoading(false), 2500)` incondicional; `LoadingScreen` fixed z-50 tapa la app; ademas `AnimatePresence mode="wait"` (salida 0.5 s) y transicion de pagina `mode="wait"` (0.3+0.3 s). Con cache caliente el header recien aparece a 4.4-5.6 s aunque los scripts terminan a ~1 s. | Quitar el timer fijo: mostrar el splash solo mientras `auth/visualSettings` no esten resueltos (o eliminarlo), y reducir/omitir exit animations. | XS | -2.5 s en toda carga (fria y caliente); la oleada 2 de Supabase (hallazgo 7) arranca 2.5 s antes. |
| 3 | **HTML vacio: nada pinta hasta bajar y evaluar 430 KB de JS** | `index.html` = 498 B, `<div id="root"></div>`; FCP 11.6-25.2 s en frio; JS termina de bajar a ~10 s y su evaluacion genera long tasks de 1.2-7.9 s (CPU 4x). Sin `preconnect` a `qcwnlbpultscerwdnzbm.supabase.co` (1ª peticion REST 754 ms vs ~470 ms las siguientes). `lang="en"` en un sitio ES/EN, sin `<meta description>` ni `<noscript>` en el HTML estatico. | Inyectar en `#root` un shell estatico (marca + skeleton, CSS inline) para FCP < 2 s; `<link rel="preconnect" href="https://qcwnlbpultscerwdnzbm.supabase.co" crossorigin>`; `<link rel="preload" as="font" type="font/woff2" crossorigin>` de los 2 pesos criticos; `<link rel="modulepreload">` del bundle; ajustar `lang`/meta. | S | FCP percibido de ~16-22 s a ~1.5-3 s; -1 RTT+TLS en la primera consulta. |
| 4 | **Catalogo: 68 imagenes JPEG 800x800 eager, 7.45 MB** | `/products` en frio: 99 requests, 68 `<img>` sin `loading="lazy"` ni `width/height` (`ProductsPage.jsx:431,566,572`), media 110 KB c/u, mostradas a 276-298 px; solo 1 de 68 terminaba en 45 s. 1,538-1,563 nodos DOM. CLS 0.080 en escritorio. | `loading="lazy" decoding="async" width height` en las tarjetas; servir miniaturas (Supabase Storage image transformation `/render/image/public/...?width=400&quality=70&format=webp`, o generar thumbnails 400px WebP al subir); `srcset/sizes`. Paginar o virtualizar (grilla con `content-visibility:auto`). | S | De 7.45 MB a ~0.8-1.2 MB (primeras 8-12 imgs visibles ~15-25 KB c/u), 68 -> ~12 requests iniciales; cae el TBT de 17 s en movil. |
| 5 | **Hero (LCP) descubierto tarde y pesado** | `HomePage.jsx:306` `style={{backgroundImage: url(...)}}` dentro de un `AnimatePresence`; la URL solo se conoce tras `carousel_slides` (26.3 s) y la imagen (215 KB JPEG 1066x600) acaba a 35.8 s -> LCP 30-53 s. Se descargan los 3 heroes/cover aunque solo se vea uno (186 KB cover 800x800 mostrada a 277x144). Cache de imagenes solo 1 h. | Renderizar el 1er slide como `<img fetchpriority="high" width height srcset>` (WebP/AVIF, ~640w ~40 KB); cargar los demas slides en idle; guardar la ultima lista de slides en localStorage para pedirla antes; recortar la cover al ratio mostrado; subir cache de imagenes con nombre versionado a 1 año. | S-M | LCP home de 30-50 s a ~12-15 s (limitado por el JS); -300 KB de imagenes en la primera vista. |
| 6 | **Bundle unico de 1.45 MB (430 KB br) con todas las rutas publicas y de usuario en el chunk inicial** | `src/App.jsx:9-24` imports estaticos de 13 paginas; solo 4 paginas admin son lazy. Evaluacion del bundle = long task 1.2-7.9 s a CPU 4x; TBT 3.8-17 s. Vercel sirve Brotli de nivel bajo (430 KB vs 339 KB con q11). | `React.lazy` por ruta para Cart, SendRemittance, MyRemittances, MyRecipients, UserPanel, Blog, Privacy, Terms, ProductDetail (dejar Home/Products/Login en el inicial) + `manualChunks` para vendor (react, supabase, framer-motion); precomprimir con Brotli q11 en el build; evaluar `LazyMotion`/`m` para framer-motion (63 archivos lo importan; ahorro a medir). Higiene de `package.json`: `pg`, `dotenv`, `@supabase/auth-ui-*`, `react-hot-toast`, `react-helmet` figuran en `dependencies` sin ningun import en `src/` y `react-router-dom` solo lo importan 5 formularios huerfanos (LoginForm, RegisterForm, ForgotPasswordForm, ResetPasswordForm, EmailVerificationPending: nadie los importa) - no pesan en el bundle (tree-shaking) pero ensucian el grafo. | M | Estimado -25-40% del JS inicial (a confirmar con un analisis de bundle; ver nota al final) = -2.5-4 s de descarga en Slow 3G y menos TBT. |
| 7 | **Providers globales cargan todo en cada ruta, en 2 oleadas serie** | `/login` y `/blog` disparan las mismas 12 consultas de catalogo/home que `/products` (28-33 KB, 12-18 REST). Oleada 2 (`HomePage` fetch-on-mount) arranca ~8 s despues de la oleada 1 (14.5 s -> 24.7 s). | Cargar datos por ruta; lanzar en paralelo y en cuanto haya JS (no esperar al desmontaje del splash); diferir testimonios/publicaciones/ofertas a idle o a `IntersectionObserver`; cache en memoria + `stale-while-revalidate` (p. ej. react-query/SWR) para no repetir al navegar. | M | Home: datos utiles ~8-10 s antes en 3G; login/blog sin 12 peticiones inutiles. |
| 8 | **Peticiones duplicadas** | Home: `testimonials` x2, `rpc/get_testimonial_author_profiles` x2 (x3 en warm), `carousel_slides` x2 con filtros distintos, `exchange_rates` x2, avatar Google x2; `ProductContext.jsx:256,270` y `HomePage` cargan lo mismo. | Fuente unica en contexto (ProductContext) y consumirla desde HomePage; deduplicar en vuelo (map de promesas por clave). | S | -5 a -6 requests y sus preflights en la home. |
| 9 | **Un preflight CORS por URL distinta de PostgREST** | CDP registra 12-16 `OPTIONS` por pagina (uno por cada URL/query distinta: cabeceras `apikey`/`authorization` fuerzan preflight y Chromium cachea por URL). No se pueden valorar en ms con este metodo (CDP los reporta en 1-3 ms sin throttling), pero en un movil real cada uno cuesta 1 RTT antes del GET. | Reducir numero de URLs distintas: una RPC "bootstrap" (productos+categorias+combos+rates) por pantalla, como ya se hizo con `get_public_landing_stats`; o proxy mismo-origen via rewrite de Vercel. | M | Hasta -12 RTT acumulados en paralelo parcial (a validar en dispositivo real). |
| 10 | **Fuentes y terceros: 4 pesos de Inter + avatares externos tardios** | 4 woff2 (95 KB) pedidos recien tras el primer render (12.8 s) y sin preload; 2 de ellos (500/600) casi no se justifican; avatares de `ui-avatars.com` (3 requests) y Google (`.../a/ACg8oc...=s96-c`, x2, avatar de testimonio) en la home; cookie-banner es el elemento LCP en blog/login/products (el texto pinta antes que el contenido). | Reducir a 2 pesos (400/700) o fuente variable subset; `preload` de los criticos; (`font-display: swap` ya esta aplicado en los 4 @font-face); avatares propios con tamaño fijo/iniciales CSS en lugar de `ui-avatars.com`; que el banner no sea el LCP (altura fija, mas corto, o montarlo despues de `load`). | XS-S | -45-50 KB y FOUT menor; elimina 5 requests de terceros. |

Menciones adicionales (fuera del top 10, sin medir en profundidad):
- `GET /robots.txt` y `/sitemap.xml` devuelven el `index.html` (200, text/html): los crawlers reciben HTML como robots/sitemap (SEO).
- No hay Service Worker ni manifest: sin cache offline ni PWA instalable; para este publico (conexiones lentas en Cuba/EEUU) un SW con `stale-while-revalidate` para el catalogo y precache del shell seria el siguiente salto, pero requiere cuidado con datos reales de produccion (invalidar versiones).
- Imagenes de Storage con cache de solo 1 h: en cache caliente de movil/home rep 3 se re-descargaron 530 KB.

## Que NO pude medir

- Paginas autenticadas (login real, carrito, remesas, dashboard): fuera de alcance por la regla de no autenticarse.
- Coste en ms de los preflights OPTIONS en red real (CDP no los throttlea).
- INP/TTI reales, comportamiento en un dispositivo fisico de gama baja, y radio 3G real (jitter/perdida/handshake TLS).
- Contribucion por modulo dentro del bundle de 1.45 MB sin source maps de produccion (solo estimaciones por conteo de cadenas y por tamano de chunks lazy). Pendiente opcional: `vite build` con un plugin de analisis sobre la copia de HEAD.
- Tiempo de respuesta del servidor Supabase en carga (solo se ve como parte del RTT emulado).
- Variacion entre corridas por carga alta del host (ver advertencias): una sola corrida por combinacion excepto movil/home (3).
