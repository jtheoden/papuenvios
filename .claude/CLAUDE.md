# PapuEnvios — Configuracion Claude Code

## Proyecto

Plataforma de e-commerce y envios de remesas para el mercado cubano. Gestiona pedidos, carritos, pagos y comunicacion por WhatsApp. Backend: Supabase (PostgreSQL + Auth + RLS + Edge Functions).

- **Supabase Project**: papuenvios (`qcwnlbpultscerwdnzbm`)
- **Region**: South America (Sao Paulo)
- **URL**: https://qcwnlbpultscerwdnzbm.supabase.co

Ver `/CLAUDE.md` en la raiz para credenciales de acceso a BD, queries diagnosticas y errores comunes.

---

## Stack

| Capa | Tecnologia |
|------|-----------|
| Frontend | React 18.2 + Vite 7.x — **JavaScript/JSX plano, NO TypeScript** (excepcion: `src/types/banking.ts`, un unico archivo legacy de interfaces de referencia, no compilado como parte del build normal) |
| Estilos | Tailwind CSS + Radix UI |
| Backend | Supabase (PostgreSQL + Auth + RLS) |
| Edge Functions | Supabase Functions (Deno) |
| Lenguajes | JavaScript, SQL |
| Tests unitarios | Vitest + Testing Library (`src/tests/unit/`) |
| Tests E2E | Playwright (`src/tests/e2e/`) |
| Despliegue | Vercel |
| Grafo de codigo | CodeGraph indexado (`.codegraph/`) — usar `codegraph_explore`/`codegraph explore` antes de grep/read amplios |

---

## Convenciones de Codigo

### JavaScript (el proyecto NO usa TypeScript salvo la excepcion ya mencionada)
- Funciones y hooks en estilo funcional (sin clases)
- Sin `console.log` en codigo de produccion
- Sin secretos hardcodeados — usar variables de entorno (nunca en `.claude/settings.json`, que SÍ se trackea en git — ver Autonomy Boundaries)

### React
- Componentes funcionales + hooks unicamente
- Custom hooks en `src/hooks/` para logica de Supabase
- Componentes en `src/components/` (sin carpeta `pages/` — no existe en este proyecto, las "paginas" son componentes de nivel superior en `src/components/`, ej. `HomePage.jsx`, `CartPage.jsx`, `AdminPage.jsx`)

### Supabase / SQL
- Nunca consultar tablas sin considerar RLS activo
- Siempre verificar GRANTs + RLS policies al crear tablas nuevas
- Evitar recursion en RLS: usar funciones `SECURITY DEFINER` (ver `/CLAUDE.md`)
- Migraciones en `supabase/migrations/` con timestamp ISO en nombre
- Edge Functions en `supabase/functions/` — Deno runtime
- **No existe convencion de soft-delete generica vía columna `activa`** — esa convencion es de OTRO proyecto (Sernatur/PHP) cuyo `CLAUDE.md` vive en un directorio padre y puede filtrarse por error si un agente lee ambos archivos sin distinguir el proyecto. En papuenvios: `products`/`product_categories` usan borrado **fisico** (ver `deleteProduct`/`deleteCategory` en `productService.js`, y los RPC `bulk_delete_products`/`bulk_delete_categories`); `bank_accounts` SÍ tiene soft-delete real pero vía `deleted_at`/`deleted_by_user_id`, no `activa`. `is_active` en productos solo oculta del catalogo publico, no borra.
- **Operaciones administrativas destructivas** (bulk-delete, reset de plataforma): patron establecido — RPC `SECURITY DEFINER` que re-verifica el rol internamente (`IF NOT is_super_admin() THEN RAISE EXCEPTION`), `pg_advisory_xact_lock` por dominio para serializar contra si mismo, reporte parcial por item cuando aplica. Ver `supabase/migrations/20260808000001_bulk_delete_products_categories.sql` y `20260808000002_platform_reset.sql` como referencia.

### Tailwind CSS
- Clases de utilidad directas; evitar CSS custom salvo tokens globales
- Consistencia con breakpoints: `sm`, `md`, `lg`, `xl`

---

## Estructura de Directorios

