y# Plan de Refactorización DRY - Sistema de Monedas

## Objetivo
Eliminar duplicación de código en la selección de moneda y cálculos de precios implementando componentes y hooks reutilizables centralizados.

## Estado Actual (Problemas)

### Duplicaciones Identificadas:
1. **Carga de monedas**: ProductsPage (3 lines), CartPage (8 lines), CurrencyContext (24 lines)
2. **Búsqueda de monedas**: 10+ apariciones de `.find(c => c.code === selectedCurrency)` o similar
3. **Cálculos de margen de ganancia**: 4+ componentes con lógica idéntica
4. **Selector de moneda UI**: ProductsPage y CartPage tienen dropdowns casi idénticos
5. **Conversión de precios**: Lógica diferente en cada componente

### Inconsistencias:
- ProductsPage usa UUIDs, CartPage usa string codes
- CurrencyContext no se usa (ContextOrfano)
- Mezcla de conversiones síncronas y asincrónicas
- No hay caché de tasas de cambio

## Plan de Refactorización

### FASE 1: Mejorar CurrencyContext (Fuente Única de Verdad)

**Archivo**: `src/contexts/CurrencyContext.jsx`

**Cambios:**
1. Mantener `currencies` array global
2. Mantener `selectedCurrency` como UUID
3. Agregar métodos de utilidad:
   - `getConversionRate(fromId, toId)` - obtiene tasa usando servicio
   - `convertAmount(amount, fromId, toId)` - convierte montos
   - `getCurrencyById(id)` - busca por UUID
   - `getCurrencyByCode(code)` - busca por código
4. Agregar caché de tasas para evitar N+1:
   - `conversionRatesCache` - Map de "fromId-toId" => rate
   - `preloadExchangeRates()` - carga todas al inicio
5. Agregar loading state para conversiones asincrónicas

**Nuevas funciones exportadas:**
```javascript
useCurrency() - hook principal (ya existe)
useCurrencyConversion() - hook específico para conversiones
useCurrencyLookup() - hook específico para búsquedas
```

---

### FASE 2: Crear componentes reutilizables

#### 2.1 `<CurrencySelector />` Component
**Archivo**: `src/components/CurrencySelector.jsx`

**Props:**
```javascript
{
  selectedCurrency,      // UUID del contexto
  onCurrencyChange,      // callback al cambiar
  label,                 // opcional: etiqueta del label
  showSymbol,           // boolean: mostrar símbolo junto al código
  disabled,             // boolean: deshabilitar selector
  size                  // 'sm' | 'md' | 'lg' - tamaño del select
}
```

**Implementación:**
- Usa `useCurrency()` para obtener lista de monedas
- Renderiza un `<select>` estándar (reutilizable)
- Muestra "CODE (Symbol)" o solo "CODE"
- Maneja estado de carga

**Remplaza:**
- ProductsPage líneas 358-371
- CartPage líneas 862-885
- Cualquier otro selector de moneda en el sistema

---

#### 2.2 `<PriceDisplay />` Component
**Archivo**: `src/components/PriceDisplay.jsx`

**Props:**
```javascript
{
  amount,                // número: monto a mostrar
  currencyId,            // UUID: moneda original del precio
  targetCurrency,        // UUID: moneda a la que convertir (opcional)
  showCurrencyCode,      // boolean: mostrar código de moneda
  showCurrencySymbol,    // boolean: mostrar símbolo
  decimals,             // number: decimales a mostrar (default 2)
  className            // string: clases CSS personalizadas
}
```

**Implementación:**
- Usa `useCurrencyConversion()` para convertir
- Maneja loading state mientras convierte
- Formatea según configuración regional
- Fallback a monto original si no hay tasa

**Remplaza:**
- ProductsPage cálculos de precio (líneas ~200-206)
- CartPage cálculos de precio (líneas ~52-82)

---

### FASE 3: Crear hooks especializados

#### 3.1 `useCurrencyConversion()` Hook
**Archivo**: `src/hooks/useCurrencyConversion.js`

**Retorna:**
```javascript
{
  selectedCurrency,           // UUID actual
  currencies,                 // array de todas
  convertAmount(amount, fromId, toId),  // sync si está en caché, async si no
  convertPrice(amount, fromId),  // convierte a selectedCurrency
  isConverting,               // boolean: se está convirtiendo
  conversionError             // error si hubo problema
}
```

**Implementación:**
- Usa `useCurrency()` internamente
- Integra con currencyService para tasas no en caché
- Usa memoización para evitar conversiones repetidas
- Fallback a 1:1 si no hay tasa disponible

---

#### 3.2 `usePriceCalculation()` Hook
**Archivo**: `src/hooks/usePriceCalculation.js`

**Parámetros:**
```javascript
usePriceCalculation({
  basePrice,           // número
  baseCurrencyId,      // UUID del producto/servicio
  markupPercent,       // porcentaje de ganancia
  targetCurrency      // UUID opcional para conversión inmediata
})
```

