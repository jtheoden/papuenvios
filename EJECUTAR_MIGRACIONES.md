# Ejecutar Migraciones - Sistema Destinatarios y Zelle

## 🎯 Objetivo

Resolver el error 400 del bucket y añadir funcionalidades completas de destinatarios y gestión Zelle.

---

## ⚡ PASOS PARA EJECUTAR (10 minutos)

### PASO 1: Crear Bucket de Storage (2 min)

1. Abre **Supabase SQL Editor**
2. Ejecuta: `supabase/CREATE_REMITTANCE_STORAGE.sql`
3. Verifica: Debe mostrar `✅ BUCKET CREADO`

**Qué hace:**
- Crea bucket `remittance-proofs` (privado, 5MB límite)
- 5 políticas RLS para subir/ver comprobantes
- Tipos permitidos: jpeg, png, webp, pdf

---

### PASO 2: Migración Completa (5 min)

1. Abre **Supabase SQL Editor**
2. Ejecuta: `supabase/MIGRATION_RECIPIENTS_AND_ZELLE.sql`
3. Verifica: Debe mostrar `✅ MIGRACIÓN COMPLETADA`

**Qué crea:**

#### Tablas:
- `recipients`: Destinatarios (nombre, teléfono, carnet)
- `recipient_addresses`: Direcciones por destinatario
- `cuban_municipalities`: 34 localidades cubanas
- `zelle_transaction_history`: Historial de transacciones

#### Funciones:
- `select_available_zelle_account()`: Rotación automática
- `update_zelle_account_usage()`: Actualiza contadores
- `reset_daily_zelle_counters()`: Reset automático

#### Mejoras a tablas existentes:
- `zelle_accounts`: Agrega security_limit, priority_order, notes
- `remittances`: Agrega recipient_id, zelle_account_id, etc.

---

### PASO 3: Verificar (1 min)

Ejecuta en Supabase SQL Editor:

```sql
-- Ver tablas creadas
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('recipients', 'recipient_addresses', 'cuban_municipalities', 'zelle_transaction_history')
ORDER BY table_name;

-- Ver municipios cargados
SELECT COUNT(*) as total_municipios FROM cuban_municipalities;
-- Debe mostrar: 34

-- Ver políticas RLS
SELECT tablename, COUNT(*) as politicas
FROM pg_policies
WHERE tablename IN ('recipients', 'recipient_addresses', 'cuban_municipalities', 'zelle_transaction_history')
GROUP BY tablename;
```

---

### PASO 4: Probar Funcionalidad (2 min)

1. Ve a tu aplicación
2. Intenta **crear una remesa**
3. Intenta **subir el comprobante de pago**
4. El error 400 debe desaparecer

---

## 📋 FUNCIONALIDADES AÑADIDAS

### 1. Sistema de Destinatarios

**Para qué:**
- Guardar destinatarios para reutilizar
- Múltiples direcciones por destinatario
- Compartido entre remesas y combos

**Campos:**
- Nombre completo
- Teléfono
- Carnet de identidad
- Email (opcional)
- Múltiples direcciones con provincia/municipio

**Ejemplo de uso:**
```javascript
import { createRecipient, addRecipientAddress } from '@/lib/recipientService';

// Crear destinatario
const { recipient } = await createRecipient({
  full_name: 'María García',
  phone: '+5355123456',
  id_number: '88010512345'
});

// Agregar dirección
await addRecipientAddress({
  recipient_id: recipient.id,
  province: 'La Habana',
  municipality: 'Plaza de la Revolución',
  address_line_1: 'Calle 23 #456',
  is_default: true
});
```

---

### 2. Gestión Inteligente de Zelle

**Para qué:**
- Rotación automática de cuentas
- Límites de seguridad
- Historial completo

**Rotación automática por:**
- Tipo (remittance, product, combo)
- Límites diarios/mensuales
- Límite de seguridad
- Prioridad configurada
- Último uso

**Ejemplo de uso:**
```javascript
import { getAvailableZelleAccount, registerZelleTransaction } from '@/lib/zelleService';

// Obtener cuenta disponible
const { account } = await getAvailableZelleAccount('remittance', 100);

// Registrar transacción
await registerZelleTransaction({
  zelle_account_id: account.id,
  transaction_type: 'remittance',
  reference_id: remittanceId,
  amount: 100
});
```

