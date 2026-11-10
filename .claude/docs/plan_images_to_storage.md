# Plan y runbook: imágenes de catálogo a Supabase Storage

Rama: `feat/product-images-to-storage`. Nada de esto está desplegado ni aplicado.

## 1. Problema

`products.image_url` (69 filas), `combo_products.image_url` (16) y `carousel_slides.image_url` (6 con base64, 3 nulas) guardan data-URI base64 JPEG. `products.image_file` es una copia idéntica (ya no se lee desde la Fase 1 de rendimiento). El bucket `product-images` existe (público, tope 5 MB, mime `image/jpeg`, `image/jpg`, `image/png`, `image/svg`).

## 2. Qué cambia en el front (entregable A)

- Punto único: `resolveImageUrl()` en `src/lib/imageStorage.js`, llamado por los servicios justo antes de escribir:
  - `createProduct` / `updateProduct` (`productService.js`) -> carpeta `products/<id>/`
  - `createCombo` / `updateCombo` (`comboService.js`) -> `combos/<id>/`
  - `createCarouselSlide` / `updateCarouselSlide` (`carouselService.js`) -> `carousel/<id>/`
- Si el valor es data-URI o `File`/`Blob`: se redimensiona en el cliente (lado mayor máx. 1200 px, JPEG 0.82, baja la calidad hasta entrar en 5 MB), se sube con nombre único `<carpeta>/<id>/<timestamp>-<rand>.jpg` y se guarda SOLO la URL pública en `image_url`.
- Si ya es URL http(s) no se vuelve a subir. Valores vacíos pasan tal cual.
- Falla cerrado: si el redimensionado o la subida fallan se lanza `IMAGE_UPLOAD_FAILED` y NO se guarda el registro; nunca hay fallback a base64. Mensaje ES/EN (`images.uploadFailed|invalidImage|tooLarge` en `ES.json`/`EN.json`) en los formularios de inventario, combos y carrusel.
- Se dejó de escribir `image_file` (productos y carrusel). La columna no se toca.
- Helpers puros testeables: `src/lib/imageStoragePure.js`.
- Sin cambios en políticas de Storage: la subida usa la política existente `Authenticated Users Can Upload 16wiy3a_0`.

Auditoría de dónde se generaba el base64: `VendorInventoryTab` (preview del formulario vía `validateAndProcessImage` -> `productForm.image`), `VendorCombosTab` (`comboForm.image`), `SettingsPageVisual` (carrusel: `handleSlideImageUpload` -> `result.base64`). Los tres siguen produciendo el data-URI como preview; la conversión a URL ocurre en los servicios. `ProductsPage` ya subía a Storage (`setProductImageUrl`).

## 3. Función temporal de migración (entregable B)

Archivos (solo en el repo, SIN desplegar / SIN aplicar):

- `supabase/functions/migrate-product-images/index.ts` (Deno) y `logic.js` (lógica pura, probada con vitest).
- `supabase/migrations/20261015100000_image_migration_backup.sql`: tabla `public._bak_image_migration_20261015` (RLS activo, sin grants a anon/authenticated, solo `service_role`) y función `public._migrate_image_row(...)` (solo `service_role`) que en UNA transacción bloquea la fila, verifica que `image_url` siga siendo el mismo data-URI (sha256 del string), copia el original al respaldo y actualiza `image_url`. Devuelve `false` (sin cambios) si la fila fue editada mientras tanto.

Comportamiento de la función:

- `POST` con header `x-migration-token`. Cuerpo JSON opcional: `{ "dry_run": false, "limit": 5, "tables": ["products"] }`.
- `dry_run` es `true` por defecto; solo `dry_run: false` explícito escribe. `limit` por defecto 5, máximo 20.
- Kill switch: si no existe la fila `system_config.key = 'image_migration_token_sha256'` responde 410. El token válido es aquel cuyo sha256 coincide con `value_text` de esa fila (esquema verificado en `20241001000000_complete_schema.sql`: `key`, `value_text`, `value_numeric`, `value_boolean`, `value_json`, `is_public`, con `one_value_type` que exige exactamente un valor).
- Por fila con `image_url LIKE 'data:image/%'`: decodifica, calcula sha256, sube con service role a `product-images/migrated/<tabla>/<id>.jpg` (`upsert: false`). Si ya existe con el mismo sha256 lo reutiliza; si difiere cuenta como `failed` (nunca sobrescribe). Verifica por HEAD público que `content-length` coincide con los bytes. Solo entonces llama a `_migrate_image_row`.
- Solo migra `image/jpeg`; otro mime queda `skipped` (`unsupported_mime`).
- Respuesta JSON: `found, migrated, skipped, failed, bytes_before, bytes_after, would_migrate` y `results` por fila. `bytes_before` es el tamaño del string data-URI; `bytes_after` los bytes del objeto.
- Idempotente: una fila migrada ya no coincide con el filtro; relanzar es seguro.

