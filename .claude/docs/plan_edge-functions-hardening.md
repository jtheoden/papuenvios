# Plan: endurecimiento de Edge Functions (OLA 2b)

Rama: `fix/edge-functions-hardening`. Sin commit, sin deploy, sin migraciones.

## Spec
1. `bank-account-crypto`
   - Falla cerrada: si `BANK_ENCRYPTION_KEY` falta o está vacío, responde 500 `encryption_not_configured` y nunca cifra/descifra.
   - `encrypt`: cualquier usuario autenticado (lo usa `src/lib/recipientService.js` cuando un cliente guarda la cuenta de un destinatario). Límite de payload: 512 caracteres de texto plano.
   - `decrypt`: solo `admin` / `super_admin` (rol leído de `user_profiles`; lo usa `AdminRemittancesTab.jsx`). Límite de 2048 caracteres de ciphertext.
   - CORS vía `_shared/cors.ts` (Allow-Methods + Vary).
   - Lógica pura en `bank-account-crypto/logic.js` (tests: `src/tests/unit/bankAccountCryptoLogic.test.js`).
   - Algoritmo, formato del ciphertext y salt NO cambian.
2. Se eliminan del repo `notify-order/` y `migrate-product-images/` (+ su test). Test de lista permitida: `src/tests/unit/edgeFunctionsAllowlist.test.js`.
3. `_shared/cors.ts`: se quita `endsWith('.vercel.app')`. Lógica en `_shared/corsLogic.js` (test `corsLogic.test.js`). Orígenes: `papuenvios.com`, `www.papuenvios.com`, `http://localhost:<puerto>` + los exactos listados en el secret `ALLOWED_ORIGINS` (coma-separado). No se encontraron dominios de preview del proyecto en el repo (no se inventan).

## Decisiones y objeciones del abogado del diablo
- "Exigir admin en encrypt rompe a los clientes": por eso NO se exige; se acota con tamaño. Sin rate limit stateless posible en Edge; el costo PBKDF2 (100k) por llamada queda como riesgo residual (mitigación futura: cachear la clave derivada por isolate, o límite en BD).
- "Cambiar el salt mejora seguridad": invalida todos los datos cifrados. Se documenta como deuda (versionar ciphertext `v2:` + salt aleatorio por registro, re-cifrado perezoso).
- "Fallar cerrado puede tumbar producción si el secret no existe": no hay herramienta para listar secrets sin leer valores; verificar a mano ANTES de desplegar (ver orden).
- "Quitar `.vercel.app` rompe previews": sí, a menos que se agregue la URL exacta a `ALLOWED_ORIGINS`. Producción no se afecta. Riesgo bajo: token en localStorage, sin cookies.
- "Borrar notify-order pierde documentación": `docs/guides/NOTIFICATIONS_IMPLEMENTATION_GUIDE.md` es histórica y no se reescribe; la función no estaba desplegada.

## Orden de despliegue (acciones del dueño)
1. Confirmar en Supabase Dashboard > Edge Functions > Secrets que existe `BANK_ENCRYPTION_KEY` (no se pudo verificar desde aquí).
2. (Opcional) crear `ALLOWED_ORIGINS` si se usan previews.
3. Desplegar `bank-account-crypto` (v1 en prod) y luego las funciones que importan `_shared/cors.ts`: `notification-settings`, `notify-zelle-deactivation` (requieren redeploy para tomar el nuevo CORS).
4. Smoke: guardar un destinatario (encrypt) y abrir una remesa como admin (decrypt).

## Estado en producción (verificado con list_edge_functions, solo lectura)
- `migrate-product-images`: sigue ACTIVE (v2). Borrarla del repo NO la quita del deploy. Quitarla requiere aprobación explícita del dueño: `supabase functions delete migrate-product-images`.
- `notify-order`: NO está desplegada.

## Qué NO hace este PR
- No cambia salt/algoritmo/formato. No implementa rate limit. No toca `notification-settings` ni `notify-zelle-deactivation` (hallazgos abajo). No despliega ni borra nada en Supabase.

## Hallazgos pendientes (no corregidos)
- `notify-zelle-deactivation`: solo `verify_jwt`; sin chequeo de rol, cualquier usuario autenticado puede enviar el email a un `userEmail` arbitrario (relay Resend); `userName`/`zelleAccountName` interpolados en HTML sin escapar; el `catch` devuelve `err.message` al cliente; responde 200 con `success:false` cuando falta RESEND_API_KEY.
- `notification-settings`: cliente creado con service role pero reenvía el header Authorization del usuario (el comentario "bypassear RLS" es engañoso; las consultas corren con el JWT del usuario); `console.log` del payload completo en PUT (incluye teléfonos/email admin); `payload: any` sin validar formato; GET expone todas las settings (incl. adminEmail) a cualquier autenticado (por diseño documentado); 401/403/405 correctos, CORS vía helper compartido.
