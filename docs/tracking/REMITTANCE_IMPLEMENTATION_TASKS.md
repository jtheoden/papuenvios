# 📋 TAREAS PENDIENTES - IMPLEMENTACIÓN SISTEMA DE REMESAS

## 🎯 RESUMEN DEL PROGRESO

### ✅ COMPLETADO (Sesión Actual)
1. ✅ Análisis completo de la estructura del proyecto
2. ✅ Reorganización de archivos de documentación en `/docs`
3. ✅ Diseño completo del sistema de remesas ([REMITTANCE_SYSTEM_DESIGN.md](REMITTANCE_SYSTEM_DESIGN.md))
4. ✅ Migración SQL completa ([remittance_system_migration.sql](../migrations/remittance_system_migration.sql))
5. ✅ Commit de cambios a GitHub

### ⏳ PENDIENTE (Por Implementar)

---

## 📦 FASE 1: BACKEND - SERVICIOS

### 1.1 Actualizar `/src/lib/remittanceService.js`

**Estado Actual**: Servicio básico con funciones stub
**Objetivo**: Implementar funciones completas para manejo de remesas

**Funciones a Implementar**:

```javascript
// ========================================
// REMITTANCE TYPES (Admin)
// ========================================

/**
 * Obtener todos los tipos de remesas (Admin)
 */
export const getAllRemittanceTypes = async () => {
  // Query: SELECT * FROM remittance_types ORDER BY display_order
  // Returns: { success, types, error }
}

/**
 * Obtener tipos activos (Usuario)
 */
export const getActiveRemittanceTypes = async () => {
  // Query: SELECT * FROM remittance_types WHERE is_active = true
  // Returns: { success, types, error }
}

/**
 * Crear tipo de remesa (Admin)
 */
export const createRemittanceType = async (typeData) => {
  // INSERT INTO remittance_types
  // Returns: { success, type, error }
}

/**
 * Actualizar tipo de remesa (Admin)
 */
export const updateRemittanceType = async (typeId, updates) => {
  // UPDATE remittance_types SET ... WHERE id = typeId
  // Returns: { success, type, error }
}

/**
 * Eliminar tipo de remesa (Super Admin)
 */
export const deleteRemittanceType = async (typeId) => {
  // DELETE FROM remittance_types WHERE id = typeId
  // Returns: { success, error }
}

// ========================================
// REMITTANCES - Usuario
// ========================================

/**
 * Crear nueva remesa
 */
export const createRemittance = async (remittanceData) => {
  /**
   * Validaciones:
   * - Tipo de remesa existe y está activo
   * - Monto dentro de límites (min/max)
   * - Calcular comisión y monto a entregar
   * - Datos del destinatario completos
   *
   * INSERT INTO remittances
   * Returns: { success, remittance, error }
   */
}

/**
 * Subir comprobante de pago
 */
export const uploadPaymentProof = async (remittanceId, file, reference, notes) => {
  /**
   * 1. Upload file to Supabase Storage: remittance-proofs/{user_id}/{remittance_number}.ext
   * 2. UPDATE remittances SET
   *      payment_proof_url = url,
   *      payment_reference = reference,
   *      payment_proof_notes = notes,
   *      payment_proof_uploaded_at = NOW(),
   *      status = 'payment_proof_uploaded'
   * 3. Trigger WhatsApp notification to admin
   * Returns: { success, remittance, error }
   */
}

/**
 * Obtener mis remesas
 */
export const getMyRemittances = async (filters = {}) => {
  /**
   * Query con filtros:
   * - status
   * - dateFrom, dateTo
   * - Ordenar por created_at DESC
   *
   * Returns: { success, remittances, error }
   */
}

/**
 * Obtener detalle de una remesa
 */
export const getRemittanceDetails = async (remittanceId) => {
  /**
   * Query con JOIN a remittance_types y user_profiles
   * Include status history
   * Returns: { success, remittance, history, error }
   */
}

/**
 * Cancelar remesa (solo en ciertos estados)
 */
export const cancelRemittance = async (remittanceId, reason) => {
  /**
   * Validar que status permite cancelación
   * UPDATE remittances SET
   *   status = 'cancelled',
   *   cancelled_at = NOW(),
   *   cancellation_reason = reason,
   *   cancelled_by = user_id
   * Returns: { success, error }
   */
}

// ========================================
// REMITTANCES - Admin
// ========================================

/**
 * Obtener todas las remesas (Admin)
 */
export const getAllRemittances = async (filters = {}) => {
  /**
   * Query con filtros:
   * - status
   * - userId
   * - dateFrom, dateTo
   * - Incluir datos de usuario y tipo
   *
   * Returns: { success, remittances, stats, error }
   */
}

/**
 * Validar pago (Admin)
 */
export const validatePayment = async (remittanceId, adminId) => {
  /**
   * UPDATE remittances SET
   *   payment_validated = true,
   *   payment_validated_at = NOW(),
   *   payment_validated_by = adminId,
   *   status = 'payment_validated'
   * Trigger WhatsApp notification to user
   * Returns: { success, remittance, error }
   */
}

/**
 * Rechazar pago (Admin)
 */
export const rejectPayment = async (remittanceId, reason, adminId) => {
  /**
   * UPDATE remittances SET
   *   payment_validated = false,
   *   payment_rejection_reason = reason,
   *   payment_validated_by = adminId,
   *   status = 'payment_rejected'
   * Trigger WhatsApp notification to user
   * Returns: { success, remittance, error }
   */
}

/**
 * Iniciar procesamiento (Admin)
 */
export const startProcessing = async (remittanceId, adminId) => {
  /**
   * Validar que status = 'payment_validated'
   * UPDATE remittances SET
   *   status = 'processing',
   *   processing_started_at = NOW()
   * Returns: { success, remittance, error }
   */
}

/**
 * Confirmar entrega (Admin)
 */
export const confirmDelivery = async (remittanceId, deliveryData, adminId) => {
  /**
   * deliveryData: {
   *   proofFile,
   *   deliveredToName,
   *   deliveredToId,
   *   notes
   * }
   *
   * 1. Upload delivery proof to Storage
   * 2. UPDATE remittances SET
   *      delivery_proof_url = url,
   *      delivered_to_name = name,
   *      delivered_to_id = id,
   *      delivery_notes_admin = notes,
   *      delivered_at = NOW(),
   *      delivered_by = adminId,
   *      status = 'delivered'
   * 3. Trigger WhatsApp notification to user
   * Returns: { success, remittance, error }
   */
}

/**
 * Completar remesa (Admin)
 */
export const completeRemittance = async (remittanceId, adminId) => {
  /**
   * Validar que status = 'delivered'
   * UPDATE remittances SET
   *   status = 'completed',
   *   completed_at = NOW()
   * Trigger WhatsApp notification to user
   * Returns: { success, remittance, error }
   */
}

// ========================================
// HELPERS
// ========================================

/**
 * Calcular monto a entregar
 */
export const calculateDeliveryAmount = (amountSent, exchangeRate, commissionPercentage, commissionFixed) => {
  /**
   * commission = (amountSent * commissionPercentage / 100) + commissionFixed
   * netAmount = amountSent - commission
   * deliveryAmount = netAmount * exchangeRate
   * Returns: { commission, deliveryAmount }
   */
}

/**
 * Calcular días desde validación
 */
export const getDaysSinceValidation = (remittance) => {
  /**
   * Si payment_validated_at existe, calcular diferencia en días
   * Returns: number
   */
}

/**
 * Determinar color de alerta
 */
export const getAlertColor = (remittance, remittanceType) => {
  /**
   * daysSince = getDaysSinceValidation(remittance)
   * if (daysSince >= maxDeliveryDays) return 'red'
   * if (daysSince >= warningDays) return 'yellow'
   * return 'blue'
   */
}

/**
 * Obtener estadísticas de remesas (Admin)
 */
export const getRemittanceStats = async () => {
  /**
   * Query agregado:
   * - Total remesas
   * - Por estado
   * - Monto total procesado
   * - Promedio de tiempo de entrega
   * Returns: { success, stats, error }
   */
}
```

