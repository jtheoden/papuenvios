# Plan: CI minima y configuracion de tests (OLA 1)

Rama: `chore/ci-minimal` (desde origin/main). Sin commit, sin push, sin tocar Supabase/produccion.

## Spec
1. `vite.config.js`: `testTimeout`/`hookTimeout` = 30000 ms.
2. Cobertura honesta: `coverage.include` = `src/lib/**`, `src/contexts/**`, `src/hooks/**`; `thresholds` en el nivel actual redondeado hacia abajo.
3. Script `lint` (`eslint src`) y declaracion de las dependencias que importa `eslint.config.js` (`globals`, `eslint-plugin-react`, `eslint-plugin-react-hooks`) mas `yaml` (usada por el test del workflow). Versiones = las ya resueltas en el lockfile (diff minimo).
4. `.github/workflows/ci.yml`: lint -> test:coverage -> build (+ `npm audit` informativo).
5. Test `src/tests/unit/ciWorkflow.test.js` con invariantes de seguridad del workflow.

## Evidencia (TDD)
- Rojo timeouts: `vitest run --maxWorkers=16 --coverage` con timeout 5 s: 19 tests fallan por timeout (9 archivos).
- Verde: mismo comando con 30 s: 2125/2125 (201 archivos), 0 timeouts.
- Rojo test del workflow: sin `ci.yml` los 5 tests fallan con ENOENT; verde al crear el archivo.
- Cobertura real medida (include ampliado): stmts 41.39 / branches 37.2 / funcs 53.31 / lines 40.48. Umbrales: 41 / 37 / 53 / 40.

## Decisiones
- Node 22: vite 7 exige ^20.19 || >=22.12, jsdom 29 exige ^22.13 || >=24. No hay `engines` ni `.nvmrc`; se fija en el workflow (`node-version: 22`).
- Acciones `actions/checkout@v4` y `actions/setup-node@v4` ancladas por tag mayor (owner oficial `actions/`, recibe parches). Anclar por SHA es mas estricto pero exige mantenimiento; el test fuerza owner `actions/`.
- `permissions: contents: read`, sin `secrets.*`, sin `pull_request_target`, `concurrency` con cancel-in-progress, `timeout-minutes: 20`.
- Build con `VITE_SUPABASE_URL=http://localhost` y `VITE_SUPABASE_ANON_KEY=dummy` (solo valores ficticios).
- Lockfile: el diff es minimo (solo el bloque raiz de devDependencies), se actualiza con `npm install --package-lock-only`.

## Objeciones del abogado del diablo
- "Umbrales bajos no sirven": son un piso anti-regresion, no una meta; el valor anterior (~97 %) era falso porque medía 2 archivos.
- "30 s oculta tests lentos": solo afecta al techo; los tests sanos siguen en ms. Los lentos se ven en la duracion reportada.
- "Tag mayor en vez de SHA": riesgo aceptado para acciones first-party de GitHub; migrar a SHA si se endurece la politica.
- "Falta la suite de DB y E2E": requieren Postgres/navegador; fuera de alcance de esta ola.
- "npm audit informativo no bloquea": intencional (`continue-on-error`) para no frenar PRs por avisos transitivos.
- "El test lee un YAML con `yaml`": dependencia ya presente en el lockfile; declarada explicitamente.

## Que NO hace este PR
- No corre `test:concurrency` (DB) ni Playwright.
- No corrige los 3 archivos con `no-undef` desactivado en `eslint.config.js`.
- No agrega despliegues, secretos ni acciones de terceros.
- No sube cobertura; solo la mide bien y la congela.

## Corrección tras verificación independiente
En la verificación se observó un flaky real bajo carga con cobertura: `SendRemittancePage.proofSubmit > opens the proof-pending confirmation even when the phone lookup fails` falló con `Unable to find role="button"` (espera de Testing Library, no timeout de Vitest). Causa: `asyncUtilTimeout` por defecto de 1 s. Corrección: `configure({ asyncUtilTimeout: 5000 })` en `src/tests/setup.js`. No se puede demostrar en rojo de forma determinista (depende de la carga); se verifica con varias corridas bajo carga (`--maxWorkers=16` con cobertura).
