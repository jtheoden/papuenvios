# Runbook: sonda HTTP de PostgREST para el contrato B (Fase 0b)

Condicion de entrada obligatoria para aplicar `supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql`
(plan §6.4). El harness SQL (`src/tests/concurrency`) prueba grants con `SET ROLE`; esta sonda prueba lo que **PostgREST genera de verdad**.

Archivos: `scripts/probe-postgrest-contract.mjs` (sonda), `scripts/probe-postgrest-local.sh` (runner local de punta a punta),
`scripts/probe-postgrest-seed.sql` (fixtures del scratch), tests en `src/tests/unit/probePostgrestContract.test.js`.

## 1. Corrida local completa (stack e2e de docker)

```bash
npm run probe:postgrest        # = bash scripts/probe-postgrest-local.sh
```

Requisitos: contenedores `supabase_*_e2e-supabase` arriba y la imagen de PostgREST ya presente (`public.ecr.aws/supabase/postgrest:v14.1`;
el runner **no descarga nada**). Lo que hace, y limpia en cualquier salida (trap):

1. Crea la BD scratch `papuenvios_test_pgrst` con `scripts/test-db-bootstrap.sh --recreate` (clon de esquema + todas las migraciones, A incluida)
   y carga `probe-postgrest-seed.sql`. El nombre cumple el regex del bootstrap (`papuenvios_test*`); no toca `postgres` ni `papuenvios_test`.
2. Levanta un PostgREST efimero en `127.0.0.1:54701` (`PROBE_LOCAL_PORT` para cambiarlo), con `PGRST_DB_URI` y `PGRST_JWT_SECRET` leidos en
   tiempo de ejecucion del contenedor `supabase_rest_e2e-supabase` (nunca a disco ni a pantalla).
3. Firma JWT HS256 en memoria (anon, customer, admin; 15 min). El stack local usa un **JWKS** (`{"keys":[{"kty":"oct","k":...}]}`) como secreto:
   la sonda firma con el `k` decodificado.
4. Fases: **0** control negativo (las aserciones after-b DEBEN fallar sin B; si pasaran, la sonda no prueba nada) -> **1** before-b -> aplica B
   -> **2** after-b -> aplica el rollback de B -> **3** before-b otra vez + comparacion de snapshots de grants (tabla y columna).
5. Sale con 0 solo si todo coincide.

## 2. Que asierta cada fase

| Fase | anon / customer / admin sobre las 9 columnas ocultas | Columnas publicas | RPC `admin_list_*` |
|---|---|---|---|
| `before-b` | **Leen** el valor (fuga documentada) por directa, `select=*`, `select` implicito, embed (categoria, `combo_items(products(...))`, reverso, inventory), `PATCH`/`POST` con `return=representation` | legibles | solo admin 200; anon/customer 42501 |
| `after-b` | 401/403 **con `code: 42501`** (nunca "cualquier no-2xx"): directa, `order=`, filtro, `or=`, `HEAD`+count con filtro, `HEAD select=*`, embeds, `select=*`, RETURNING `*` o con columna oculta | legibles sin ninguna clave oculta, tambien el `PATCH`/`POST` con `select=` publico, `return=minimal` y `Accept: ...object+json` | admin 200 con las claves de costo; anon/customer 42501 |

Tablas: `products`, `combo_products`, `product_categories`, `inventory`, `shipping_zones`. Relaciones cerradas por B: `order_analytics`, `remittance_services`
(anon nunca tuvo SELECT; authenticated lo pierde). `HEAD` sin `select` es "either" a proposito: se reporta cual ocurrio.

## 3. Hallazgos de la corrida local (PostgREST v14.1) que el harness SQL no veia

- Un `HEAD ... Prefer: count=exact` **sin `select`** (y `HEAD ?select=*`) genera `table.*`: tras B da 401/403 42501 en las 5 tablas (15/15). Antes de B pasa.
  El front no lo usa (todos los `head: true` de `src/` usan `select('id')`; verificado con `rg`), pero es una regla nueva para quien agregue conteos.
- `PATCH`/`POST` con `Prefer: return=representation` y `select=` publico explicito (tambien `.single()`) **siguen funcionando** tras B en las 5 tablas, incluido
  `POST inventory` con sus triggers. Sin `select` (RETURNING `*`) o con columna oculta: 42501. `return=minimal` funciona.
