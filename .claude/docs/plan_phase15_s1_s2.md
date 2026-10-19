# Plan Fase 1.5 — S1 (CHECKs de dinero) y S2 (guard de precios de remesas)

- Fecha: 2026-10-17. Base: `origin/main` @ `aa8d5f25`. Insumo: `audit_phase1_price_tamper.md` (rama `docs/audit-phase1-price-tamper`).
- Estado: PREPARADO, NO APLICADO. Ninguna escritura ni migración remota; en producción solo `SELECT` (MCP).
- Migraciones: `20261017100000_phase15_s1_money_checks.sql`, `20261017110000_phase15_s2_remittance_pricing_guard.sql`.
- Tests: `src/tests/concurrency/phase15S1MoneyChecks.test.js`, `phase15S2RemittancePricingGuard.test.js`, `src/tests/unit/orderTotalsCentIdentity.test.js`.

## 1. Qué se decidió

**S1 (P1 de la auditoría).** 13 CHECKs aditivos (6 en `orders`, 7 en `remittances`), todos con `COALESCE(col,0)` en las columnas nullable (`discount_amount`, `shipping_cost`, `tax_amount`, `remittances.discount_amount`). No se usa `SET NOT NULL` (rompería a cualquier escritor que envíe NULL explícito y reescribe la tabla). Se añaden `NOT VALID` y se validan en el mismo archivo; si una fila histórica viola, queda `NOT VALID` con un WARNING (sigue rechazando INSERT/UPDATE nuevos). `order_items` NO se toca: sus CHECKs son T-01/P2, fuera de P1.

- Identidad del total con tolerancia de 0.01 (no igualdad exacta): el cliente redondea cada componente a centavos (barrido de 3000+ combinaciones en `orderTotalsCentIdentity.test.js`, deriva máxima <= 0.01), pero la tolerancia evita que un caso de descuentos apilados rompa un checkout real. Ganancia máxima del atacante: 1 centavo.
- `total_amount > 0`, `subtotal > 0`, `tax >= 0`, `shipping >= 0`, `0 <= discount <= subtotal`.
- Remesas: `amount_sent > 0`, `amount_to_deliver > 0`, `exchange_rate > 0`, `commission_total >= 0`, `commission_fixed >= 0`, `0 <= commission_percentage <= 100`, `COALESCE(discount_amount,0) >= 0`.

**S2 (P3 de la auditoría).** Trigger `guard_remittance_pricing` BEFORE INSERT en `remittances` + interruptor `system_config.remittance_pricing_guard_mode` (`off|warn|block`, arranca en `warn`; valor faltante o inválido = `warn`) + tabla `price_integrity_flags` (admin-only, sin grants, sin FK, fuera de realtime) para que `warn` sea observable + RPC `set_remittance_pricing_guard_mode` (solo super_admin, deja log en `activity_logs`).

- Reglas bloqueantes (en `block`; en `warn` se registran): tipo activo, moneda del tipo y monedas activas, `min/max` del tipo, `exchange_rate <= tasa_resuelta * 1.0005` (misma moneda = 1 evaluada primero), `amount_to_deliver <= (sent - commission_total) * rate + 0.0125*rate + 0.0001*sent + 0.02`, comisión no negativa.
- Regla solo-bandera (nunca bloquea): `commission_below_floor` (falla en REM-2026-001111 y 001113).
- `SECURITY DEFINER` justificado: debe leer `system_config` (RLS admin-only) y escribir la tabla de banderas (sin grants). El bypass NO usa `current_user` (dentro de DEFINER es el owner y dejaría pasar a todos): usa `auth.uid() IS NULL`, `is_admin_user()`, `is_super_admin()` y el GUC `role` (`service_role/postgres/supabase_admin`). `search_path = public, pg_temp`; `REVOKE` explícito a `PUBLIC, anon, authenticated` (verificado con `has_function_privilege`).
- Error uniforme `remittance_pricing_rejected` (SQLSTATE 23514, sin DETAIL/HINT): no filtra tasas, límites ni comisiones.
- Orden de disparo: `guard_payment_method_enabled`, `guard_remittance_owner_insert`, **`guard_remittance_pricing`**, `guard_reset_lock_remittances`, `trigger_generate_remittance_number`. No se toca el sellado Bizum S5a (es de `orders`).
- Quién crea remesas: único escritor = `remittanceService.createRemittance` (el admin usa el mismo código con su propio `user_id`; ninguna función SQL ni Edge Function inserta remesas). Por eso admin/super_admin/service_role se mantienen exentos, igual que `guard_remittance_owner_insert`.

