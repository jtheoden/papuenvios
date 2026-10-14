
## 🆕 Backlog — Observaciones del cliente "To Build Better Web" (2026-10-12)

Origen: `tO BUILD BETTER WEB.docx` (12 observaciones) analizado con `/strategic-plan-workflow` contra código y BD viva. Plan: `.claude/docs/plan_client-observations-to-build-better-web.md`. Receta de ejecución por PR: `.claude/docs/master-prompt-client-observations-backlog.md`. **Nada implementado todavía; solo planificación.**

Resultado: 12 observaciones → 8 frentes. Ninguna rechazada. #8 se implementa sin persistir CUP y #12 con la interpretación B, ambas con impacto económico justificado en el plan. Hallazgos nuevos no pedidos por el cliente: carrito cobra margen global y no `final_price` (PR-00, dinero real) y registro de actividad roto por un GRANT revocado (PR-01).

Decisiones resueltas por el usuario (2026-10-13): D1 enlace manual de WhatsApp, F4-C cerrado · D2 el costo de entrega se suma · D3 regla #12 interpretación B · D4 el % global no re-precia · D5 el carrito cobra `final_price` · D6 teléfono del pagador ahora (el RPC `create_order` de Corte 3 no existe; el futuro RPC debe aceptar `p_payer_phone`) · D7 Zelle opción D con `show_email`/`show_phone` independientes y al menos uno visible · D8 cada PR desde `origin/main` fresco (la rama de auditoría ya está fusionada por el PR #53).

| # | PR | Frente | Obs. | Estado | Depende de |
|---|---|---|---|---|---|
| 1 | PR-01 | GRANT `redact_pii_jsonb` + lectura admin-only de `activity_logs` | #4 | IMPLEMENTADO (`fix/pr-01-redact-pii-grant`, `0f90679a`, sin push) y APLICADO al remoto 2026-10-13 vía `apply_migration`; falta confirmar en UI que aparezcan logs de remesas | — |
| 2 | PR-00 | Carrito cobra `final_price` | #9/#11 | IMPLEMENTADO (`fix/pr-00-cart-final-price`, `3c37a251`, sin push) | — |
| 3 | PR-02 | Vaciar carrito | #7 | IMPLEMENTADO (`feat/pr-02-clear-cart`, `9380b8fd`, sin push) | PR-00 |
| 4 | PR-03 | Moneda del precio base | #1,#8,#10 | LISTO (#1 pide el texto exacto del error) | PR-00 recomendado |
| 5 | PR-04 | Aviso al admin por enlace manual (definitivo) | #4 | IMPLEMENTADO (`feat/pr-04-remittance-admin-notice`, `7ae85945`, sin push) | — |
| 6 | PR-05 | Teléfono destinatario + municipio (admin) | #2 | IMPLEMENTADO (`feat/pr-05-recipient-contact-admin-view`, `13a2fb57`, sin push) | PR-04 |
| 7 | PR-06a | Teléfono del pagador (remesas) | #3 | IMPLEMENTADO (`feat/pr-06a-payer-phone-remittances`, `8c4d228c`, sin push; migración sin aplicar) | PR-05 |
| 8 | PR-06b | Teléfono del pagador (pedidos) | #3 | IMPLEMENTADO (`feat/pr-06b-payer-phone-orders`, `34e14454`, sin push; requiere migración de PR-06a aplicada) | PR-06a |
| 9 | PR-07 | Márgenes globales en BD | #9 | IMPLEMENTADO (`feat/pr-07-global-margins-db`, `d72f3a8c`, sin push; migración sin aplicar) | PR-00 |
| 10 | PR-08 | Regla municipio⇒provincia (B) | #12 | IMPLEMENTADO (`feat/pr-08-shipping-zone-rules`, `371e39d9`, sin push) | PR-00 |
| 11 | PR-09 | Costo de entrega en remesas (se suma) | #6 | IMPLEMENTADO sin trigger (`feat/pr-09-remittance-delivery-cost`, `93cfc15b`, sin push; migración sin aplicar) | PR-08 |
| 12 | PR-10 | Visibilidad Zelle (D, toggles independientes) | #5 | LISTO (commitear antes los cambios locales de `zelleService.js`) | — |
| 13 | PR-11 | Margen por categoría | #11 | LISTO | PR-03, PR-07 |
| — | F4-C | Aviso server-side | #4 | CERRADO por D1 | — |

Carga estimada: ~2 700–3 200 líneas en 13 PRs, 5 migraciones aditivas (cada `db push` con su propio "dale"). Solo PR-09 roza el umbral de 400 líneas.