**Archivo**: `/src/lib/remittanceService.js`
**Líneas estimadas**: ~800-1000
**Tiempo estimado**: 2-3 horas

---

### 1.2 Crear `/src/lib/constants.js` (Actualizar)

**Agregar**:

```javascript
// Remittance Status
export const REMITTANCE_STATUS = {
  PAYMENT_PENDING: 'payment_pending',
  PAYMENT_PROOF_UPLOADED: 'payment_proof_uploaded',
  PAYMENT_VALIDATED: 'payment_validated',
  PAYMENT_REJECTED: 'payment_rejected',
  PROCESSING: 'processing',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

// Delivery Methods
export const DELIVERY_METHOD = {
  CASH: 'cash',
  TRANSFER: 'transfer',
  CARD: 'card',
  PICKUP: 'pickup'
};

// Alert Colors
export const ALERT_COLOR = {
  GREEN: 'green',
  BLUE: 'blue',
  YELLOW: 'yellow',
  RED: 'red'
};
```

---

### 1.3 Actualizar `/src/lib/whatsappService.js`

**Agregar funciones**:

```javascript
/**
 * Notificar admin sobre nuevo comprobante
 */
export const notifyAdminNewPaymentProof = async (remittance, user) => {
  /**
   * Template:
   * 🔔 *Nueva remesa con comprobante*
   * 📝 Remesa: {remittance_number}
   * 👤 Usuario: {user_name}
   * 💵 Monto: {amount_sent} {currency} → {amount_to_deliver} {delivery_currency}
   * 📄 Comprobante subido hace: X minutos
   * 🔗 Ver en panel: [LINK]
   */
}

/**
 * Notificar usuario sobre validación de pago
 */
export const notifyUserPaymentValidated = async (remittance, userPhone) => {
  /**
   * Template:
   * ✅ *Tu pago ha sido validado*
   * 📝 Remesa: {remittance_number}
   * 💵 Monto: {amount_sent} {currency} → {amount_to_deliver} {delivery_currency}
   * 👤 Destinatario: {recipient_name}
   * 📦 Tu remesa está siendo procesada
   * ⏰ Entrega estimada: {max_delivery_days} días
   * 🔗 Ver estado: [LINK]
   */
}

/**
 * Notificar usuario sobre rechazo de pago
 */
export const notifyUserPaymentRejected = async (remittance, reason, userPhone) => {
  /**
   * Template:
   * ❌ *Pago rechazado*
   * 📝 Remesa: {remittance_number}
   * ❌ Razón: {reason}
   * ℹ️ Por favor, sube un nuevo comprobante
   * 🔗 Subir nuevo: [LINK]
   */
}

/**
 * Notificar usuario sobre entrega
 */
export const notifyUserDelivered = async (remittance, userPhone) => {
  /**
   * Template:
   * 🎉 *Remesa entregada exitosamente*
   * 📝 Remesa: {remittance_number}
   * 💵 Monto: {amount_to_deliver} {delivery_currency}
   * 👤 Recibido por: {delivered_to_name}
   * 📸 Ver evidencia: [LINK]
   * ✅ Tu remesa ha sido completada
   */
}

/**
 * Notificar admin sobre alerta de tiempo
 */
export const notifyAdminTimeAlert = async (remittance, remittanceType) => {
  /**
   * Template:
   * ⚠️ *Remesa cerca del plazo límite*
   * 📝 Remesa: {remittance_number}
   * ⏰ En procesamiento hace: X días Y horas
   * ⚠️ Plazo máximo: {max_delivery_days} días
   * 👤 Destinatario: {recipient_name}
   * 📍 {province}, {municipality}
   * 🔗 Ver remesa: [LINK]
   */
}
```