### Contrato de redondeo observado (NO se cambia; cambiarlo requiere dale del dueño)
El cliente calcula en floats JS y envía valores sin redondear (`amount_sent` crudo, comisión sin redondear, `amount_to_deliver = amount*rate - comm*rate`); Postgres redondea cada columna a su escala (2 dp; tasa 4 dp). El `amount_to_deliver` guardado puede superar `(sent_guardado - comm_guardada) * rate` hasta ~`0.005*rate` por cada insumo redondeado (~8 CUP a 800; ejemplo real REM-2026-001125: 765 / 19.13 / 596700 vs 596696). La cota añade `0.0125*rate` (10 CUP a 800) de holgura: ganancia máxima del atacante ~0.0125 USD por remesa. El modo inverso termina en el mismo cálculo directo (`createRemittance` siempre llama `calculateRemittance`), por eso no necesita holgura propia (vector de 80000 CUP fijado en test).

## 2. Verificaciones en producción (SELECT, 2026-10-17)

- `orders`: 31 filas, 0 violaciones de los 6 predicados, 0 NULL en discount/shipping/tax.
- `remittances`: **27 filas** (la auditoría decía 24), 0 violaciones de los 7 predicados, 0 NULL en `discount_amount`, 0 comisiones negativas.
- Predicados de S2 corridos tal cual contra las 27: moneda/tipo 0, límites 0, tasa 0, cota de entrega 0 (holgura mínima 0.04), comisión negativa 0, piso de comisión 2 (001111, 001113).
- `currencies` USD/CUP/EUR todas activas. `remittance_types`: 4 (2 activos: CUP efectivo 800/2.5%; USD>USD 105 con misma moneda = 1). Ninguna clave `remit*/guard*/integrity*` en `system_config`; `price_integrity_flags` no existe.
- Triggers BEFORE INSERT de `remittances` en prod = los del replay local.

## 3. Resultados de tests (local)

- Rojo inicial S1: 22 de 28 fallaban (los 6 verdes son los casos legítimos que ya pasaban). Rojo inicial S2: 32 de 34 fallaban.
- Verde final S1 28/28, S2 34/34. Re-aplicación idempotente y up → down → up comprobados con `psql` sobre la BD de prueba.
- Cambios obligados en tests existentes (consecuencia directa): `zelleCharacterization` (lista de triggers de remesas incluye el nuevo; el UPDATE de admin mueve `subtotal` junto con el total por la identidad), `rateFunctionsAndConstraints` (excluye de su regla "migraciones posteriores no mencionan exchange_rates" a S2, que solo la LEE).

## 4. Abogado del diablo

