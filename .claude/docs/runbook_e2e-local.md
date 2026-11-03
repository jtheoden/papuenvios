# Runbook: Playwright E2E contra un stack Supabase LOCAL (RB-09)

Alcance: suite role-based de `src/tests/e2e/` (proyectos `setup`, `chromium`, `mobile-chrome`). Corre SOLO contra un
stack local. Nunca contra produccion (`qcwnlbpultscerwdnzbm` / `*.supabase.co`).

## Por que un stack dedicado (y no el 55321 del harness de BD)

El API del stack `e2e-supabase` (`http://127.0.0.1:55321`) sirve su base `postgres`. Esa base es la **fuente del harness
de tests de BD** (`scripts/test-db-bootstrap.sh` la clona con `pg_dump`) y debe quedar en el estado pre-migracion.
Para correr Playwright hace falta que PostgREST/GoTrue sirvan una base **migrada** (ventana desde `20261014180000`),
asi que migrar `postgres` ahi esta prohibido. La solucion es un segundo stack, desechable y aparte:

| | harness BD (NO tocar) | stack E2E (este runbook) |
|---|---|---|
| project_id | `e2e-supabase` | `papuenvios-e2e-run` |
| API / DB | 55321 / 55322 | 56321 / 56322 |
| config | (preexistente) | `scripts/e2e-stack/supabase/config.toml` |
| contenido | `postgres` pre-migracion | schema base + ventana de migraciones |

`postgres_pre_restore` (en el contenedor del harness) no sirve: ningun servicio la apunta y no esta migrada.

## Prerrequisitos

- Docker, Supabase CLI (probado con 2.67.1), `psql`, `curl`, `openssl`, Node 22, `npm ci`, `npx playwright install chromium`.
- `E2E_DB_PASSWORD` exportada: la contrasena de la BD del stack LOCAL desechable (el script ya no trae valor por defecto).
- Puertos 56321/56322 libres. ~1.5 GB de RAM para el stack.
- `supabase/e2e/base-public-schema.sql` (versionado; ver "Schema base").

## Como correrlo

```bash
# 1) stack fresco (solo DB, auth, rest, storage, kong)
supabase start --workdir scripts/e2e-stack \
  -x studio,imgproxy,vector,logflare,edge-runtime,mailpit,postgres-meta,supavisor,realtime

# 2) schema base + replay de la ventana de migraciones (solo en stack FRESCO; se niega si public tiene tablas)
bash scripts/e2e-local.sh prepare

# 3) suite completa (o args de Playwright: npm run test:e2e:local -- --project=chromium smoke)
npm run test:e2e:local
```

`run` hace, en orden: verifica que el API local responda y que la base tenga el marcador `e2e_prepare.done` al dia con la
ultima migracion del repo; crea 3 usuarios QA (`qa-user|qa-admin|qa-super-admin@e2e.local`) por la API admin de GoTrue
LOCAL con contrasenas aleatorias (`openssl rand -hex 16`, solo en variables de entorno del proceso); les asigna rol por
SQL; siembra `scripts/e2e-seed.sql` (monedas USD/EUR con tasa, categoria, producto con stock, tipo de remesa, metodo de pago zelle, 3 ofertas); levanta un build de produccion
de la app (`.e2e-dist`, no toca `dist/`) y ejecuta Playwright; al salir borra usuarios, siembra, `.e2e-dist` y
`playwright/.auth`.

## Guards de seguridad

- `playwright.config.js` y `helpers/auth.js` abortan si `VITE_SUPABASE_URL` no es `http://127.0.0.1|localhost`
  (`src/tests/e2e/helpers/localGuard.js`, test: `src/tests/unit/e2eLocalGuard.test.js`). Ninguna credencial ni URL esta
  hardcodeada y NO se lee ningun `.env*` (el `.env.local` de un dev apunta al proyecto hospedado).
- `e2e-local.sh` solo acepta hosts loopback y rechaza los puertos 55321/55322 en TODOS los subcomandos (tambien con overrides
  `E2E_API_URL`/`E2E_DB_PORT`).
- Playwright nunca reutiliza un servidor ya levantado en :5173 (`reuseExistingServer: false`): un dev server con `.env.local`
  podria apuntar al proyecto hospedado. Si el puerto esta ocupado, el run falla. Ademas el runner construye la app el mismo
  (`.e2e-dist`) y aborta si el bundle contiene alguna URL `*.supabase.co` o no contiene la URL local.
- Secretos (service key, contrasenas QA) viajan en un archivo de config de curl 0600, no en argv.

## Schema base (por que existe)

Las migraciones **no son re-ejecutables desde cero**. Medido: replay de las 135 migraciones, en orden, sobre un stack
limpio -> al menos 60 fallan en cascada (se corto el listado en 60): `relation "public.remittances" does not exist`,
`function is_admin_user() does not exist`, `invalid input value for enum user_role: "manager"`, etc. (el primer fallo es
`20250128000000_add_bank_accounts_system.sql`). Sobre el clon del harness, `test-db-bootstrap.sh --probe` da 24 fallas
(policies duplicadas, `CREATE EXTENSION` fuera de `postgres`, ...). Por eso: `supabase/e2e/base-public-schema.sql` = `pg_dump --schema-only --schema=public`
(solo estructura, sin datos) del clon del harness + los 2 triggers de `auth.users`, y luego replay de las migraciones desde
la ventana (cabecera `-- replay-from:` del archivo, hoy `20261014180000`, mas `20261014140000`).

Regenerar (solo lectura sobre el clon): `bash scripts/e2e-local.sh dump-base`. El script falla si detecta patrones de secreto.
Limitaciones conocidas: no incluye policies/buckets de `storage` (la suite no sube archivos) ni datos de `realtime`.
Mantenimiento: las migraciones nuevas se replayan solas; el dump solo se regenera si se quiere adelantar la ventana.
Fuga: es estructura; contiene los emails de super_admin que ya estan en `handle_new_user()` y en las migraciones del repo.

## Que NO hacer

- No correr `prepare` ni apuntar `E2E_DB_PORT`/`E2E_API_URL` al stack 55321/55322; no migrar `postgres` del harness.
- No poner `E2E_API_URL` hacia un host que no sea loopback; no exportar claves de produccion en el shell donde se corre.
- No reutilizar un stack preparado tras agregar migraciones (el marcador lo detecta: recrear y volver a `prepare`).
- No commitear `playwright/.auth`, `test-results`, `.e2e-dist`, `node_modules` (symlink temporal del worktree).

## Como volver atras

```bash
supabase stop --workdir scripts/e2e-stack --no-backup   # destruye el stack y sus volumenes
```
El harness de BD y el stack `e2e-supabase` no se ven afectados. Para repetir: `start` + `prepare` otra vez.

## CI (RB-09b): `.github/workflows/e2e.yml`

Workflow separado (no modifica `ci.yml`), NO requerido: `continue-on-error: true`, disparo por `workflow_dispatch`, nightly y
PR con label `e2e`. Permisos `contents: read`, actions pineadas por SHA, cache de browsers, sin secretos. Usa el mismo
flujo (`supabase start` -> `prepare` -> `run`). Estado: ver TRACKING_PROGRESS (no ejecutado en GitHub Actions todavia;
solo validado como YAML y reproducido paso a paso en local).

## Siguiente paso para convertirlo en check requerido

Ver recomendacion en TRACKING_PROGRESS: requerir solo tras >= 10 corridas nightly consecutivas verdes en Actions,
tiempo p95 < 15 min, cero tests dependientes de timing/animaciones y los tests con `test.skip()` por datos vacios convertidos
en asserts sobre la siembra.