---

## 🎨 FASE 2: FRONTEND - COMPONENTES DE ADMINISTRACIÓN

### 2.1 `/src/components/RemittanceTypesConfig.jsx`

**Descripción**: Panel de configuración de tipos de remesas (Admin)

**Estructura**:
```jsx
const RemittanceTypesConfig = () => {
  // States
  const [types, setTypes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [loading, setLoading] = useState(false);

  // Funciones
  const loadTypes = async () => { /* ... */ };
  const handleCreate = () => { /* ... */ };
  const handleEdit = (type) => { /* ... */ };
  const handleSave = async (formData) => { /* ... */ };
  const handleDelete = async (typeId) => { /* ... */ };
  const handleToggleActive = async (typeId, isActive) => { /* ... */ };

  // UI Components
  return (
    <>
      {/* Header con botón "Nuevo Tipo" */}
      {/* Tabla de tipos configurados */}
      {/* Modal de crear/editar */}
    </>
  );
};
```

**Formulario del Modal**:
- Nombre
- Moneda origen (currency_code)
- Moneda destino (delivery_currency)
- Tasa de cambio (exchange_rate)
- Comisión % (commission_percentage)
- Comisión fija (commission_fixed)
- Monto mínimo/máximo
- Método de entrega
- Días máximos de entrega
- Días de warning
- Descripción
- Ícono

