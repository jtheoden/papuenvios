# Runbook: optimizar las imágenes existentes de Storage

> **ALTO: no ejecutes `--apply` todavía.**
>
> - El 05-nov-2026 el egress iba en 4,97 / 5 GB (plan Free). El `--apply` **descarga** los originales: unos 15 MB solo de `product-images`.
> - Ejecútalo solo cuando reinicie el ciclo (**09-nov-2026**) o la organización pase a **Pro**.
> - Ve **por lotes** (`--bucket`, `--limit N`) y reanuda cuando quieras: el script es idempotente y salta lo ya subido.
> - El `--dry-run` (por defecto) no descarga ningún objeto. Solo lista metadatos y lee las filas que referencian cada URL.

Script: `scripts/optimize-existing-images.mjs`. Lo ejecuta el dueño en su terminal. Ningún agente lo ejecuta contra producción.

Qué hace y qué no:

| | Dry-run (defecto) | `--apply --confirm-production --i-checked-egress-budget` |
|---|---|---|
| Lista objetos (metadatos) | sí | sí |
| Descarga originales | **no** | sí (muestra antes el egress que va a gastar) |
| Sube objetos nuevos `…​.opt.<hash8>.webp` | no | sí, con `cacheControl` de 1 año y `upsert: false` |
| Sobrescribe o borra originales | nunca | nunca |
| Toca la BD | nunca | nunca: genera SQL para revisar |
| Comprobantes (`order-documents`, `remittance-proofs`, `*-delivery-proofs`) | solo informa su peso | **nunca** se procesan (valor legal) |

Buckets procesados:
- `product-images`, con todas sus carpetas: `products/`, `combos/`, `carousel/`, `migrated/*`.
- `publications`.

No existe un bucket `carousel`: el carrusel vive dentro de `product-images`.

## 0. Requisitos

- Node 20+ en la raíz del repo.
- Encoder `sharp`, solo para `--apply`. No es dependencia del proyecto: `npm install --no-save sharp`.
- Variables de entorno, en la terminal: el script no lee ningún `.env` y nunca imprime la clave.

  ```bash
  export SUPABASE_URL="https://qcwnlbpultscerwdnzbm.supabase.co"
  read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY   # pega la clave; no queda en el historial
  ```

- **Para `product-images`:** su bucket no admite `image/webp` (`allowed_mime_types`). Antes del apply hay que aplicar la migración aditiva `supabase/migrations/20261105100000_product_images_allow_webp.sql`, como paso explícito y con su propio "dale". Si falta, el script lo detecta y aborta sin descargar nada. `publications` ya admite webp.

## 1. Dry-run (sin egress de imágenes)

```bash
node scripts/optimize-existing-images.mjs                   # todo, razón estimada 0,6
node scripts/optimize-existing-images.mjs --ratio=0.5 --min-kb=100
```

Comprueba:
- La tabla por bucket: objetos, MB antes, MB estimados después, ahorro % y candidatos.
- Los 10 objetos más pesados, con `refs=N` (cuántas filas los usan).
- La línea `Apply would download N original(s): ~X MB of egress`. **X debe caber holgado en el cupo restante**.

`--ratio` es solo una estimación. La razón real aparece en el manifiesto tras el primer lote.

## 2. Etapa UPLOAD, por lotes (después del 09-nov o en Pro)

```bash
npm install --no-save sharp
# lote de prueba: 5 objetos de publications
node scripts/optimize-existing-images.mjs --apply --confirm-production --i-checked-egress-budget --bucket=publications --limit=5
# product-images, solo tras aplicar la migración webp, de 20 en 20 (primero los más pesados)
node scripts/optimize-existing-images.mjs --apply --confirm-production --i-checked-egress-budget --bucket=product-images --limit=20
# repetir el mismo comando hasta que diga "Apply would download 0 original(s)"
```

Cómo funciona cada objeto:
- Se descarga el original y se redimensiona (lado mayor ≤ 1200 px, WebP q80).
- Si el resultado pesa ≥ 90 % del original, se omite (`skipped_not_lighter`).
- Si pasa, se escribe la línea en `scripts/out/manifest-<fecha>.json` **antes** de subir.
- Se sube como objeto nuevo y se verifica con `HEAD` (200 y `Content-Length` igual al esperado). El estado queda en `verified`, `unverified` o `error`.

Comprueba tras cada lote:
- El resumen final `{"verified":…, "skipped_not_lighter":…}`: no debe haber `error` ni `unverified`. Si los hay, re-ejecuta: los ya subidos se re-verifican.
- Abre en el navegador 2-3 `url_nueva` del manifiesto. Deben verse bien, sin rotar y sin perder transparencia.

Reanudar es seguro. El nombre nuevo deriva de ruta + eTag del original, así que lo ya subido se detecta solo por metadatos y no se vuelve a descargar.

## 3. Verificación previa al cambio de URLs

- `scripts/out/update-urls-<fecha>.sql` incluye **solo** los objetos `verified`. Cada `EXECUTE` actualiza una fila por `id` **y solo si la URL sigue siendo la original** (`WHERE … = <url_original>`), así que no pisa cambios hechos entretanto.
- Revisa el número de filas al final del archivo (`-- N row update(s)`) contra los `refs` del dry-run.
- `scripts/out/rollback-urls-<fecha>.sql` es el espejo exacto: vuelve a la URL original solo si la fila tiene la nueva.

Guarda los tres archivos, manifiesto y los dos SQL, fuera del repo como respaldo. `scripts/out/` está en `.gitignore`.

## 4. Actualizar las URLs en BD (paso separado, lo ejecuta el orquestador o el dueño)

Ejecuta el contenido de `update-urls-<fecha>.sql` con la herramienta de BD: `psql` o el SQL editor de Supabase.

- Va en una transacción (`BEGIN … COMMIT`) con `PREPARE`/`EXECUTE`: valores parametrizados, sin interpolar en el `UPDATE`.
- Después comprueba:

  ```sql
  SELECT count(*) FROM products WHERE image_url LIKE '%.opt.%.webp';
  SELECT count(*) FROM carousel_slides WHERE image_url LIKE '%.opt.%.webp';
  ```

## 5. Comprobación visual

- Home: el cartel del carrusel se ve, con su proporción.
- `/products`: las tarjetas muestran imagen y no aparece el icono de "sin imagen".
- Detalle de 2-3 productos y combos.
- Ajustes → Contenido: las portadas de publicaciones.
- DevTools → Network: las imágenes salen `.webp`, con `cache-control: max-age=31536000` y menor peso.

## 6. Rollback

- **URLs**: ejecuta `rollback-urls-<fecha>.sql`. Es inmediato, porque los originales siguen intactos en Storage.
- **Objetos nuevos**: no hace falta borrarlos para revertir; la app deja de pedirlos. Si se quieren eliminar, se hace a mano desde el manifiesto (`ruta_nueva`) y **solo** tras confirmar que ninguna fila los usa (`SELECT … WHERE image_url = '<url_nueva>'`).
- **Migración webp de `product-images`**: el rollback está comentado dentro del propio archivo. Solo es seguro si no hay filas apuntando a `.webp`.

## 7. Qué no hace (a propósito)

- No borra originales. No toca comprobantes.
- No cambia `products.image_file`: el base64 legado ya lo excluye el código.
- No convierte GIF ni SVG.