**Retorna:**
```javascript
{
  basePrice,           // precio original convertido si aplica
  markupAmount,        // monto del markup en targetCurrency
  finalPrice,          // precio final con markup
  currency,            // objeto de moneda completo
  isConverting         // boolean
}
```

**Implementación:**
- Centraliza lógica de: conversión + margen de ganancia
- Reemplaza lógica duplicada en ProductsPage (líneas 277-306) y CartPage (líneas 52-82)
- Usa `usePriceConversion()` + `useSettings()` para margen

---

#### 3.3 `useProfitMargin()` Hook
**Archivo**: `src/hooks/useProfitMargin.js`

**Parámetros:**
```javascript
useProfitMargin({
  itemType,          // 'product' | 'combo' | 'remittance'
  categoryId,        // opcional para margen específico por categoría
  overridePercent    // opcional para sobrescribir
})
```

**Retorna:**
```javascript
{
  percentageValue,    // 35 (si es 35%)
  multiplier,         // 1.35 (para usar en cálculos)
  apply(basePrice)    // función helper: basePrice * 1.35
}
```

**Implementación:**
- Lee de `SettingsContext` el margen por tipo
- Reemplaza 10+ líneas duplicadas de "parseFloat(...) / 100"

---

#### 3.4 `useCurrencyLookup()` Hook
**Archivo**: `src/hooks/useCurrencyLookup.js`

**Retorna:**
```javascript
{
  findById(uuid),          // retorna currency object
  findByCode(code),        // retorna currency object
  getSymbol(id),           // retorna símbolo
  getCode(id),             // retorna código
  formatDisplay(id),       // retorna "USD ($)"
  currencyMap,             // Map para acceso directo
}
```

**Implementación:**
- Centraliza los 10+ ".find()" dispersos en el código
- Usa memoización para no recalcular en cada render
- Cache inmediato en memoria (muy rápido)

---

### FASE 4: Refactorizar componentes existentes

#### 4.1 ProductsPage.jsx
**Cambios necesarios:**

1. **Líneas 126-163**: Eliminar carga manual de monedas
   - Cambiar a: `const { currencies, selectedCurrency } = useCurrency()`

2. **Líneas 249-275**: Eliminar conversión manual de precios
   - Cambiar a: `useConversionRate()` o eliminar (se maneja en PriceDisplay)

3. **Líneas 358-371**: Reemplazar selector dropdown
   ```javascript
   // ANTES: 14 líneas
   <select value={selectedCurrency} onChange={...}>
     {currencies.map(...)}
   </select>

   // DESPUÉS: 1 línea
   <CurrencySelector selectedCurrency={selectedCurrency} onCurrencyChange={setSelectedCurrency} />
   ```

4. **Líneas 277-306**: Simplificar `getComboDisplayPrice()`
   ```javascript
   // ANTES: 30 líneas de lógica compleja
   // DESPUÉS: 5 líneas
   const { finalPrice } = usePriceCalculation({
     basePrice: combo.baseTotalPrice,
     baseCurrencyId: combo.baseCurrencyId,
     markupPercent: financialSettings.comboProfit,
     targetCurrency: selectedCurrency
   });
   ```

5. **Líneas ~200-206**: Reemplazar cálculo de precio de producto
   ```javascript
   // ANTES: 6 líneas
   // DESPUÉS: usar <PriceDisplay />
   <PriceDisplay
     amount={product.base_price}
     currencyId={product.base_currency_id}
     targetCurrency={selectedCurrency}
     showCurrencySymbol
   />
   ```

**Reducción esperada:**
- Antes: ~500 líneas
- Después: ~380 líneas (-24% duplicación)
- Líneas de lógica de moneda: 120 → 30 (-75%)

---

#### 4.2 CartPage.jsx
**Cambios necesarios:**

1. **Líneas 142-151**: Eliminar carga manual de monedas
   - Cambiar a: `const { currencies, selectedCurrency } = useCurrency()`

2. **Líneas 46-82**: Eliminar `loadCurrencies()` y conversión compleja
   - Cambiar a: `usePriceCalculation()` para cada item

3. **Líneas 52-82**: Simplificar `getItemPrice()`
   ```javascript
   const { finalPrice } = usePriceCalculation({
     basePrice: item.calculated_price_usd || item.base_price,
     baseCurrencyId: item.base_currency_id,
     markupPercent: item.products ?
       financialSettings.comboProfit :
       financialSettings.productProfit,
     targetCurrency: selectedCurrency
   });
   return finalPrice;
   ```

4. **Líneas 862-885**: Reemplazar selector dropdown
   - Cambiar a: `<CurrencySelector ... />`

5. **Eliminar convertAmounts()** (líneas ~156-169)
   - Ya no es necesario con el nuevo sistema