- Escribir columnas ocultas (UPDATE/INSERT) sigue permitido tras B (solo se revoca SELECT).
- Un customer que hace `PATCH ... return=representation` recibe 0 filas por RLS antes de B y 42501 tras B (el chequeo de privilegio ocurre al planificar).

## 4. Como correrla contra produccion (solo lectura, **despues** de aplicar B, y tambien antes como linea base)

Requiere el "dale" del dueno para cada corrida contra produccion. Solo envia `GET`, `HEAD` y `POST /rpc/admin_list_*` (lecturas). El modo no-local
**fuerza sin escrituras**; el ejecutor rechaza cualquier otro metodo aunque la lista de casos lo pidiera; no sigue redirects; imprime solo nombres de
claves y conteos, jamas valores de costo ni tokens. Se niega a correr contra un host no local sin `--i-understand-this-hits-production`.

Obtener credenciales de prueba (nunca escribirlas en archivos del repo ni en `.claude/settings.json`):

- `PROBE_ANON_KEY`: la anon/publishable key del proyecto (publica por diseno; `get_publishable_keys` del MCP o el dashboard).
- `PROBE_CUSTOMER_JWT`: `access_token` de una cuenta **cliente de prueba** (rol `user`), tomado de la sesion del navegador
  (DevTools -> Application -> Local Storage -> `sb-qcwnlbpultscerwdnzbm-auth-token` -> `access_token`) o por login con password en una terminal que no guarde historial.
- `PROBE_ADMIN_JWT`: igual, de un admin/super_admin existente. **Nunca** usar la service role key.
- Los JWT duran ~1 h; exportarlos solo en la sesion de shell actual.

```bash
export PROBE_BASE_URL="https://qcwnlbpultscerwdnzbm.supabase.co/rest/v1"
export PROBE_ANON_KEY=...        # no pegar en el chat
export PROBE_CUSTOMER_JWT=...
export PROBE_ADMIN_JWT=...
node scripts/probe-postgrest-contract.mjs --phase=before-b --i-understand-this-hits-production   # antes de B: linea base (documenta la fuga)
node scripts/probe-postgrest-contract.mjs --phase=after-b  --i-understand-this-hits-production   # despues de B
```

Notas de produccion: las tablas tienen filas (53 productos, 16 combos...), asi que las pruebas `leak` pueden verse; `remittance_services` y
`order_analytics` toleran 0 filas (evidencia solo por estado). `cost_price` es NULL en todas las filas y se acepta como "presente pero nulo".
Si el customer de prueba no tiene pedidos, `order_analytics` devuelve `[]` (estado 200 antes de B, 42501 despues). La version de PostgREST de
Supabase puede diferir de v14.1: **esta corrida de produccion es la que cuenta** para el SQL realmente generado.

## 5. Criterios

**Aprobar B** (todos): corrida local completa con exit 0 (control negativo OK, snapshots de grants identicos tras el rollback); linea base de
produccion `before-b` en 0 fallos o con fallos explicados; 48 h sin 42501 de la app en `query_logs`; `adminCosts` sin alertas.

**Aprobar post-B en produccion** (todos): `--phase=after-b` termina con `0 failed`; ademas SELECT de `has_column_privilege` para las 9 columnas (plan §6.6).

**Rollback inmediato** (aplicar `supabase/rollbacks/20261016160100_phase0b_contract_revoke_cost_columns_down.sql`; no hace falta revertir el front) si, tras B:

- cualquier caso de lectura publica falla (`public-columns`, `public-embed`, `head-count-public`, `write-returning-public`): el storefront o el admin se rompen;
- `rpc` admin da algo distinto de 200 con claves de costo;
- aparecen 42501 de la app en `query_logs` fuera de la sonda.

**Escalar (no es rollback, es fuga abierta)** si en `after-b` falla un caso que espera `denied` (alguna columna oculta sigue legible): revisar que el REVOKE
de tabla se aplico y que no hay otro GRANT (PUBLIC, default privileges, vista) que la reabra.

## 6. Limites conocidos

- Un fallo `FAIL ... expected 401/403 with code 42501, got ...` distingue una denegacion real de un error de parseo (PGRST100), relacion faltante (PGRST200) o
  columna inexistente (42703): estos ultimos NO cuentan como "denegado".
- La sonda no prueba Realtime ni Storage. Realtime se cubre en el test SQL (`supabase_realtime` solo publica `orders` y `remittances`).
- `HEAD` no tiene cuerpo: su denegacion se juzga solo por estado 401/403.