**Validaciones**:
- Todos los campos obligatorios completos
- Tasas y comisiones > 0
- Monto mínimo < monto máximo
- Días de warning < días máximos

**Archivo**: `/src/components/RemittanceTypesConfig.jsx`
**Líneas estimadas**: ~500-600
**Tiempo estimado**: 3-4 horas

---

### 2.2 `/src/components/AdminRemittancesTab.jsx`

**Descripción**: Panel de gestión de remesas para admin (similar a AdminOrdersTab)

**Estructura**:
```jsx
const AdminRemittancesTab = () => {
  // States
  const [remittances, setRemittances] = useState([]);
  const [filters, setFilters] = useState({});
  const [selectedRemittance, setSelectedRemittance] = useState(null);
  const [showValidateModal, setShowValidateModal] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);

  // Modales personalizados (como AdminOrdersTab)
  const [confirmModal, setConfirmModal] = useState({});
  const [inputModal, setInputModal] = useState({});
  const [toastMessage, setToastMessage] = useState(null);

  // Funciones
  const loadRemittances = async () => { /* ... */ };
  const handleValidatePayment = async (remittance) => { /* ... */ };
  const handleRejectPayment = async (remittance) => { /* ... */ };
  const handleStartProcessing = async (remittance) => { /* ... */ };
  const handleConfirmDelivery = async (remittance) => { /* ... */ };
  const handleComplete = async (remittance) => { /* ... */ };

  return (
    <>
      {/* Estadísticas */}
      {/* Filtros */}
      {/* Tabla de remesas */}
      {/* Modales de validación y entrega */}
      {/* Custom modals (ConfirmModal, InputModal, Toast) */}
    </>
  );
};
```

**Funcionalidades**:
1. Estadísticas en cards (total, pendientes, validadas, etc.)
2. Filtros avanzados (estado, tipo, usuario, fechas)
3. Tabla con información de cada remesa
4. Botones de acción según estado
5. Modal para validar pago (ver comprobante)
6. Modal para confirmar entrega (upload evidencia)
7. Sistema de alertas de tiempo con colores

**Archivo**: `/src/components/AdminRemittancesTab.jsx`
**Líneas estimadas**: ~1200-1500 (similar a AdminOrdersTab)
**Tiempo estimado**: 6-8 horas

---

## 👤 FASE 3: FRONTEND - COMPONENTES DE USUARIO

### 3.1 `/src/components/SendRemittancePage.jsx`

**Descripción**: Wizard para enviar nueva remesa (4 pasos)

**Estructura**:
```jsx
const SendRemittancePage = () => {
  const [step, setStep] = useState(1); // 1-4
  const [selectedType, setSelectedType] = useState(null);
  const [amount, setAmount] = useState('');
  const [recipientData, setRecipientData] = useState({});
  const [createdRemittance, setCreatedRemittance] = useState(null);

  // Step 1: Seleccionar tipo
  const renderTypeSelection = () => { /* ... */ };

  // Step 2: Ingresar monto
  const renderAmountInput = () => { /* ... */ };

  // Step 3: Datos del destinatario
  const renderRecipientForm = () => { /* ... */ };

  // Step 4: Subir comprobante
  const renderPaymentProof = () => { /* ... */ };

  return (
    <div>
      {/* Progress bar */}
      {step === 1 && renderTypeSelection()}
      {step === 2 && renderAmountInput()}
      {step === 3 && renderRecipientForm()}
      {step === 4 && renderPaymentProof()}
    </div>
  );
};
```

**Validaciones por paso**:
- Step 1: Tipo seleccionado
- Step 2: Monto válido y dentro de límites
- Step 3: Todos los campos obligatorios
- Step 4: Archivo válido

**Archivo**: `/src/components/SendRemittancePage.jsx`
**Líneas estimadas**: ~700-800
**Tiempo estimado**: 4-5 horas

---

### 3.2 `/src/components/MyRemittancesPage.jsx`

**Descripción**: Panel de seguimiento de remesas del usuario