---

### 3. Localidades de Cuba

**Pre-cargadas:**
- 15 provincias
- 34 municipios principales
- Disponibilidad de entrega

**Ejemplo de uso:**
```javascript
import { getCubanProvinces, getMunicipalitiesByProvince } from '@/lib/recipientService';

// Obtener provincias
const { provinces } = await getCubanProvinces();

// Obtener municipios de La Habana
const { municipalities } = await getMunicipalitiesByProvince('La Habana');
```

---

## 🔧 CONFIGURACIÓN ADICIONAL

### Configurar Cuenta Zelle (Admin)

```sql
-- Crear cuenta Zelle con límites
INSERT INTO zelle_accounts (
  account_name,
  email,
  phone,
  bank_name,
  account_holder,
  is_active,
  for_remittances,
  for_products,
  daily_limit,
  monthly_limit,
  security_limit,
  priority_order
) VALUES (
  'Cuenta Principal',
  'pagos@empresa.com',
  '+1234567890',
  'Bank of America',
  'Empresa LLC',
  true,
  true,
  true,
  2000.00,
  50000.00,
  1500.00,
  1
);
```

### Configurar Prioridades

```sql
-- Cuenta 1: Máxima prioridad para remesas
UPDATE zelle_accounts
SET priority_order = 1, for_remittances = true, for_products = false
WHERE account_name = 'Remesas Principal';

-- Cuenta 2: Para productos
UPDATE zelle_accounts
SET priority_order = 2, for_remittances = false, for_products = true
WHERE account_name = 'Productos Principal';

-- Cuenta 3: Backup (ambos)
UPDATE zelle_accounts
SET priority_order = 3, for_remittances = true, for_products = true
WHERE account_name = 'Backup General';
```

---

## ⚠️ IMPORTANTE

### Límites de Seguridad

**security_limit:**
- Límite por transacción individual
- Evita transacciones muy grandes en una sola cuenta
- Recomendado: 70-80% del daily_limit

**Ejemplo:**
- daily_limit: 2000
- security_limit: 1500
- Si llega transacción de $1600 → rotará a siguiente cuenta

### Reset Automático

Los contadores se resetean automáticamente:
- **Diario:** Al iniciar cada día
- **Mensual:** El día 1 de cada mes

Configurar en Supabase Dashboard → Database → Cron Jobs (opcional):

```sql
-- Reset diario (ejecutar a las 00:00)
SELECT reset_daily_zelle_counters();

-- Reset mensual (ejecutar el día 1)
SELECT reset_monthly_zelle_counters();
```

---

## 🐛 TROUBLESHOOTING

### Error: "Bucket not found"
**Solución:** Ejecutar `CREATE_REMITTANCE_STORAGE.sql`

### Error: "relation recipients does not exist"
**Solución:** Ejecutar `MIGRATION_RECIPIENTS_AND_ZELLE.sql`

### Error: "function select_available_zelle_account does not exist"
**Solución:** Volver a ejecutar `MIGRATION_RECIPIENTS_AND_ZELLE.sql` completo

### No hay cuenta Zelle disponible
**Solución:**
1. Verificar que existen cuentas activas:
```sql
SELECT * FROM zelle_accounts WHERE is_active = true;
```
2. Verificar límites:
```sql
SELECT
  account_name,
  current_daily_amount,
  daily_limit,
  (daily_limit - current_daily_amount) as disponible
FROM zelle_accounts
WHERE is_active = true;
```
3. Reset manual si es necesario:
```sql
UPDATE zelle_accounts SET current_daily_amount = 0;
```

---

## ✅ CHECKLIST

- [ ] Ejecuté `CREATE_REMITTANCE_STORAGE.sql`
- [ ] Ejecuté `MIGRATION_RECIPIENTS_AND_ZELLE.sql`
- [ ] Verifiqué que se crearon 4 tablas
- [ ] Verifiqué que hay 34 municipios
- [ ] Configuré al menos 1 cuenta Zelle
- [ ] Probé subir un comprobante (sin error 400)
- [ ] Limpié caché del navegador
- [ ] Reinicié sesión

---

**Tiempo total:** ~10 minutos
**Resultado:** Sistema completo funcional

**Próximo paso:** Implementar UI de gestión de destinatarios y cuentas Zelle
