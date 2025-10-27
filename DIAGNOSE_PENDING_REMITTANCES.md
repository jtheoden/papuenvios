# 🔍 Diagnóstico: Remesas Pendientes de Validación No Se Calculan

**Problema:** En Admin > Remesas, el contador de "Pendientes de Validación" no muestra las remesas que deberían estar en estado `payment_proof_uploaded`.

---

## 📋 Paso 1: Verificar la Consola del Navegador

1. Abre Admin > Remesas
2. Abre la consola del navegador (**F12** → **Console**)
3. Busca mensajes que comienzan con `[AdminRemittancesTab]`

### Ejemplo de Salida Esperada:
```
[AdminRemittancesTab] Loaded remittances by status: {
  payment_pending: 2,
  payment_proof_uploaded: 3,
  payment_validated: 1,
  processing: 2,
  completed: 5
}
[AdminRemittancesTab] Total remittances: 13
[AdminRemittancesTab] Pending validation: 3
```

---

## 🔍 Posibles Problemas y Soluciones

### Problema 1: No se cargan remesas (`Total remittances: 0`)

**Causa Probable:** RLS policy no está permitiendo que el admin vea las remesas

**Solución:**
1. Verifica que tu usuario tenga el rol `'admin'` o `'super_admin'` en la tabla `user_profiles`:
   ```sql
   -- En Supabase SQL Editor
   SELECT user_id, email, role FROM user_profiles WHERE user_id = auth.uid();
   ```

2. Si el rol no es admin, actualízalo:
   ```sql
   UPDATE user_profiles
   SET role = 'admin'
   WHERE user_id = auth.uid();
   ```

3. Cierra sesión y vuelve a iniciar para que los cambios de rol se reflejen.

---

### Problema 2: Se cargan remesas pero status no es `payment_proof_uploaded`

**Ejemplo de Salida Problemática:**
```
Loaded remittances by status: {
  payment_pending: 10,
  completed: 5
}
Pending validation: 0  // ❌ No hay remesas en este estado
```

**Causa Probable:** Las remesas en la BD no tienen el estado correcto

**Verificación en BD:**
```sql
-- En Supabase SQL Editor
SELECT
  remittance_number,
  status,
  payment_proof_url,
  payment_proof_uploaded_at,
  created_at
FROM remittances
WHERE status = 'payment_pending'
LIMIT 10;
```

**Posibles Soluciones:**

1. **Si `payment_proof_url` está vacío:** El usuario subió el comprobante pero la remesa sigue en `payment_pending`
   - Verifica que la función `uploadPaymentProof()` está actualizando el estado correctamente

2. **Si `payment_proof_url` tiene valor:** El comprobante fue subido, la remesa debe estar en `payment_proof_uploaded`
   - Ejecuta esta query para actualizar remesas con comprobante subido:
   ```sql
   UPDATE remittances
   SET status = 'payment_proof_uploaded'
   WHERE payment_proof_url IS NOT NULL
   AND status = 'payment_pending'
   AND payment_proof_uploaded_at IS NOT NULL;
   ```

---

### Problema 3: El estado en la consola es diferente al esperado

**Ejemplo:**
```
Loaded remittances by status: {
  payment_proof_uploaded: 3
}
Pending validation: 0  // ❌ Pero debería ser 3
```

**Causa:** El valor de `REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED` no coincide con lo almacenado en BD

**Verificación:**
```sql
-- Ver todos los estados únicos en la tabla
SELECT DISTINCT status FROM remittances ORDER BY status;
```

Compara con los valores en `src/lib/remittanceService.js` línea 69-80:
```javascript
export const REMITTANCE_STATUS = {
  PAYMENT_PENDING: 'payment_pending',
  PAYMENT_PROOF_UPLOADED: 'payment_proof_uploaded',  // Debe ser exactamente esto
  PAYMENT_VALIDATED: 'payment_validated',
  // ...
};
```

---

## 📊 Consultas SQL de Diagnóstico Completas

Ejecuta estas en Supabase SQL Editor para diagnosticar:

### 1. Ver resumen de remesas por estado
```sql
SELECT status, COUNT(*) as count
FROM remittances
GROUP BY status
ORDER BY status;
```

### 2. Ver remesas que deberían estar en pendiente de validación
```sql
SELECT
  remittance_number,
  status,
  CASE
    WHEN payment_proof_url IS NOT NULL THEN 'Tiene comprobante'
    ELSE 'Sin comprobante'
  END as proof_status,
  payment_proof_uploaded_at,
  created_at
FROM remittances
WHERE payment_proof_url IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```

### 3. Ver tu usuario actual y rol
```sql
SELECT user_id, email, role FROM user_profiles WHERE user_id = auth.uid();
```

### 4. Ver todas las remesas que debería ver como admin
```sql
SELECT remittance_number, status, recipient_name, created_at
FROM remittances
ORDER BY created_at DESC
LIMIT 50;
```

---

## 🛠️ Checklist de Diagnóstico

- [ ] Abierto Admin > Remesas
- [ ] Verificada la consola (F12) para mensajes `[AdminRemittancesTab]`
- [ ] Conteo total de remesas es > 0
- [ ] Verificado el rol del usuario en `user_profiles` (admin/super_admin)
- [ ] Verificado en SQL que existen remesas con estado `payment_proof_uploaded`
- [ ] Verificado que `REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED` = `'payment_proof_uploaded'`

---

## 📝 Información a Compartir

Cuando reportes el problema, incluye:

1. **Salida de consola:**
   ```
   [AdminRemittancesTab] Loaded remittances by status: {...}
   [AdminRemittancesTab] Total remittances: X
   [AdminRemittancesTab] Pending validation: Y
   ```

2. **Resultado de SQL:**
   ```
   SELECT status, COUNT(*) as count FROM remittances GROUP BY status;
   ```

3. **Tu rol:**
   ```
   SELECT role FROM user_profiles WHERE user_id = auth.uid();
   ```

4. **Cantidad de remesas con comprobante:**
   ```
   SELECT COUNT(*) FROM remittances WHERE payment_proof_url IS NOT NULL;
   ```

---

## 🔄 Pasos para Investigar

1. Abre F12 → Console
2. Copia el mensaje `[AdminRemittancesTab] Loaded remittances by status: {...}`
3. Abre Supabase > SQL Editor
4. Ejecuta: `SELECT status, COUNT(*) as count FROM remittances GROUP BY status;`
5. Compara los números
6. Si no coinciden, contacta con los resultados de ambos

---

**Última actualización:** Octubre 27, 2025
**Commit:** `10369aea`

