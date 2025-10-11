# Debug: Error UUID en Creación de Orden

## Error Actual
```
invalid input syntax for type uuid: "1"
```

## Causa
El error indica que se está intentando insertar el valor `"1"` (string) en un campo UUID de la base de datos. Esto puede ser:
- `user_id`
- `currency_id`
- `shipping_zone_id`
- `zelle_account_id`

## Logs de Debug Agregados

He agregado logs en la consola que mostrarán exactamente qué valores se están enviando:

```javascript
console.log('Creating order with:', {
  userId: user.id,
  currencyId: currency.id,
  shippingZoneId: shippingZone?.id,
  zelleAccountId: zelleAccounts?.[0]?.id
});
```

## Pasos para Diagnosticar

1. **Recarga la página** (Ctrl+F5 o Cmd+Shift+R) para cargar el nuevo build

2. **Abre la Consola del Navegador** (F12 → Consola)

3. **Intenta crear una orden nuevamente**

4. **Busca en la consola el mensaje:**
   ```
   Creating order with: {...}
   ```

5. **Revisa los valores:**
   - `userId`: debe ser un UUID como `"550e8400-e29b-41d4-a716-446655440000"`
   - `currencyId`: debe ser un UUID similar
   - `shippingZoneId`: debe ser un UUID o null
   - `zelleAccountId`: debe ser un UUID o null

6. **Identifica cuál tiene el valor "1"**

## Posibles Problemas y Soluciones

### Problema 1: `currencyId` es "1"
**Causa:** La tabla `currencies` no está cargada correctamente o los IDs son numéricos en lugar de UUID

**Verificación:**
```javascript
// En la consola, ejecuta:
console.log('Currencies:', currencies);
```

**Solución:** Necesitamos verificar el schema de la tabla `currencies` y posiblemente actualizar los datos

### Problema 2: `userId` es "1"
**Causa:** El usuario no está autenticado correctamente con Supabase Auth

**Verificación:**
```javascript
// En la consola, ejecuta:
console.log('User:', user);
```

**Solución:** El user.id debe venir de Supabase Auth y ser un UUID. Si es numérico, hay un problema en AuthContext.

### Problema 3: `shippingZoneId` es "1"
**Causa:** La tabla `shipping_zones` tiene IDs numéricos en lugar de UUID

**Verificación:**
```javascript
// En la consola, ejecuta:
console.log('Shipping zones:', shippingZones);
```

**Solución:** Verificar schema de `shipping_zones`

### Problema 4: `zelleAccountId` es "1"
**Causa:** La tabla `zelle_accounts` tiene IDs numéricos en lugar de UUID

**Verificación:**
```javascript
// En la consola, ejecuta:
console.log('Zelle accounts:', zelleAccounts);
```

**Solución:** Verificar schema de `zelle_accounts`

## Schema Esperado

Según `currentDBSchema.md`, todas estas tablas deberían usar UUID:

### currencies
```sql
CREATE TABLE public.currencies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ...
);
```

### shipping_zones
```sql
CREATE TABLE public.shipping_zones (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ...
);
```

### zelle_accounts
```sql
CREATE TABLE public.zelle_accounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ...
);
```

### orders
```sql
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id),
  currency_id uuid REFERENCES currencies(id),
  shipping_zone_id uuid REFERENCES shipping_zones(id),
  zelle_account_id uuid REFERENCES zelle_accounts(id),
  ...
);
```

## Siguiente Paso

**Por favor:**
1. Recarga la página
2. Intenta crear una orden
3. Copia el mensaje completo de la consola que dice "Creating order with: {...}"
4. Pégalo aquí para que pueda ver exactamente cuál valor es "1"

Esto me permitirá identificar exactamente qué tabla tiene el problema y crear la solución específica.
