# Project Intake — PapuEnvios

## Identity
1. **Project name**: PapuEnvios
2. **Description**: Plataforma eCommerce para envío de remesas a Cuba y compra de artículos. Permite a emigrantes cubanos en USA enviar dinero o comprar productos ubicados en Cuba para que lleguen a sus familiares.
3. **Project type**: Nuevo producto (brownfield — codebase existente en producción)
4. **Status**: Brownfield

## Goals
4. **Primary goal**: Permitir que personas en el exterior (especialmente USA) puedan enviar remesas o realizar compras desde USA con entrega de productos en Cuba a sus familias.
5. **Success metric**: Tasa de conversión > 3%, carga de página < 2s
6. **Non-goals**: Unknown por ahora

## Users
7. **Primary user**: Emigrantes cubanos desde USA o ciudadanos vinculados a personas residentes en Cuba. Nivel técnico variado, mayoritariamente no técnico.
8. **Expected scale**: Mínimo 30 usuarios/mes, pico de 5 concurrentes

## Business Context
9. **Business model**: Herramienta de una sola empresa (single-vendor eCommerce)
10. **Deadline**: Ya alcanzado (listo para lanzamiento público)
11. **Team size**: 1 desarrollador + 4 administrativos

## Tech Stack
12. **Backend**: Supabase (PostgreSQL + Edge Functions)
13. **Frontend**: React + TypeScript (Vite)
14. **Database**: PostgreSQL 15 via Supabase
15. **Deployment**: Vercel (frontend) + Supabase (backend/DB)

## Constraints & Compliance
16. **Compliance**: Unknown — potencialmente PCI para pagos, GDPR-like para datos de usuarios
17. **Accessibility**: Unknown
18. **Budget**: Sin presupuesto definido; si aumenta el tráfico se requeriría diseñar uno para mantener el servicio activo

## Integrations & Risk
19. **External APIs**: Unknown (posiblemente Zelle para pagos — detectado en DB)
20. **Technical debt / risks**: Codebase brownfield con RLS aplicado, security hardening realizado Feb 2026
21. **Previous failed attempts**: Unknown
