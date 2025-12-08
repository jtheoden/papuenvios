# ISSUES CRÍTICOS COMPLETOS - PapuEnvíos
## Documento de Issues Reales Identificados y Correcciones

**Fecha**: 8 de diciembre de 2025
**Estado**: REQUIERE ACCIÓN INMEDIATA

---

## CATEGORÍA 1: OBSERVABILIDAD - LOGGING INCORRECTO (CRÍTICO 🔴)

### Issue 1.1: Activity Logs usando IDs en lugar de Emails
**Archivos afectados**:
- `src/lib/orderService.js` (10 ocurrencias)
- `src/lib/orderDiscountService.js` (1 ocurrencia)

**Problema**:
Los activity logs usan `userId` o `adminId` en el campo `performedBy` en lugar del email del usuario, lo que dificulta la trazabilidad.

**Ubicaciones exactas**:
1. `src/lib/orderService.js:394` - `performedBy: orderData.userId`
2. `src/lib/orderService.js:1058` - `performedBy: adminId` (validatePayment)
3. `src/lib/orderService.js:1283` - `performedBy: adminId` (rejectPayment)
4. `src/lib/orderService.js:1381` - `performedBy: adminId`
5. `src/lib/orderService.js:1502` - `performedBy: userId`
6. `src/lib/orderService.js:1662` - `performedBy: adminId` (markOrderAsDispatched)
7. `src/lib/orderService.js:1771` - `performedBy: adminId` (markOrderAsDelivered)
8. `src/lib/orderService.js:1967` - `performedBy: adminId` (cancelOrder por admin)
9. `src/lib/orderService.js:2045` - `performedBy: userId` (cancelOrder por usuario)
10. `src/lib/orderDiscountService.js:253` - `performedBy: userId || 'anonymous'`

**Solución requerida**:
Obtener el email del usuario antes de llamar a `logActivity`:
```javascript
// INCORRECTO:
performedBy: userId

// CORRECTO:
const { data: userProfile } = await supabase
  .from('user_profiles')
  .select('email')
  .eq('user_id', userId)
  .single();
performedBy: userProfile?.email || userId
```

---

### Issue 1.2: Descripciones de Activity Logs en Inglés
**Archivos afectados**: `src/lib/orderService.js`

**Problema**:
Las descripciones de cancelación de órdenes están en inglés, no en español.

**Ubicaciones exactas**:
1. Línea 1968: `description: 'Order cancelled by admin (${reason})'`
2. Línea 2046: `description: 'User cancelled order ${order.order_number}'`

**Solución requerida**:
```javascript
// Línea 1968:
description: `Orden cancelada por administrador (${reason})`

// Línea 2046:
description: `Usuario canceló orden ${order.order_number}`
```

---

## CATEGORÍA 2: FLUJO DE ÓRDENES - REAPERTURA (CRÍTICO 🔴)

### Issue 2.1: Usuario NO puede reabrir orden cancelada
**Problema**:
Cuando un usuario cancela una orden, no existe funcionalidad para reabrirla y subir un nuevo comprobante.

**Funcionalidad faltante**:
- Función `reopenOrder(orderId, userId)` en orderService.js
- Botón "Reabrir orden" en UserPanel para órdenes canceladas
- Validación de que solo el dueño de la orden puede reabrirla
- Logging de actividad en español

**Estado actual**:
El usuario ve la orden cancelada pero no tiene acción disponible para continuar el proceso.

**Solución requerida**:
```javascript
// Nueva función en orderService.js
export const reopenOrder = async (orderId, userId) => {
  // 1. Verificar que la orden existe y está cancelada
  // 2. Verificar que el usuario es el dueño
  // 3. Actualizar status a PENDING y payment_status a PENDING
  // 4. Limpiar campos de cancelación
  // 5. Registrar actividad en español
  // 6. Retornar orden actualizada
};
```

---

### Issue 2.2: Administrador NO puede reabrir órdenes canceladas
**Problema**:
Los administradores no tienen opción para reabrir órdenes que fueron canceladas erróneamente.

**Funcionalidad faltante**:
- Función `reopenOrderByAdmin(orderId, adminId, reason)` en orderService.js
- Botón "Reabrir orden" en AdminOrdersTab/UserPanel para admins
- Logging de actividad en español con razón de reapertura

**Solución requerida**:
```javascript
// Nueva función en orderService.js
export const reopenOrderByAdmin = async (orderId, adminId, reason) => {
  // 1. Verificar que la orden está cancelada
  // 2. Verificar que el usuario tiene rol admin/super_admin
  // 3. Actualizar status a PENDING y payment_status a PENDING
  // 4. Limpiar campos de cancelación
  // 5. Registrar actividad: "Orden reabierta por administrador: {reason}"
  // 6. Retornar orden actualizada
};
```

---

### Issue 2.3: Error al marcar orden como entregada cuando ya está entregada
**Problema**:
El administrador puede intentar subir evidencia de entrega en una orden que ya está en estado `delivered`, causando error de transición de estado.

**Ubicación**:
- `src/lib/orderService.js:1718` - validateOrderTransition falla si status ya es delivered
- `src/components/AdminOrdersTab.jsx:377` - No valida el estado antes de llamar a markOrderAsDelivered

**Solución requerida**:
```javascript
// En AdminOrdersTab.jsx, antes de llamar a markOrderAsDelivered:
if (selectedOrder.status !== 'dispatched') {
  showToast('Solo puedes subir evidencia para órdenes despachadas', 'error');
  return;
}

// O mejor: deshabilitar el botón si el estado no es correcto
```

---

