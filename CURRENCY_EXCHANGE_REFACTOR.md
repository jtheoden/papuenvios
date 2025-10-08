# Refactorización: Separación de Monedas y Tasas de Cambio

**Fecha:** 2025-10-07
**Objetivo:** Eliminar redundancia y clarificar la separación de conceptos entre Monedas y Tasas de Cambio

## Problema Identificado

Había redundancia y confusión conceptual en SettingsPage:
- **Gestión de Monedas** incluía un campo `rate_from_base` que intentaba manejar tasas de cambio
- **Gestión de Tasas de Cambio** era una sección separada para lo mismo
- El schema de base de datos ya define correctamente esta separación

## Decisión Arquitectónica

### Conceptos Separados:

1. **Monedas (tabla `currencies`)**
   - Define QUÉ monedas existen (USD, EUR, CUP, etc.)
   - Almacena solo metadatos: código, nombres, símbolo, is_base, is_active
   - NO almacena tasas de cambio

2. **Tasas de Cambio (tabla `exchange_rates`)**
   - Define CÓMO convertir entre monedas
   - Relaciona dos monedas con una tasa específica
   - Incluye fecha efectiva e historial de tasas
   - Estructura: from_currency_id → to_currency_id + rate + effective_date

## Cambios Implementados

### 1. SettingsPage.jsx

#### Estado Simplificado:
```javascript
// ANTES
const [currencyForm, setCurrencyForm] = useState({
  code: '', name_es: '', name_en: '', symbol: '', is_base: false,
  rate_from_base: '1.0'  // ❌ Campo redundante
});

// DESPUÉS
const [currencyForm, setCurrencyForm] = useState({
  code: '', name_es: '', name_en: '', symbol: '', is_base: false
});
```

#### Formulario de Monedas - Eliminado:
- Campo `rate_from_base` del formulario
- Lógica de cargar tasa existente al editar
- Lógica de guardar tasas automáticas al crear/editar moneda
- Referencia a tasas oficiales en formulario de monedas

#### Formulario de Monedas - Simplificado:
- Solo campos para metadatos de moneda
- Mensaje guía: "Configure las tasas de cambio en la sección Tasas de Cambio"
- Checkbox is_base con explicación de su propósito

#### Sección Exchange Rates - Mejorada:

**Nueva funcionalidad:**
- Crea automáticamente tasa inversa al guardar (ahorra trabajo manual)
- Muestra tasa oficial de referencia al seleccionar monedas
- Botón "Usar tasa oficial" para aplicar rápidamente
- Tabla completa con todas las tasas configuradas
- Soft delete de tasas

**UI completa:**
```javascript
// Formulario con 4 campos:
- Desde Moneda (selector)
- Hacia Moneda (selector)
- Tasa (numérico con referencia oficial)
- Fecha Efectiva (date picker)

// Tabla con columnas:
- From Currency | To Currency | Rate | Date | Actions
```

### 2. Funciones Actualizadas

#### `handleCurrencySubmit()`:
```javascript
// ELIMINADO: Bloque completo de 30+ líneas que gestionaba exchange_rates
// Ahora solo crea/edita la moneda sin tocar tasas
```

#### `handleEditCurrency()`:
```javascript
// ANTES: Query a exchange_rates + setCurrencyForm con rate_from_base
// DESPUÉS: Solo setCurrencyForm con metadatos de moneda
```

#### `handleSaveRate()`:
```javascript
// MEJORADO: Ahora guarda automáticamente la tasa inversa
await saveExchangeRate(newRate);  // USD → EUR: 0.92
await saveExchangeRate({          // EUR → USD: 1.087
  fromCurrencyId: newRate.toCurrencyId,
  toCurrencyId: newRate.fromCurrencyId,
  rate: (1 / parseFloat(newRate.rate)).toString(),
  effectiveDate: newRate.effectiveDate
});
```

### 3. currencyService.js - Sin cambios

La función `getExchangeRate()` ya estaba correctamente implementada para usar la tabla `exchange_rates`.

## Beneficios

1. **Claridad conceptual**: Monedas y tasas son dos entidades completamente separadas
2. **Cumple schema**: El código ahora refleja fielmente la estructura de BD
3. **Menos redundancia**: Una sola forma de gestionar tasas de cambio
4. **Mejor UX**:
   - Tasas inversas automáticas
   - Referencias a tasas oficiales
   - Interfaz dedicada y clara
5. **Mantenibilidad**: Más fácil entender y modificar

## Flujo de Trabajo Actualizado

### Para agregar una moneda:
1. Ir a "Monedas" en SettingsPage
2. Completar: código, nombres ES/EN, símbolo
3. Marcar is_base si es moneda de referencia
4. Guardar

### Para configurar tasas:
1. Ir a "Tasas de Cambio" en SettingsPage
2. Hacer clic en "Nueva Tasa"
3. Seleccionar moneda origen y destino
4. Ingresar tasa (opcionalmente usar "Usar tasa oficial")
5. Seleccionar fecha efectiva
6. Guardar → Se crean automáticamente tasa directa e inversa

## Archivos Modificados

- `/src/components/SettingsPage.jsx` (lines 60-66, 206-227, 219-228, 265-267, 458-495, 1069-1073, 1118-1160)

## Testing Recomendado

- [ ] Crear nueva moneda sin errores
- [ ] Editar moneda existente
- [ ] Eliminar moneda (debe desactivar sus tasas)
- [ ] Crear tasa de cambio (verificar que crea inversa)
- [ ] Verificar conversión en CartPage con nuevas tasas
- [ ] Usar botón "Cargar Tasas Oficiales"
- [ ] Aplicar tasa oficial en formulario de Exchange Rates