**Estructura**:
```jsx
const MyRemittancesPage = () => {
  const [remittances, setRemittances] = useState([]);
  const [selectedRemittance, setSelectedRemittance] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const loadMyRemittances = async () => { /* ... */ };

  const renderRemittanceCard = (remittance) => {
    // Card con:
    // - Número de remesa
    // - Estado con badge de color
    // - Información básica
    // - Tiempo desde validación
    // - Alerta de tiempo (si aplica)
    // - Botones de acción (según estado)
  };

  const renderDetailsModal = () => {
    // Modal con:
    // - Timeline de estados
    // - Información financiera
    // - Datos del destinatario
    // - Tiempos
    // - Enlaces a comprobantes/evidencias
  };

  return (
    <>
      <div>
        {remittances.map(renderRemittanceCard)}
      </div>
      {showDetailsModal && renderDetailsModal()}
    </>
  );
};
```

**Funcionalidades**:
1. Listar todas las remesas del usuario
2. Filtrar por estado
3. Ordenar por fecha
4. Código de colores para alertas
5. Modal de detalles completo
6. Subir comprobante si falta
7. Ver evidencias (comprobante y entrega)

**Archivo**: `/src/components/MyRemittancesPage.jsx`
**Líneas estimadas**: ~800-900
**Tiempo estimado**: 5-6 horas

---

## 🌐 FASE 4: TRADUCCIONES

### 4.1 Actualizar `/src/contexts/LanguageContext.jsx`

**Agregar sección completa de remesas**:

```javascript
// Español
remittances: {
  // Títulos y navegación
  title: 'Remesas',
  myRemittances: 'Mis Remesas',
  sendRemittance: 'Enviar Remesa',
  newRemittance: 'Nueva Remesa',

  // Estados
  status: {
    payment_pending: 'Esperando comprobante',
    payment_proof_uploaded: 'Comprobante subido',
    payment_validated: 'Pago validado',
    payment_rejected: 'Pago rechazado',
    processing: 'En procesamiento',
    delivered: 'Entregado',
    completed: 'Completado',
    cancelled: 'Cancelado'
  },

  // Wizard de envío - Step 1
  selectType: {
    title: 'Selecciona el tipo de remesa',
    subtitle: 'Elige la moneda y método de entrega',
    rate: 'Tasa',
    commission: 'Comisión',
    delivery: 'Entrega',
    days: 'días'
  },

  // Wizard de envío - Step 2
  amount: {
    title: '¿Cuánto deseas enviar?',
    label: 'Monto a enviar',
    calculation: 'Detalles del cálculo',
    youSend: 'Envías',
    rate: 'Tasa',
    commission: 'Comisión',
    recipient: 'Destinatario recibe',
    minAmount: 'Monto mínimo',
    maxAmount: 'Monto máximo'
  },

  // Wizard de envío - Step 3
  recipient: {
    title: 'Datos del destinatario',
    name: 'Nombre completo',
    phone: 'Teléfono',
    idNumber: 'Número de CI',
    province: 'Provincia',
    municipality: 'Municipio',
    address: 'Dirección',
    notes: 'Notas adicionales',
    selectProvince: 'Seleccionar provincia',
    selectMunicipality: 'Seleccionar municipio'
  },

  // Wizard de envío - Step 4
  paymentProof: {
    title: 'Subir Comprobante de Pago',
    drag: 'Arrastra aquí tu comprobante',
    click: 'o haz click para seleccionar',
    formats: 'PNG, JPG, PDF (Max 5MB)',
    reference: 'Número de referencia',
    notes: 'Notas adicionales',
    warning: 'Tu remesa será validada por un administrador',
    submit: 'Subir Comprobante',
    uploading: 'Subiendo...'
  },

  // Mensajes
  messages: {
    created: 'Remesa creada exitosamente',
    proofUploaded: 'Comprobante subido exitosamente',
    validated: 'Pago validado',
    rejected: 'Pago rechazado',
    delivered: 'Remesa entregada',
    completed: 'Remesa completada',
    cancelled: 'Remesa cancelada',
    error: 'Error al procesar',
    noRemittances: 'No tienes remesas',
    invalidAmount: 'Monto inválido',
    outOfRange: 'Monto fuera de rango permitido'
  },

  // Admin - Configuración de tipos
  types: {
    title: 'Tipos de Remesas',
    subtitle: 'Configuración de monedas y tasas',
    newType: 'Nuevo Tipo',
    editType: 'Editar Tipo',
    active: 'Activo',
    inactive: 'Inactivo',
    activate: 'Activar',
    deactivate: 'Desactivar',
    save: 'Guardar',
    delete: 'Eliminar'
  },

  // Admin - Gestión
  admin: {
    title: 'Gestión de Remesas',
    validatePayment: 'Validar Pago',
    rejectPayment: 'Rechazar Pago',
    startProcessing: 'Iniciar Procesamiento',
    confirmDelivery: 'Confirmar Entrega',
    complete: 'Completar',
    viewProof: 'Ver Comprobante',
    viewEvidence: 'Ver Evidencia'
  }
}

// English (traducir todo lo anterior)
```