```
src/
├── components/     # Componentes reutilizables Y "paginas" de nivel superior (no hay carpeta pages/)
│   ├── admin/      # Configs de tabla para vistas admin (UserTableConfig, OrderTableConfig)
│   ├── vendor/     # Gestion de catalogo (productos, categorias, combos)
│   ├── tables/     # ResponsiveTableWrapper, BulkDeleteBar — primitivas reusables de tabla
│   └── settings/   # Tabs de Configuracion (financiero, zelle, sistema, etc.)
├── hooks/          # Custom hooks (useAuth, useCart, useOrders, etc.)
├── lib/            # Cliente Supabase, servicios (*.Service.js), helpers, constantes
├── contexts/       # AuthContext, BusinessContext, LanguageContext, CurrencyContext
├── translations/   # ES.json / EN.json — i18n via t('namespace.key')
├── tests/
│   ├── unit/       # Vitest + Testing Library
│   └── e2e/        # Playwright
supabase/
├── migrations/     # SQL migrations, timestamp ISO en nombre
└── functions/      # Edge Functions Deno
.claude/
├── TRACKING_PROGRESS.md   # Tablero vivo P0-P3, se ANEXA (nunca se reemplaza)
├── docs/
│   ├── plan_<feature>.md      # Planes de features grandes (via /strategic-plan-workflow)
│   ├── runbook_<feature>.md   # Procedimientos operativos (ej. reset de plataforma)
│   └── audit-report-*.md      # Auditorias de seguridad/performance
```

---

## Comandos de Desarrollo

```bash
# Desarrollo local
npm run dev

# Build produccion
npm run build

# Limpiar cache Vite (si aparece "Outdated Optimize Dep")
rm -rf node_modules/.vite && npm run dev

# Supabase — migraciones
supabase db push
supabase migration list
supabase migration repair --status applied [timestamp]

# Supabase — Edge Functions
supabase functions deploy nombre-funcion

# Tests unitarios (Vitest)
npm run test              # una corrida
npm run test:watch        # modo watch
npm run test:coverage     # con cobertura

# Tests E2E
npx playwright test

# CodeGraph (ya indexado — reindexar si el codigo cambio mucho)
codegraph init .
```

---

## Reglas de Commits

Conventional Commits obligatorio:

```
feat: agregar flujo de pago con Zelle
fix: corregir recursion en RLS policy de user_profiles
refactor: extraer logica de carrito a useCart hook
chore: actualizar dependencias Supabase
docs: documentar flujo WhatsApp en Vault
```

---

## Autonomy Boundaries

- **NUNCA hacer commit** sin confirmacion explicita del usuario
- **NUNCA hacer push** sin confirmacion explicita del usuario
- **NUNCA ejecutar operaciones destructivas en BD** (DROP, DELETE masivo, `apply_migration`, activar cualquier flag tipo `platform_reset_control.enabled`) sin confirmacion explicita — incluye migraciones ya revisadas: aplicarlas a Supabase remoto es una accion separada que requiere su propio "dale"
- **NUNCA exponer** claves de servicio o anon key en codigo fuente
- **`.claude/settings.json` esta trackeado en git** (a diferencia de `settings.local.json`) — nunca poner secretos, passwords o tokens ahi, ni siquiera "temporales". Si aparecen, tratar como leak real y purgar la historia con `git filter-repo` (requiere autorizacion explicita del usuario para el force-push, dado que reescribe SHAs compartidos)
- Preguntar solo cuando: scope es ambiguo, accion es destructiva/irreversible, o hay tradeoffs sin respuesta obvia

---

## Patrones Criticos

### RLS + GRANTs (ambos requeridos)
```sql
-- 1. Habilitar RLS
ALTER TABLE public.mi_tabla ENABLE ROW LEVEL SECURITY;

-- 2. GRANT al rol
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mi_tabla TO authenticated;

-- 3. Policy
CREATE POLICY "usuarios ven sus datos" ON public.mi_tabla
  FOR SELECT USING (auth.uid() = user_id);
```

### Evitar recursion RLS
Usar funciones `SECURITY DEFINER` para consultar roles sin disparar otras policies.
Ver ejemplos en `/CLAUDE.md` (raiz del proyecto).

### Operaciones concurrentes / locks
`pg_advisory_xact_lock(hashtext('namespace'))` para exclusion mutua entre operaciones del mismo dominio (ej. bulk-delete de la misma entidad, reset de plataforma). `pg_advisory_xact_lock_shared` en triggers `BEFORE INSERT` cuando se necesita que un flujo de escritura normal (checkout) espere a que termine una operacion administrativa exclusiva, sin bloquearse contra si mismo. Ver `guard_platform_reset_lock()` en `20260808000002_platform_reset.sql`.

### Cliente Supabase
Usar el cliente singleton de `src/lib/supabase.js` — no instanciar directamente.

### MCP disponibles
Supabase y Vercel estan conectados a nivel de cuenta (conectores claude.ai, `mcp__claude_ai_Supabase__*` / `mcp__claude_ai_Vercel__*`) — no requieren configuracion de proyecto, pero pueden no estar disponibles en corridas headless/cron (requieren credenciales explicitas via `.mcp.json` en ese caso, no configurado por ahora). CodeGraph esta indexado localmente en `.codegraph/` (no trackeado en git).

---

## Vault Obsidian

Documentacion del proyecto en `Vault/`. Abrir con Obsidian apuntando a esa carpeta.