| # | Objeción | Veredicto / mitigación |
|---|---|---|
| D-1 | `warn` por defecto deja T-07 abierto: solo se registra. | Válida y deliberada. Es el único modo seguro de arrancar sin datos de tráfico real. Recomendación: observar `price_integrity_flags` unos días y pasar a `block` con `set_remittance_pricing_guard_mode('block')`; los CHECKs de S1 sí bloquean desde el día 1. |
| D-2 | Falsos positivos sobre clientes reales (bundle cacheado, tasa cambiada entre pantalla y confirmación). | Rechazo solo si la tasa favorece al cliente por >0.05%; tasa menor siempre pasa. Los 27 históricos pasan. Riesgo residual: el error es genérico (sin `rate_changed`), el usuario ve un error de BD; mejora de UX queda para el front. |
| D-3 | `total_amount > 0` bloquea un pedido legítimo de 100 % de descuento + envío gratis. | Válida. Hoy 0 ofertas activas y 0 pedidos con oferta. Si aparece esa oferta, pasar a `>= 0` (DROP/ADD de un CHECK). |
| D-4 | La tolerancia 0.01 en la identidad y los 0.0125*rate de la cota regalan margen. | Sí, acotado: 1 centavo por pedido y ~0.0125 USD por remesa; ruido frente al riesgo de rechazar un checkout legítimo. |
| D-5 | Piso de comisión solo-bandera: un atacante envía comisión 0 y el cálculo de entrega la acepta (la cota usa la comisión enviada). | Válida y heredada de la auditoría (aceptada). Pérdida = la comisión (~2.5 %) por remesa, sin techo multiplicador. Se cierra con F4a o cuando se arregle la causa de 001111/001113 y se pase el piso a bloqueante. Queda bandera para revisión. |
| D-6 | En `block` el intento rechazado no deja bandera (el INSERT hace rollback con ella). | Cierto; visible solo en logs de Postgres/API. Alternativa (dblink/transacción autónoma) es más superficie; no se justifica ahora. |
| D-7 | SECURITY DEFINER amplía superficie. | Imprescindible (leer `system_config`, escribir banderas). Mitigado: `search_path` fijo, EXECUTE revocado, bypass sin `current_user`, test de la matriz de roles (cliente rechazado en `block`; admin/super_admin/service_role/postgres aceptados sin bandera). |
| D-8 | Tipos con tasa 0 en `remittance_types` romperían la resolución de tasa del servidor frente a la del cliente. | Hoy ningún tipo activo la tiene (precondición a re-verificar antes de aplicar). Con tasa 0 el servidor usa par directo/inverso de `exchange_rates`; sin par, omite la regla y registra `rate_unresolvable`. |
| D-9 | Un admin cambia la tasa del tipo: remesas en curso con la tasa vieja. | Tasa menor pasa; tasa mayor se rechaza (en `block`) y se registra (en `warn`). Comportamiento deseado. |
| D-10 | La tabla de banderas no la limpia `execute_platform_reset`. | Sin FK, no bloquea el reset; limpiarla exige modificar una función DEFINER (otro dale). Banderas huérfanas son inofensivas. |
| D-11 | CHECKs sobre `orders` también aplican a UPDATE: staff ya no puede dejar un pedido con total incoherente. | Intencional; costó actualizar un test de caracterización. Si hubiese ajustes manuales legítimos, deben mover subtotal/descuento a la vez. |
| D-12 | `NOT VALID` que no valida deja un CHECK a medias. | El archivo valida si puede; si falla, avisa con WARNING y sigue protegiendo lo nuevo. Hoy 0 violaciones, así que se valida entero. |

## 5. Orden de aplicación y qué necesita "dale"

1. Re-ejecutar en producción los SELECT de las cabeceras (0 violaciones y tipos activos con `exchange_rate > 0`).
2. **Dale 1**: aplicar S1 (`20261017100000`). Reversible con los 13 `DROP CONSTRAINT` de la cabecera.
3. **Dale 2**: aplicar S2 (`20261017110000`) en modo `warn` (queda así por defecto).
4. Observar `price_integrity_flags` (service_role / SQL) con tráfico real.
5. **Dale 3** (decisión del dueño): `SELECT set_remittance_pricing_guard_mode('block')` (o `off` para apagar). No requiere migración.
6. Pendiente aparte, cada uno con su dale: contrato de redondeo (D-04 de la auditoría), limpieza de banderas en `execute_platform_reset`, piso de comisión bloqueante, P2/P4/P5 y F4a.
