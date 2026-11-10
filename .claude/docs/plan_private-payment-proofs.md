# Plan: comprobantes de pago de pedidos privados (OLA 2a)

Rama: `fix/private-payment-proofs`. Migración PREPARADA, NO aplicada.

## Problema (verificado contra produccion, solo SELECT)

- `storage.buckets`: `order-documents` es `public = true`, sin limite de tamaño ni lista de MIME.
- `storage.objects` tiene la policy `"Anyone can view payment proofs"` (SELECT a `public`, `bucket_id = 'order-documents'`): cualquiera con la anon key lista y descarga los comprobantes (31 objetos `payment-proofs/payment-proof-<orderId>-<ts>.<ext>`).
- INSERT: `"Users can upload payment proofs"` deja a CUALQUIER authenticated subir a `payment-proofs/` (sin ligar al pedido). UPDATE/DELETE: no hay policy vigente para `order-documents` (las genericas fueron acotadas en `20261014160100`), asi que estan denegados.
- `orderService.uploadPaymentProof` guarda `getPublicUrl` en `orders.payment_proof_url` y deriva la extension de `file.name`.
- La validacion de tipo/tamaño (JPG/PNG/WebP, 5 MB; el PDF NO se permite en CartPage aunque el input diga `.pdf`) vive solo en `CartPage.jsx`.

## Spec

1. `src/lib/paymentProofUrl.js` (puro): `extractPaymentProofPath(value)` -> path de storage o `null`. Soporta URL publica legacy (`.../object/public/order-documents/<path>`), URL firmada (`.../object/sign/...`, sin querystring), y path crudo `payment-proofs/...`. Todo lo demas -> `null`.
2. `src/lib/paymentProofService.js`: `getPaymentProofSignedUrl(value, expiresIn = 300)` -> `{ success, signedUrl | error }` (mismo contrato que `generateProofSignedUrl` de remesas). `validatePaymentProofFile(file)` y constantes (MIME permitidos, 5 MB).
3. `orderService.uploadPaymentProof`: valida MIME (lista blanca) y tamaño, extension derivada del MIME, sube, guarda el PATH (no URL publica) y devuelve el path. No llama `getPublicUrl`.
4. Hook `usePaymentProofUrl(value)` -> `{ url, loading, error }`; `OrderDetailsModal` (admin) y `UserPanel` lo usan. Si falla la firma: mensaje visible, la pantalla no se rompe.
5. Migracion `20261022100000_private_payment_proofs.sql` (ver cabecera del archivo).

## Decisiones

- Objeto -> dueño: el `orderId` esta embebido en el nombre (`payment-proofs/payment-proof-<uuid>-<ts>.<ext>`). La policy extrae el uuid con regex estricta y lo compara como TEXTO con `orders.id::text` (sin cast: un nombre raro no puede lanzar error y romper el listado). NO se liga contra `orders.payment_proof_url`: el dueño puede escribir esa columna (owner guard `20261014160000`) y podria apuntarla al comprobante de otro.
- Expiracion de firma: 300 s (se firma al abrir la pantalla; el usuario ve y abre en segundos). Las remesas usan 3600/86400; aqui es mas corta a proposito.
- MIME: `image/jpeg`, `image/png`, `image/webp` (lo que hoy permite CartPage; `image/jpg` no es un MIME real, se normaliza). PDF no se permite. Limite 5 MB (`FILE_SIZE_LIMITS.PAYMENT_PROOF`, igual que `remittance-proofs`).
- Los 31 objetos existentes NO se mueven ni se reescriben; `orders.payment_proof_url` legacy sigue siendo URL publica y el helper la convierte a path.
- Bucket `INSERT ... ON CONFLICT DO UPDATE` en vez de `UPDATE` para que sea idempotente tambien en entornos donde el bucket no existe (local/branch).
- Politica INSERT: se restringe al dueño del pedido (antes: cualquier authenticated). Es parte de "el dueño sube SU comprobante"; el front siempre sube tras crear el pedido propio.
- Admin = `(SELECT public.is_admin_user())`.

## Objeciones del abogado del diablo

1. "Con URL firmada de 5 min, un link copiado deja de servir." Si, es el objetivo. Se firma a demanda en cada apertura.
2. "Rompe links guardados fuera de la app." Verificado: `notify-order` (edge function) acepta `orderData.paymentProofUrl`, pero NINGUN caller del front lo envia hoy (`rg paymentProofUrl src`). WhatsApp de pedidos no incluye el comprobante. Las filas de `activity_logs` guardan URLs publicas legacy en metadata (solo lectura admin; dejan de ser abribles, aceptado). Emails/WhatsApp ya enviados con URL publica dejaran de abrir al aplicar la migracion.
3. "El front viejo cacheado en un cliente muestra `<img src=publicUrl>`." Tras la migracion mostrara imagen rota hasta recargar. Aceptado; el despliegue del front va primero.
4. "El dueño podria leer el comprobante de otro cambiando `payment_proof_url`." No: la policy ignora esa columna y usa el orderId del nombre del objeto.
5. "Un authenticated podria subir con el nombre del pedido ajeno." Bloqueado por la policy INSERT (EXISTS sobre orders del dueño).
6. "Admin con rol `manager`?" `is_admin_user()` define el alcance; se mantiene la misma funcion que usa el resto del sistema.
7. "El pedido se crea y la subida falla: huerfanos?" Sin cambio respecto al flujo actual.
8. "createSignedUrl exige SELECT del usuario sobre el objeto." Correcto, por eso las policies de SELECT; en bucket publico firma igual funciona (despliegue del front antes de la migracion es seguro).

## Orden de despliegue

1. Mergear y desplegar el front (funciona con bucket publico y privado).
2. Verificar en preview/produccion que un admin ve un comprobante via URL firmada.
3. Aplicar la migracion (accion aparte, aprobacion explicita del dueño).
4. Verificar: anon no lista ni lee; dueño lee el suyo y no el ajeno; admin lee todos (SELECTs de la cabecera de la migracion + prueba manual).

## Rollback exacto

Ver cabecera de la migracion: `UPDATE`/upsert del bucket a `public = true, file_size_limit = NULL, allowed_mime_types = NULL`, DROP de las 2 policies nuevas, recrear `"Anyone can view payment proofs"` y `"Users can upload payment proofs"`. El front nuevo sigue funcionando con el bucket publico.

## Verificacion

Unit (Vitest): helper, servicio de subida, hook/componentes. DB test (harness local, schema `storage` clonado): `src/tests/concurrency/privatePaymentProofs.test.js`. Suite completa + `npm run build`.