## 4. Runbook (ORDEN ESTRICTO)

Requiere autorización explícita del dueño en cada paso marcado (A).

1. Desplegar el front nuevo (este branch mergeado). Verificar que guardar un producto/combo/slide de prueba deja una URL `.../product-images/<carpeta>/...jpg` y no base64. (A)
2. Aplicar la migración de respaldo `20261015100000_image_migration_backup.sql`. (A) Verificar: tabla existe, RLS activo, `has_table_privilege('anon', ..., 'SELECT')` = false.
3. Generar un token aleatorio fuera del repo (por ejemplo `openssl rand -hex 32`) y calcular su sha256. Insertar SOLO el hash: `INSERT INTO system_config (key, value_text, description) VALUES ('image_migration_token_sha256', '<sha256>', 'temporary image migration token hash')`. Desplegar la función: `supabase functions deploy migrate-product-images`. (A) El token en claro no se guarda en ningún archivo ni en el historial compartido.
4. `dry_run` (por defecto): `limit` 20 por tabla. Revisar `would_migrate`, mimes, tamaños, `skipped`/`failed`.
5. Lotes reales: `{"dry_run": false, "limit": 5, "tables": ["carousel_slides"]}`, luego `combo_products`, luego `products`. Repetir hasta `found = 0`. Revisar `failed` en cada lote.
6. Verificación HTTP: para cada fila del respaldo, `GET public_url` devuelve 200 y `content-type: image/jpeg`.
7. Comparar sha256: para cada fila del respaldo, el sha256 del contenido descargado de `public_url` == `sha256` del respaldo (que es el del base64 decodificado original).
8. Apagar: `DELETE FROM system_config WHERE key = 'image_migration_token_sha256'` (la función pasa a responder 410). Opcional: borrar la función desplegada. (A)
9. SOLO después y con OTRO OK del dueño (A): limpiar `image_file`/base64 residual (`UPDATE products SET image_file = NULL`), y endurecer la política de Storage `Authenticated Users Can Upload 16wiy3a_0` (hoy cualquier usuario autenticado puede insertar en `product-images`; restringir a admin/super_admin). Antes de endurecerla confirmar que ningún flujo no-admin sube a ese bucket.
10. Conservar `_bak_image_migration_20261015` hasta que el dueño confirme; borrarla es una acción manual posterior.

## 5. Rollback

- Datos: restaurar el base64 desde el respaldo, por tabla (solo filas no editadas después):
  `UPDATE public.products p SET image_url = b.original_image_url FROM public._bak_image_migration_20261015 b WHERE b.table_name = 'products' AND b.row_id = p.id::text AND p.image_url = b.public_url;` (igual para `combo_products` y `carousel_slides`).
- Parar la migración: borrar la fila de token (410 inmediato).
- Objetos subidos: quedan en `migrated/...` (inofensivos); se pueden borrar a mano tras el rollback.
- Esquema: `DROP FUNCTION public._migrate_image_row(...)` y `DROP TABLE public._bak_image_migration_20261015` (ver cabecera de la migración).
- Front: revertir el merge; los registros guardados con URL siguen funcionando porque el front siempre acepta URLs.

## 6. Qué NO se hace automáticamente

- No se aplica ninguna migración ni se despliega ninguna función.
- No se inserta el hash del token ni se genera ningún token.
- No se ejecuta ningún lote real (la función arranca en `dry_run`).
- No se limpian `image_file` ni los base64 restantes, ni se tocan políticas de Storage.
- No se borra el respaldo.
- No se reescriben imágenes ya subidas desde ProductsPage ni URLs externas.
- Los slides con `image_url` nulo no se tocan.

## 7. Riesgos conocidos

- La función solo procesa JPEG; PNG/WebP en base64 quedan `skipped` y requieren decisión.
- `bytes_before` cuenta el string (base64 pesa ~33 % más que el binario).
- HEAD público depende de que el bucket siga siendo público.
- Redimensionado en cliente depende de `createImageBitmap`/canvas del navegador (probado con stubs en jsdom, no en navegador real): verificar a mano en el paso 1.
