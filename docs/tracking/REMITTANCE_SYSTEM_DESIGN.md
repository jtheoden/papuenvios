# 🔄 SISTEMA COMPLETO DE REMESAS - DISEÑO Y ESPECIFICACIONES

## 📋 ÍNDICE
1. [Visión General](#visión-general)
2. [Flujo Completo del Sistema](#flujo-completo)
3. [Modelo de Base de Datos](#modelo-de-base-de-datos)
4. [Configuración de Tipos de Remesas](#configuración-admin)
5. [Panel de Usuario - Envío](#panel-usuario-envío)
6. [Panel de Usuario - Seguimiento](#panel-usuario-seguimiento)
7. [Panel de Admin - Gestión](#panel-admin-gestión)
8. [Notificaciones WhatsApp](#notificaciones-whatsapp)
9. [Estados y Transiciones](#estados-y-transiciones)
10. [Validaciones y Seguridad](#validaciones)

---

## 🎯 VISIÓN GENERAL

### Objetivo
Crear un sistema completo de gestión de remesas que permita:
- **Administradores**: Configurar tipos de remesas, tasas, validar pagos y gestionar entregas
- **Usuarios**: Enviar remesas, subir comprobantes, hacer seguimiento en tiempo real
- **Sistema**: Notificaciones automáticas, alertas de tiempo, registro de evidencias

### Características Principales
1. ✅ Configuración dinámica de tipos de remesas (monedas, tasas, métodos de pago)
2. ✅ Upload de comprobante de pago por el usuario
3. ✅ Validación de pago por admin con evidencia
4. ✅ Gestión de entrega con confirmación
5. ✅ Notificaciones WhatsApp automatizadas
6. ✅ Panel de seguimiento para usuario
7. ✅ Alertas de tiempo con código de colores
8. ✅ Sistema bilingüe (ES/EN)

---

## 🔄 FLUJO COMPLETO DEL SISTEMA

### Flujo Usuario → Admin → Usuario

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. USUARIO: Crea Remesa                                             │
│    - Selecciona tipo de remesa (moneda)                             │
│    - Ingresa monto y datos del destinatario                         │
│    - Sistema genera orden de remesa (status: payment_pending)       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. USUARIO: Sube Comprobante de Pago                                │
│    - Upload de imagen/PDF del comprobante                           │
│    - Agrega referencia/número de transacción                        │
│    - Notificación WhatsApp automática al admin                      │
│    - Status: payment_proof_uploaded                                 │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. ADMIN: Valida Pago                                               │
│    - Revisa comprobante subido                                      │
│    - Valida o rechaza el pago                                       │
│    - Si valida: status → payment_validated                          │
│    - Si rechaza: status → payment_rejected (con razón)              │
│    - Notificación WhatsApp al usuario                               │
└─────────────────────────────────────────────────────────────────────┘
                              ↓ (si validado)
┌─────────────────────────────────────────────────────────────────────┐
│ 4. ADMIN: Inicia Procesamiento                                      │
│    - Click en "Iniciar Entrega"                                     │
│    - Status: processing                                              │
│    - Se guarda timestamp: processing_started_at                     │
│    - Inicia contador de tiempo para entrega                         │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 5. ADMIN: Confirma Entrega                                          │
│    - Upload de evidencia de entrega (foto/documento)                │
│    - Ingresa detalles de entrega (quién recibió, CI, etc.)          │
│    - Status: delivered                                               │
│    - Se guarda timestamp: delivered_at                              │
│    - Notificación WhatsApp al usuario                               │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 6. ADMIN: Completa Remesa                                           │
│    - Marca como completada                                          │
│    - Status: completed                                               │
│    - Se guarda timestamp: completed_at                              │
│    - Notificación final al usuario                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 💾 MODELO DE BASE DE DATOS

### Tabla: `remittance_types`
Configuración de tipos de remesas (Admin)

```sql
CREATE TABLE remittance_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Configuración básica
  name VARCHAR(100) NOT NULL,
  currency_code VARCHAR(10) NOT NULL,          -- CUP, USD, MLC, EUR
  delivery_currency VARCHAR(10) NOT NULL,       -- Moneda en la que se entrega

  -- Tasas y comisiones
  exchange_rate DECIMAL(10, 4) NOT NULL,        -- Tasa de cambio actual
  commission_percentage DECIMAL(5, 2) DEFAULT 0, -- % de comisión
  commission_fixed DECIMAL(10, 2) DEFAULT 0,    -- Comisión fija
  min_amount DECIMAL(10, 2) NOT NULL,           -- Monto mínimo
  max_amount DECIMAL(10, 2),                    -- Monto máximo (null = sin límite)

  -- Configuración de entrega
  delivery_method VARCHAR(50) NOT NULL,         -- cash, transfer, card, pickup
  max_delivery_days INTEGER DEFAULT 3,          -- Días máximos para entrega
  warning_days INTEGER DEFAULT 2,               -- Días para mostrar warning

  -- Estado y visibilidad
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,

  -- Metadata
  description TEXT,
  icon VARCHAR(50),                             -- Nombre del ícono a usar
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Índices
CREATE INDEX idx_remittance_types_active ON remittance_types(is_active);
CREATE INDEX idx_remittance_types_currency ON remittance_types(currency_code);
```

### Tabla: `remittances`
Órdenes de remesas

```sql
CREATE TABLE remittances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_number VARCHAR(50) UNIQUE NOT NULL, -- REM-2025-0001

  -- Referencias
  user_id UUID NOT NULL REFERENCES auth.users(id),
  remittance_type_id UUID NOT NULL REFERENCES remittance_types(id),

  -- Montos y cálculos
  amount_sent DECIMAL(10, 2) NOT NULL,          -- Monto enviado
  exchange_rate DECIMAL(10, 4) NOT NULL,        -- Tasa al momento de crear
  commission DECIMAL(10, 2) NOT NULL,           -- Comisión cobrada
  amount_to_deliver DECIMAL(10, 2) NOT NULL,    -- Monto a entregar
  currency_sent VARCHAR(10) NOT NULL,           -- USD, EUR, etc.
  currency_delivered VARCHAR(10) NOT NULL,      -- CUP, USD, MLC

  -- Datos del destinatario
  recipient_name VARCHAR(200) NOT NULL,
  recipient_phone VARCHAR(20) NOT NULL,
  recipient_id_number VARCHAR(50),              -- CI del destinatario
  recipient_address TEXT,
  recipient_province VARCHAR(100),
  recipient_municipality VARCHAR(100),
  delivery_notes TEXT,

  -- Comprobante de pago (Usuario)
  payment_proof_url TEXT,                       -- URL del comprobante
  payment_reference VARCHAR(100),               -- Número de transacción
  payment_proof_uploaded_at TIMESTAMPTZ,

  -- Validación de pago (Admin)
  payment_validated BOOLEAN DEFAULT false,
  payment_validated_at TIMESTAMPTZ,
  payment_validated_by UUID REFERENCES auth.users(id),
  payment_rejection_reason TEXT,

  -- Evidencia de entrega (Admin)
  delivery_proof_url TEXT,                      -- Foto de entrega
  delivery_notes_admin TEXT,
  delivered_to_name VARCHAR(200),               -- Quién recibió
  delivered_to_id VARCHAR(50),                  -- CI de quien recibió
  delivered_at TIMESTAMPTZ,
  delivered_by UUID REFERENCES auth.users(id),

  -- Estados y timestamps
  status VARCHAR(50) NOT NULL DEFAULT 'payment_pending',
  -- Valores: payment_pending, payment_proof_uploaded, payment_validated,
  --          payment_rejected, processing, delivered, completed, cancelled

  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  cancelled_by UUID REFERENCES auth.users(id),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_remittances_user ON remittances(user_id);
CREATE INDEX idx_remittances_status ON remittances(status);
CREATE INDEX idx_remittances_number ON remittances(remittance_number);
CREATE INDEX idx_remittances_created ON remittances(created_at DESC);
```

### Tabla: `remittance_status_history`
Historial de cambios de estado

```sql
CREATE TABLE remittance_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id UUID NOT NULL REFERENCES remittances(id) ON DELETE CASCADE,

  old_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,

  changed_by UUID REFERENCES auth.users(id),
  change_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice
CREATE INDEX idx_remittance_history ON remittance_status_history(remittance_id, created_at);
```

---

## ⚙️ CONFIGURACIÓN DE TIPOS DE REMESAS (ADMIN)

### Componente: `RemittanceTypesConfig.jsx`

**Funcionalidades**:
1. ✅ Listar todos los tipos de remesas configurados
2. ✅ Crear nuevo tipo de remesa
3. ✅ Editar tipo existente
4. ✅ Activar/desactivar tipos
5. ✅ Configurar tasas de cambio
6. ✅ Configurar comisiones (% y fija)
7. ✅ Definir límites de monto
8. ✅ Configurar tiempos de entrega

**Campos del Formulario**:
```javascript
{
  name: "Remesa en Dólares a Efectivo CUP",
  currencyCode: "USD",                  // Moneda que envía el usuario
  deliveryCurrency: "CUP",              // Moneda que recibe el destinatario
  exchangeRate: 320.00,                 // 1 USD = 320 CUP
  commissionPercentage: 2.5,            // 2.5% de comisión
  commissionFixed: 0,                   // Sin comisión fija
  minAmount: 10.00,                     // Mínimo 10 USD
  maxAmount: 1000.00,                   // Máximo 1000 USD
  deliveryMethod: "cash",               // Entrega en efectivo
  maxDeliveryDays: 3,                   // Máximo 3 días
  warningDays: 2,                       // Warning si pasan 2 días
  description: "Envía USD y el destinatario recibe CUP en efectivo",
  icon: "dollar-sign"
}
```

**UI del Listado**:
```
┌──────────────────────────────────────────────────────────────┐
│ Tipos de Remesas Configurados                [+ Nuevo Tipo]  │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ 💵 USD → CUP (Efectivo)                       [Activo ✓]     │
│ Tasa: 1 USD = 320 CUP  |  Comisión: 2.5%                    │
│ Límites: $10 - $1,000  |  Entrega: 3 días                   │
│ [Editar] [Desactivar]                                        │
│                                                               │
│ 💶 EUR → CUP (Efectivo)                       [Activo ✓]     │
│ Tasa: 1 EUR = 350 CUP  |  Comisión: 3%                      │
│ Límites: €10 - €500  |  Entrega: 3 días                     │
│ [Editar] [Desactivar]                                        │
│                                                               │
│ 💳 USD → MLC (Tarjeta)                        [Inactivo]     │
│ Tasa: 1 USD = 1 MLC  |  Comisión: 5% + $2                   │
│ Límites: $20 - $2,000  |  Entrega: 2 días                   │
│ [Editar] [Activar]                                           │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 📤 PANEL DE USUARIO - ENVÍO DE REMESA

### Componente: `SendRemittancePage.jsx`

**Flujo de Envío** (4 pasos):

#### Paso 1: Seleccionar Tipo de Remesa
```
┌────────────────────────────────────────┐
│ Selecciona el tipo de remesa          │
├────────────────────────────────────────┤
│                                        │
│ ⚪ 💵 USD → CUP (Efectivo)             │
│    Tasa: 1 USD = 320 CUP              │
│    Comisión: 2.5% | Entrega: 3 días   │
│                                        │
│ ⚪ 💶 EUR → CUP (Efectivo)             │
│    Tasa: 1 EUR = 350 CUP              │
│    Comisión: 3% | Entrega: 3 días     │
│                                        │
│ ⚪ 💳 USD → MLC (Tarjeta)              │
│    Tasa: 1:1 | Comisión: 5% + $2      │
│    Entrega: 2 días                     │
│                                        │
│         [Continuar →]                  │
└────────────────────────────────────────┘
```

#### Paso 2: Ingresar Monto
```
┌────────────────────────────────────────┐
│ ¿Cuánto deseas enviar?                 │
├────────────────────────────────────────┤
│                                        │
│ Monto a enviar:                        │
│ ┌──────────────┐                      │
│ │ $  [____100] │ USD                  │
│ └──────────────┘                      │
│                                        │
│ ┌─────────────────────────────────┐   │
│ │ Detalles del cálculo:           │   │
│ │ Monto:         $100.00 USD      │   │
│ │ Tasa:          320 CUP/USD      │   │
│ │ Comisión:      -$2.50 (2.5%)    │   │
│ │ ─────────────────────────────   │   │
│ │ A recibir:     31,200 CUP       │   │
│ └─────────────────────────────────┘   │
│                                        │
│    [← Atrás]     [Continuar →]        │
└────────────────────────────────────────┘
```

#### Paso 3: Datos del Destinatario
```
┌────────────────────────────────────────┐
│ Datos del destinatario                 │
├────────────────────────────────────────┤
│                                        │
│ Nombre completo *                      │
│ [_____________________________]        │
│                                        │
│ Teléfono *                             │
│ [+53 _____________________]            │
│                                        │
│ Número de CI (opcional)                │
│ [_____________________________]        │
│                                        │
│ Provincia *                            │
│ [▼ Seleccionar provincia_____]         │
│                                        │
│ Municipio *                            │
│ [▼ Seleccionar municipio_____]         │
│                                        │
│ Dirección (opcional)                   │
│ [_____________________________]        │
│ [_____________________________]        │
│                                        │
│ Notas adicionales (opcional)           │
│ [_____________________________]        │
│ [_____________________________]        │
│                                        │
│    [← Atrás]     [Crear Remesa]       │
└────────────────────────────────────────┘
```

#### Paso 4: Subir Comprobante de Pago
(Después de crear la remesa)

```
┌────────────────────────────────────────┐
│ Subir Comprobante de Pago              │
├────────────────────────────────────────┤
│                                        │
│ Remesa: REM-2025-0001                  │
│ Monto: $100 USD → 31,200 CUP          │
│                                        │
│ ┌────────────────────────────────┐    │
│ │   📎 Arrastra aquí tu          │    │
│ │      comprobante de pago       │    │
│ │                                │    │
│ │   o haz click para seleccionar │    │
│ │                                │    │
│ │   PNG, JPG, PDF (Max 5MB)      │    │
│ └────────────────────────────────┘    │
│                                        │
│ Número de referencia (opcional)        │
│ [_____________________________]        │
│                                        │
│ ⚠️ Tu remesa será validada por un     │
│ administrador en las próximas horas    │
│                                        │
│         [Subir Comprobante]            │
└────────────────────────────────────────┘
```

---

## 📊 PANEL DE USUARIO - SEGUIMIENTO

### Componente: `MyRemittancesPage.jsx`

**Vista Principal**:
```
┌──────────────────────────────────────────────────────────────┐
│ Mis Remesas                                   [+ Nueva Remesa]│
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ 🔵 REM-2025-0003                              [Ver Detalles] │
│ $100 USD → 31,200 CUP | Destinatario: Juan Pérez            │
│ Estado: En procesamiento 🚚                                  │
│ Validado hace: 2 horas | Entrega máxima: en 22 horas ⏰      │
│ ─────────────────────────────────────────────────────────────│
│                                                               │
│ 🟡 REM-2025-0002                              [Subir Pago]   │
│ €50 EUR → 17,500 CUP | Destinatario: María García           │
│ Estado: Esperando comprobante de pago 📄                     │
│ Creado hace: 1 día                                           │
│ ─────────────────────────────────────────────────────────────│
│                                                               │
│ 🟢 REM-2025-0001                              [Ver Detalles] │
│ $200 USD → 62,400 CUP | Destinatario: Carlos López          │
│ Estado: Entregado ✅                                         │
│ Entregado hace: 3 días | A tiempo ✓                         │
│ ─────────────────────────────────────────────────────────────│
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

**Modal de Detalles**:
```
┌──────────────────────────────────────────────────┐
│ Detalles de Remesa - REM-2025-0003         [✕]  │
├──────────────────────────────────────────────────┤
│                                                   │
│ 📊 Estado Actual: En procesamiento 🚚           │
│                                                   │
│ ┌───────────────────────────────────────────┐   │
│ │ Timeline:                                  │   │
│ │ ✅ Creada - 12 Oct 10:00 AM                │   │
│ │ ✅ Pago validado - 12 Oct 2:00 PM          │   │
│ │ 🔵 En procesamiento - 12 Oct 3:00 PM       │   │
│ │ ⏳ Pendiente entrega                        │   │
│ │ ⏳ Pendiente completar                      │   │
│ └───────────────────────────────────────────┘   │
│                                                   │
│ 💵 Información Financiera:                       │
│ Enviado: $100.00 USD                             │
│ Tasa: 1 USD = 320 CUP                           │
│ Comisión: $2.50                                  │
│ A recibir: 31,200.00 CUP                        │
│                                                   │
│ 👤 Destinatario:                                 │
│ Juan Pérez González                              │
│ Tel: +53 5 234 5678                             │
│ CI: 92051234567                                  │
│ La Habana, Plaza de la Revolución               │
│                                                   │
│ ⏰ Tiempos:                                      │
│ Validado hace: 2 horas 15 minutos               │
│ Tiempo en procesamiento: 1 hora                 │
│ Entrega máxima en: 22 horas ⏰ (NORMAL)         │
│                                                   │
│ 📎 Comprobante de pago: [Ver imagen]            │
│                                                   │
│            [Cerrar]                               │
└──────────────────────────────────────────────────┘
```

**Código de Colores para Alertas**:
- 🟢 Verde: Entregado a tiempo
- 🔵 Azul: En procesamiento, dentro del tiempo normal
- 🟡 Amarillo: Warning - Se acerca el plazo máximo
- 🔴 Rojo: Alerta - Plazo excedido

---

## 🛠️ PANEL DE ADMIN - GESTIÓN DE REMESAS

### Componente: `AdminRemittancesTab.jsx`

**Vista Principal**:
```
┌────────────────────────────────────────────────────────────────────┐
│ Gestión de Remesas                                                 │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 📊 Estadísticas                                                    │
│ ┌────────┬────────┬────────┬────────┬────────┬────────┐         │
│ │ Total  │Pendient│Validada│Proceso │Entregad│Completa│         │
│ │   45   │   8    │   12   │   15   │   7    │   3    │         │
│ └────────┴────────┴────────┴────────┴────────┴────────┘         │
│                                                                     │
│ 🔍 Filtros:  [Estado▼] [Tipo▼] [Usuario]  [📅 Fecha]  [Aplicar]  │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 🟡 REM-2025-0005                                    [Validar Pago] │
│ Usuario: Ana Rodríguez | $150 USD → 48,000 CUP                   │
│ Estado: Comprobante subido hace 30 min ⏰                         │
│ Destinatario: Pedro Martínez | La Habana                          │
│ [Ver Comprobante] [Detalles]                                      │
│ ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│ 🔵 REM-2025-0004                                    [Marcar Entregado]│
│ Usuario: Luis García | €80 EUR → 28,000 CUP                      │
│ Estado: En procesamiento (hace 4 horas) ⚠️                        │
│ Destinatario: Carmen López | Santiago de Cuba                     │
│ [Iniciar Entrega] [Cancelar]                                      │
│ ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│ 🟢 REM-2025-0003                                    [Ver Detalles] │
│ Usuario: José Fernández | $200 USD → 62,400 CUP                  │
│ Estado: Entregado ✅ (hace 2 días)                                 │
│ Destinatario: María Sánchez | Matanzas                            │
│ [Completar] [Ver Evidencia]                                       │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

**Modal: Validar Pago**:
```
┌───────────────────────────────────────────────┐
│ Validar Pago - REM-2025-0005             [✕] │
├───────────────────────────────────────────────┤
│                                                │
│ Usuario: Ana Rodríguez                         │
│ Monto: $150 USD → 48,000 CUP                  │
│                                                │
│ Comprobante subido:                            │
│ ┌──────────────────────────────────────┐      │
│ │                                       │      │
│ │     [Imagen del comprobante]          │      │
│ │                                       │      │
│ │                                       │      │
│ └──────────────────────────────────────┘      │
│ [🔍 Ver en tamaño completo]                    │
│                                                │
│ Referencia: TRF-2025-1234567                  │
│                                                │
│ ¿Validar este pago?                            │
│                                                │
│ [ ] Rechazar (proporcionar razón)             │
│                                                │
│    [Cancelar]  [✓ Validar Pago]               │
└───────────────────────────────────────────────┘
```

**Modal: Confirmar Entrega**:
```
┌───────────────────────────────────────────────┐
│ Confirmar Entrega - REM-2025-0004        [✕] │
├───────────────────────────────────────────────┤
│                                                │
│ Destinatario: Carmen López                     │
│ Monto entregado: 28,000 CUP                   │
│                                                │
│ Evidencia de entrega:                          │
│ ┌──────────────────────────────────────┐      │
│ │   📸 Subir foto de evidencia         │      │
│ │                                       │      │
│ │   Click para seleccionar o           │      │
│ │   arrastra aquí                       │      │
│ └──────────────────────────────────────┘      │
│                                                │
│ Entregado a:                                   │
│ [Carmen López________________] (nombre)        │
│                                                │
│ CI de quien recibe:                            │
│ [92051234567________________]                  │
│                                                │
│ Notas adicionales:                             │
│ [_________________________________]            │
│ [_________________________________]            │
│                                                │
│    [Cancelar]  [✓ Confirmar Entrega]          │
└───────────────────────────────────────────────┘
```

---

## 📱 NOTIFICACIONES WHATSAPP

### Gatillos de Notificación

#### 1. Usuario sube comprobante → Admin
```javascript
{
  to: ADMIN_WHATSAPP,
  message: `
🔔 *Nueva remesa con comprobante*

📝 Remesa: REM-2025-0005
👤 Usuario: Ana Rodríguez
💵 Monto: $150 USD → 48,000 CUP
📄 Comprobante subido hace: 5 minutos

🔗 Ver en panel: [LINK]
  `
}
```

#### 2. Admin valida pago → Usuario
```javascript
{
  to: USER_PHONE,
  message: `
✅ *Tu pago ha sido validado*

📝 Remesa: REM-2025-0005
💵 Monto: $150 USD → 48,000 CUP
👤 Destinatario: Carmen López

📦 Tu remesa está siendo procesada
⏰ Entrega estimada: 2-3 días

🔗 Ver estado: [LINK]
  `
}
```

#### 3. Admin rechaza pago → Usuario
```javascript
{
  to: USER_PHONE,
  message: `
❌ *Pago rechazado*

📝 Remesa: REM-2025-0005
❌ Razón: El comprobante no es legible

ℹ️ Por favor, sube un nuevo comprobante

🔗 Subir nuevo: [LINK]
  `
}
```

#### 4. Admin confirma entrega → Usuario
```javascript
{
  to: USER_PHONE,
  message: `
🎉 *Remesa entregada exitosamente*

📝 Remesa: REM-2025-0005
💵 Monto: 48,000 CUP
👤 Recibido por: Carmen López

📸 Ver evidencia: [LINK]

✅ Tu remesa ha sido completada
  `
}
```

#### 5. Alerta de tiempo → Admin
```javascript
{
  to: ADMIN_WHATSAPP,
  message: `
⚠️ *Remesa cerca del plazo límite*

📝 Remesa: REM-2025-0004
⏰ En procesamiento hace: 2 días 20 horas
⚠️ Plazo máximo: 3 días

👤 Destinatario: Carmen López
📍 Santiago de Cuba

🔗 Ver remesa: [LINK]
  `
}
```

---

## 🔄 ESTADOS Y TRANSICIONES

### Estados Posibles

```javascript
const REMITTANCE_STATUS = {
  PAYMENT_PENDING: 'payment_pending',           // Esperando pago
  PAYMENT_PROOF_UPLOADED: 'payment_proof_uploaded', // Comprobante subido
  PAYMENT_VALIDATED: 'payment_validated',       // Pago validado por admin
  PAYMENT_REJECTED: 'payment_rejected',         // Pago rechazado
  PROCESSING: 'processing',                     // En procesamiento
  DELIVERED: 'delivered',                       // Entregado
  COMPLETED: 'completed',                       // Completado
  CANCELLED: 'cancelled'                        // Cancelado
};
```

### Diagrama de Transiciones

```
payment_pending
       ↓
payment_proof_uploaded
       ↓
   ┌───┴───┐
   ↓       ↓
payment_  payment_
validated rejected
   ↓
processing
   ↓
delivered
   ↓
completed
```

### Permisos por Estado

| Estado | Usuario puede | Admin puede |
|--------|--------------|-------------|
| payment_pending | Subir comprobante, Cancelar | Ver, Cancelar |
| payment_proof_uploaded | Ver, Cancelar | Validar, Rechazar |
| payment_validated | Ver | Iniciar procesamiento |
| payment_rejected | Subir nuevo comprobante | Ver |
| processing | Ver | Marcar entregado, Cancelar |
| delivered | Ver | Completar |
| completed | Ver evidencia | Ver |
| cancelled | Ver | Ver |

---

## 🔒 VALIDACIONES Y SEGURIDAD

### Validaciones de Negocio

1. **Creación de Remesa**:
   - ✅ Monto dentro de límites (min/max)
   - ✅ Tipo de remesa activo
   - ✅ Todos los datos del destinatario completos
   - ✅ Usuario autenticado

2. **Upload de Comprobante**:
   - ✅ Solo el usuario propietario
   - ✅ Solo si status = payment_pending
   - ✅ Formato válido (imagen/PDF)
   - ✅ Tamaño máximo 5MB

3. **Validación de Pago (Admin)**:
   - ✅ Solo admin/super_admin
   - ✅ Solo si status = payment_proof_uploaded
   - ✅ Razón obligatoria si rechaza

4. **Confirmar Entrega (Admin)**:
   - ✅ Solo admin/super_admin
   - ✅ Solo si status = processing
   - ✅ Evidencia obligatoria
   - ✅ Nombre y CI de quien recibe obligatorios

### RLS Policies

```sql
-- Los usuarios solo ven sus propias remesas
CREATE POLICY "Users can view own remittances"
ON remittances FOR SELECT
USING (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- Solo admins pueden actualizar remesas
CREATE POLICY "Only admins can update remittances"
ON remittances FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);
```

---

## 📝 PRÓXIMOS PASOS DE IMPLEMENTACIÓN

### Fase 1: Base de Datos
- [ ] Crear migración SQL con todas las tablas
- [ ] Crear RLS policies
- [ ] Crear índices optimizados
- [ ] Crear función para generar remittance_number

### Fase 2: Backend (Services)
- [ ] Actualizar remittanceService.js con todas las funciones
- [ ] Crear remittanceAdminService.js para operaciones admin
- [ ] Integrar con whatsappService.js para notificaciones
- [ ] Crear helpers de validación

### Fase 3: UI - Admin
- [ ] RemittanceTypesConfig.jsx (configuración)
- [ ] AdminRemittancesTab.jsx (gestión)
- [ ] Modales de validación y entrega
- [ ] Dashboard con estadísticas

### Fase 4: UI - Usuario
- [ ] SendRemittancePage.jsx (envío)
- [ ] MyRemittancesPage.jsx (seguimiento)
- [ ] Modal de subida de comprobante
- [ ] Modal de detalles

### Fase 5: Integraciones
- [ ] Notificaciones WhatsApp automáticas
- [ ] Alertas de tiempo
- [ ] Sistema de evidencias (Storage)
- [ ] Generación de reportes

### Fase 6: Testing
- [ ] Test end-to-end del flujo completo
- [ ] Test de validaciones
- [ ] Test de notificaciones
- [ ] Test de permisos (RLS)

---

**Fecha**: 2025-10-13
**Estado**: Diseño completo ✅
**Próximo**: Implementación de base de datos
