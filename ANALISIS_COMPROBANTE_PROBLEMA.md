# Análisis: Por qué el Comprobante No Se Visualiza en Admin Remesas

## Problema Identificado

El comprobante de pago no se visualiza en el modal del admin porque el bucket `remittance-proofs` está configurado como **PRIVADO**, pero el código intenta obtener una URL "pública" que no funciona realmente.

## Flujo Actual (Roto)

### 1. Usuario sube comprobante (SendRemittancePage → uploadPaymentProof)
**Archivo**: `src/lib/remittanceService.js`, línea 432-515

```javascript
// PASO 1: Subir archivo al bucket PRIVADO
const { data: uploadData, error: uploadError } = await supabase.storage
  .from('remittance-proofs')  // ← BUCKET PRIVADO
  .upload(filePath, file, { upsert: true });

// PASO 2: Obtener "URL pública" (pero el bucket es privado!)
const { data: { publicUrl } } = supabase.storage
  .from('remittance-proofs')
  .getPublicUrl(filePath);  // ← ESTO NO FUNCIONA CON BUCKETS PRIVADOS

// PASO 3: Guardar la URL "pública" inválida en la BD
const { data: updatedRemittance, error: updateError } = await supabase
  .from('remittances')
  .update({
    payment_proof_url: publicUrl,  // ← URL que NO es accesible
    // ...
  })
```

### 2. Admin intenta ver el comprobante (AdminRemittancesTab)
**Archivo**: `src/components/AdminRemittancesTab.jsx`, línea 625

```javascript
<img
  src={selectedRemittance.payment_proof_url}  // ← URL NO accesible
  alt="Payment proof"
/>
```

El navegador intenta cargar la URL, pero:
- El bucket es PRIVADO
- La URL no tiene token de autenticación válido
- El navegador no puede autenticarse automáticamente
- → La imagen falla y cae al error handler que muestra SVG

## Raíz del Problema

**Archivo**: `supabase/CREATE_REMITTANCE_STORAGE.sql`, línea 10

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'remittance-proofs',
  'remittance-proofs',
  false,  -- ← PRIVADO: Las URLs "públicas" no funcionan
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']
)
```

## Esquema de Base de Datos

**Tabla**: `remittances`
- Campo: `payment_proof_url TEXT` (línea 139 en migration)
- El campo SÍ se obtiene en `getAllRemittances` ✓
- Los datos SÍ se guardan correctamente ✓
- El problema está en el **tipo de URL guardada**, no en el almacenamiento

## Opciones de Solución

### Opción 1: URLs Firmadas (RECOMENDADO - Más Seguro)
- Generar "signed URLs" que son válidas por un tiempo limitado
- Cada URL tiene un token de autenticación incorporado
- El admin puede ver la imagen sin problema
- Las URLs expiran después de X minutos
- Más seguro que URLs públicas

**Ventajas:**
- Máxima seguridad
- Control temporal de acceso
- URLs únicas por usuario/admin

**Desventajas:**
- Requiere generar URL cada vez que se abre el modal
- Añade latencia mínima

### Opción 2: Bucket Público
- Cambiar `public = true` en el bucket
- Las URLs públicas funcionarán directamente
- No requiere cambios en el código

**Ventajas:**
- Cambio simple
- No requiere modificar código

**Desventajas:**
- Menos seguro (cualquiera con URL puede ver)
- No recomendado para documentos sensibles

### Opción 3: Data URLs (Storage.download)
- Descargar el archivo en el servidor/navegador
- Convertir a Data URL o blob URL
- Mostrar la imagen

**Ventajas:**
- Funciona con buckets privados
- Control total del acceso

**Desventajas:**
- Mayor transferencia de datos
- Requiere reescribir código

## Recomendación

**Usar Opción 1: URLs Firmadas**

Es la solución más segura y profesional. Las URLs firmadas son estándar en Supabase para contenido privado que necesita acceso temporal.

## Implementación Necesaria

1. **En uploadPaymentProof()**: Cambiar de `getPublicUrl()` a `createSignedUrl()`
2. **En AdminRemittancesTab**: Generar nuevas URLs firmadas cuando se abre el modal
3. **Mantener**: El bucket privado (seguridad)

## Estado de la Migración

- ✓ Tabla `remittances` con campo `payment_proof_url`
- ✓ Bucket `remittance-proofs` creado
- ✓ RLS policies configuradas correctamente
- ✗ **Tipo de URL incorrecto (pública vs firmada)**

## Componentes Afectados

- `src/lib/remittanceService.js` - uploadPaymentProof (línea 473)
- `src/components/AdminRemittancesTab.jsx` - Modal de visualización (línea 625)