**Archivo**: `/src/contexts/LanguageContext.jsx`
**Líneas estimadas**: ~200-250
**Tiempo estimado**: 1-2 horas

---

## 🧪 FASE 5: TESTING Y REFINAMIENTO

### 5.1 Ejecutar Migración en Base de Datos

1. Copiar contenido de `remittance_system_migration.sql`
2. Ejecutar en Supabase SQL Editor
3. Verificar que se crearon:
   - Tablas: `remittance_types`, `remittances`, `remittance_status_history`
   - Funciones y triggers
   - RLS policies
   - Datos iniciales

### 5.2 Testing Manual

**Flujo Completo**:
1. Usuario crea remesa
2. Usuario sube comprobante
3. Admin valida pago
4. Admin inicia procesamiento
5. Admin confirma entrega
6. Admin completa remesa

**Verificar**:
- Estados cambian correctamente
- Timestamps se guardan
- Notificaciones WhatsApp funcionan
- Alertas de tiempo se muestran
- Evidencias se suben correctamente
- RLS policies funcionan

### 5.3 Refinamiento

- Ajustar estilos según diseño
- Optimizar queries
- Agregar loading states
- Mejorar mensajes de error
- Pulir animaciones

---

## 📊 ESTIMACIÓN TOTAL

| Fase | Componente | Tiempo Estimado |
|------|------------|----------------|
| 1 | remittanceService.js | 2-3 horas |
| 1 | whatsappService updates | 1 hora |
| 2 | RemittanceTypesConfig.jsx | 3-4 horas |
| 2 | AdminRemittancesTab.jsx | 6-8 horas |
| 3 | SendRemittancePage.jsx | 4-5 horas |
| 3 | MyRemittancesPage.jsx | 5-6 horas |
| 4 | Traducciones | 1-2 horas |
| 5 | Testing + Refinamiento | 3-4 horas |
| **TOTAL** | | **25-33 horas** |

---

## 🚀 ORDEN DE IMPLEMENTACIÓN SUGERIDO

### Sprint 1: Backend (5-6 horas)
1. ✅ Ejecutar migración SQL
2. ✅ Implementar remittanceService.js completo
3. ✅ Actualizar whatsappService.js
4. ✅ Testing de servicios

### Sprint 2: Admin UI (9-12 horas)
1. ✅ RemittanceTypesConfig.jsx
2. ✅ AdminRemittancesTab.jsx
3. ✅ Testing de admin panel

### Sprint 3: User UI (9-11 horas)
1. ✅ SendRemittancePage.jsx
2. ✅ MyRemittancesPage.jsx
3. ✅ Testing de user panels

### Sprint 4: Finalización (2-4 horas)
1. ✅ Traducciones completas
2. ✅ Testing end-to-end
3. ✅ Refinamiento y ajustes
4. ✅ Documentación final

---

## 📝 NOTAS IMPORTANTES

### Integración con Sistema Actual

1. **DashboardPage.jsx**: Agregar tab de "Remesas" similar a "Órdenes"
2. **Header.jsx**: Agregar link a "Mis Remesas" en menú de usuario
3. **SettingsPage.jsx**: Agregar sección de configuración de tipos de remesas
4. **Storage**: Configurar buckets para `remittance-proofs` y `remittance-delivery-proofs`

### Consideraciones de Seguridad

1. Validar siempre los permisos en backend (RLS)
2. Sanitizar inputs de usuario
3. Validar tamaño y tipo de archivos
4. Encriptar datos sensibles (CI, teléfonos)
5. Logs de auditoría para acciones admin

### Performance

1. Implementar paginación en listados
2. Lazy loading de imágenes/evidencias
3. Índices en queries frecuentes
4. Cache de tipos de remesas activos
5. Optimizar notificaciones WhatsApp (queue)

---

**Fecha de Creación**: 2025-10-13
**Estado**: Diseño completo, pendiente implementación
**Prioridad**: Alta
**Próxima Acción**: Sprint 1 - Backend Services