**Reducción esperada:**
- Antes: ~1000 líneas
- Después: ~850 líneas (-15%)
- Líneas de conversión: 140 → 20 (-85%)

---

#### 4.3 Otros componentes (AdminOrdersTab, AdminRemittancesTab, etc.)
**Cambios necesarios:**

1. Reemplazar búsquedas de moneda (`.find()`) con `useCurrencyLookup()`
   - AdminOrdersTab línea 974: `.find(c => c.id === order.currency_id)`
   - AdminRemittancesTab línea 617: Similar

2. Usar `<PriceDisplay />` para mostrar montos
   - Dondequiera que se muestre un monto con moneda

---

### FASE 5: Optimizaciones de rendimiento

#### 5.1 Caché de tasas de cambio
**En CurrencyContext:**
- Pre-cargar todos los exchange_rates al iniciar
- Usar Map en lugar de búsqueda por array
- Implementar `preloadExchangeRates()` en useEffect

#### 5.2 Memoización
**En hooks:**
- `useMemo` para búsquedas de moneda
- `useCallback` para funciones de conversión
- Cache manual de conversiones recientes

#### 5.3 Lazy loading (opcional)
- No pre-cargar monedas hasta que se necesiten
- Usar Suspense para conversiones asincrónicas

---

## Implementación Secuencial

### Paso 1: Preparación
- [ ] Mejorar CurrencyContext con métodos de utilidad y caché
- [ ] Crear archivo de hooks base con `useCurrencyLookup`
- [ ] Crear `useCurrencyConversion`
- [ ] Crear `useProfitMargin`

### Paso 2: Componentes base
- [ ] Crear `<CurrencySelector />`
- [ ] Crear `<PriceDisplay />`

### Paso 3: Hooks avanzados
- [ ] Crear `usePriceCalculation`

### Paso 4: Refactorizar ProductsPage
- [ ] Migrar a nuevos hooks
- [ ] Reemplazar selector dropdown
- [ ] Simplificar cálculos de precio

### Paso 5: Refactorizar CartPage
- [ ] Migrar a nuevos hooks
- [ ] Reemplazar conversiones asincrónicas
- [ ] Reemplazar selector dropdown

### Paso 6: Refactorizar otros componentes
- [ ] AdminOrdersTab
- [ ] AdminRemittancesTab
- [ ] Cualquier otro componente con selección de moneda

### Paso 7: Testing
- [ ] Pruebas en ProductsPage
- [ ] Pruebas en CartPage
- [ ] Verificación de rendimiento
- [ ] Verificación de conversiones correctas

---

## Beneficios Esperados

| Métrica | Actual | Esperado | Ganancia |
|---------|--------|----------|----------|
| Líneas de código duplicadas | 100+ | 10 | -90% |
| Componentes cargando monedas | 3 | 1 | 66% menos |
| Funciones de conversión | 8 | 3 | 62% menos |
| Selectores de moneda únicos | 2 | 1 | 50% menos |
| Llamadas API de monedas | 3/página | 1/app | Significativo |

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|-----------|
| Romper ProductsPage | Alta | Migrar paso a paso, mantener pruebas |
| Romper CartPage | Alta | Migrar paso a paso, mantener pruebas |
| Conversiones incorrectas | Media | Testing exhaustivo con tasas conocidas |
| Performance regression | Baja | Benchmarking antes/después |
| Navegadores viejos | Baja | No usamos features nuevas |

---

## Alternativas Consideradas

### Opción A: Solo refactorizar ProductsPage y CartPage
**Ventajas:** Rápido, bajo riesgo
**Desventajas:** No resuelve duplicación en admin components, pierde oportunidad de estructura global

### Opción B: Crear mega-hook con toda la lógica
**Ventajas:** Simple, un lugar central
**Desventajas:** Hook monolítico, difícil de mantener, violaría SRP

### Opción C: Rewrite completo con TypeScript
**Ventajas:** Type safety mejor
**Desventajas:** Alto riesgo, alto costo, fuera de scope

**Opción elegida: A+B (esta propuesta)** - Refactorización graduada con hooks especializados

---

## Decisiones de Diseño

1. **UUID para IDs de moneda internamente** - Consistencia con BD
2. **CurrencyContext como fuente única de verdad** - Evita prop drilling
3. **Componentes pequeños y enfocados** (CurrencySelector, PriceDisplay) - SRP
4. **Hooks especializados** en lugar de mega-hook - Flexibilidad
5. **Caché en contexto** en lugar de servicio - Mejor control, menos API calls

---

## Aprobación Requerida

Por favor revisa el plan y confirma:
- [ ] ¿Está de acuerdo con la arquitectura propuesta?
- [ ] ¿Algún cambio en las prioridades de las fases?
- [ ] ¿Algún componente adicional que deba refactorizarse?
- [ ] ¿Presupuesto de tiempo aceptable para esta refactorización?
