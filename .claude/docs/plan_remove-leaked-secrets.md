# Plan: eliminar secretos filtrados del repo (OLA 0)

## Problema (verificado en origin/main)
1. `scripts/apply-migration.js:13` — SERVICE_ROLE_KEY de Supabase (JWT con role service_role) hardcodeada. El script esta roto (require() sobre paquete ESM) y ningun script de package.json lo usa.
2. `docs/MIGRATION_CLI_SETUP.md:84` — token personal de Supabase (`sbp_` + 40 hex).
3. `.env.local.example:39` — mismo tipo de token personal `sbp_` (hallazgo adicional; un archivo de ejemplo NO debe contener valores reales). No contiene JWT.
Los secretos de (1) y (2) estan en el historial git (commits 16550c79 y bd43e04d).

## Spec
- Test `src/tests/unit/noSecretsInRepo.test.js` recorre `git ls-files` (excluye package-lock.json y binarios) y falla ante:
  a) JWT cuyo payload tenga `role === 'service_role'` (anon se permite),
  b) token `sbp_` + >=30 hex,
  c) bloque `-----BEGIN ... PRIVATE KEY-----`.
- El mensaje de fallo da `archivo:linea` y TIPO, nunca el valor.
- Los patrones se construyen por partes y los casos positivos se fabrican en runtime (sin literales con aspecto de secreto).

## Arreglo
- `git rm scripts/apply-migration.js`.
- Reemplazar el token por `sbp_<tu-token>` en docs y `.env.local.example`; nota de que los tokens salen de variables de entorno locales y no se commitean.
- `.gitignore`: ya cubre `.env`/`.env.local`; solo se agrega `*.pem` si falta.

## Decisiones
- Escaneo sobre archivos trackeados (no working tree): es lo que termina en el repo.
- Solo `service_role` es fallo para JWT; anon es publica por diseño.

## Abogado del diablo
- "Borrar el archivo resuelve el leak": NO. Sigue en el historial y las claves siguen validas. Este PR solo evita nuevas filtraciones y detecta regresiones; rotacion y purga son aparte.
- "Falsos positivos con placeholders": el umbral de >=30 hex y el payload decodificado los evitan.
- "No ve secretos de otros formatos (Resend, Stripe...)": correcto; fuera de alcance, lo cubre GitGuardian/gitleaks.
- "Otros docs mencionan apply-migration.js": son menciones informativas; se reportan, no se tocan.

## Que NO hace este PR
- No rota la service role key ni revoca el token (accion del dueño en el dashboard de Supabase).
- No purga el historial (git filter-repo + force-push requiere autorizacion explicita del dueño).
- No toca produccion ni Supabase.