## CATEGORÍA 3: MÁQUINA DE ESTADOS - TRANSICIONES FALTANTES (CRÍTICO 🔴)

### Issue 3.1: CANCELLED debe permitir transición a PENDING
**Problema**:
La máquina de estados define CANCELLED como estado terminal:
```javascript
[ORDER_STATUS.CANCELLED]: []  // No permite ninguna transición
```

**Solución requerida**:
```javascript
[ORDER_STATUS.CANCELLED]: [
  ORDER_STATUS.PENDING  // Permitir reapertura
]
```

---

## CATEGORÍA 4: INTERFAZ DE USUARIO - ACCIONES FALTANTES (ALTA 🟠)

### Issue 4.1: UserPanel - Falta botón "Reabrir" para usuarios
**Ubicación**: `src/components/UserPanel.jsx`

**Acciones faltantes**:
- Botón "Reabrir orden" para órdenes canceladas
- Validación de que el usuario es el dueño
- Confirmación antes de reabrir

---

### Issue 4.2: AdminOrdersTab - Falta botón "Reabrir" para admins
**Ubicación**: `src/components/AdminOrdersTab.jsx`

**Acciones faltantes**:
- Botón "Reabrir orden" para órdenes canceladas
- Campo para ingresar razón de reapertura
- Logging de actividad

---

### Issue 4.3: AdminOrdersTab - Faltan handlers completos para el flujo
**Ubicación**: `src/components/AdminOrdersTab.jsx`

**Según el plan maestro FASE 2.4, faltan**:
- Handler para validar pago con logging
- Handler para rechazar pago con logging
- Todos los handlers actuales NO incluyen logging de actividad

**Solución requerida**:
Agregar logging a todos los handlers existentes y crear los faltantes según el plan maestro.

---

## CATEGORÍA 5: PERMISOS DE BASE DE DATOS (BLOQUEADOR 🔴)

### Issue 5.1: Permisos de inventory_movements NO VERIFICADOS
**Problema**:
Se creó archivo SQL asumiendo permisos faltantes SIN VERIFICAR el estado real de la BD.

**Acción requerida**:
Ejecutar consultas de diagnóstico en `database/diagnostic-queries.sql` y compartir resultados para generar correcciones precisas.

---

## CATEGORÍA 6: FLUJO DE REMESAS (CRÍTICO 🔴)

### Issue 6.1: RemittanceService - Estructura de respuesta inconsistente
**Problema**:
Las funciones lanzan excepciones pero los componentes esperan `{success, data, error}`.

**Solución requerida** (del plan maestro FASE 3.1):
Crear wrapper `withServiceResponse` para normalizar todas las respuestas.

---

### Issue 6.2: AdminRemittancesTab - Campos incorrectos
**Problema**:
- Muestra `amount` en lugar de `amount_sent`
- No muestra `delivery_method` ni `delivery_currency`
- Falta dirección del destinatario

**Solución requerida** (del plan maestro FASE 3.2):
Corregir campos según especificaciones del plan.

---

### Issue 6.3: confirmDelivery - Bucket de storage incorrecto
**Problema**:
Sube a 'remittance-proofs' en lugar de 'remittance-delivery-proofs'.

**Ubicación**: `src/lib/remittanceService.js:1328`

**Solución requerida** (del plan maestro FASE 3.3):
Cambiar bucket de storage.

---

## CATEGORÍA 7: INTERNACIONALIZACIÓN (MEDIA 🟡)

### Issue 7.1: Textos hardcodeados en español
**Ubicaciones identificadas**:
- Mensajes de error en validaciones
- Algunas descripciones de activity logs

**Solución requerida**:
Usar `t()` para todos los textos visibles al usuario.

---

## RESUMEN DE PRIORIDADES

### 🔴 BLOQUEADORES INMEDIATOS (hacer primero):
1. Ejecutar consultas de diagnóstico de BD
2. Corregir todos los activity logs a email + español
3. Implementar reapertura de órdenes (usuario + admin)
4. Actualizar máquina de estados para permitir CANCELLED → PENDING
5. Arreglar error de transición en markOrderAsDelivered

### 🟠 CRÍTICOS (hacer después):
6. Crear wrapper para remittanceService
7. Corregir campos en AdminRemittancesTab
8. Arreglar bucket en confirmDelivery
9. Agregar logging a todos los handlers de AdminOrdersTab

### 🟡 IMPORTANTES (hacer después):
10. Internacionalización completa
11. Testing end-to-end de todos los flujos

---

## ESTIMACIÓN DE TIEMPO

- Corrección de logging (1.1, 1.2): **60 min**
- Reapertura de órdenes (2.1, 2.2, 3.1): **90 min**
- Fix de transición delivered (2.3): **15 min**
- Interfaces de usuario (4.1, 4.2): **45 min**
- Verificación de permisos (5.1): **30 min** (depende de resultados)
- Flujo de remesas (6.1, 6.2, 6.3): **120 min**
- Total: **~6 horas**

---

## PRÓXIMOS PASOS INMEDIATOS

1. **USUARIO DEBE**: Ejecutar consultas en `database/diagnostic-queries.sql` y compartir resultados
2. **DESARROLLADOR**: Mientras tanto, corregir todos los activity logs a email + español
3. **DESARROLLADOR**: Implementar funciones de reapertura de órdenes
4. **DESARROLLADOR**: Actualizar máquina de estados
5. **DESARROLLADOR**: Crear interfaces para reapertura
6. **DESARROLLADOR**: Testing exhaustivo

---

**NOTA CRÍTICA**: Este documento reemplaza cualquier lista de tareas anterior. Todos los issues aquí listados son reales, verificados en el código fuente, y requieren acción.
