# 🔴 Componentes Destruidos que Necesitan Recuperación

**Estado:** Crítico - Funcionalidad perdida

---

## 1. FileUploadWithPreview.jsx
**Ubicación esperada:** `/src/components/FileUploadWithPreview.jsx`
**Estado:** ❌ DESTRUIDO/FALTANTE
**Prioridad:** 🔴 CRÍTICA

**Propósito:**
- Component reusable para upload de archivos con preview
- Soporte para imágenes (JPG, PNG, WebP) y PDF
- Mostrar preview/thumbnail ANTES de subir
- Validación de tipo y tamaño de archivo
- Estados de loading/error

**Ubicación en flujo:**
- SendRemittancePage Step 4 (Payment Proof Upload)
- CartPage (Product images)
- Otras ubicaciones con upload de archivos

**Características necesarias:**
- Preview de imagen inline
- Vista de PDF (icono + info)
- Indicador de progreso de upload
- Manejo de errores
- Soporte bilingual (ES/EN)

---

## 2. ZelleAccountSelector / ZellePaymentInfo.jsx
**Ubicación esperada:** `/src/components/ZelleAccountSelector.jsx` o `/src/components/ZellePaymentInfo.jsx`
**Estado:** ❌ DESTRUIDO/FALTANTE
**Prioridad:** 🔴 CRÍTICA

**Propósito:**
- Mostrar cuenta Zelle disponible para transferencia
- Información de la cuenta (número, nombre, límites)
- Status de la cuenta (disponible, usado en el día, etc)
- Rotación automática de cuentas
- Instrucciones para usuario sobre cómo transferir

**Ubicación en flujo:**
- SendRemittancePage Step 4 (después del upload de proof)
- Mostrar junto con datos de la remesa para que usuario sepa dónde transferir

**Características necesarias:**
- Seleccionar automáticamente cuenta disponible
- Mostrar:
  * Número/email de Zelle
  * Nombre de la cuenta
  * Monto a transferir
  * Límites diarios/mensuales
  * Status de disponibilidad
- Botón para copiar número a clipboard
- Instrucciones claras en español/inglés
- Soporte para rotación automática entre cuentas

---

## Estado Actual (SendRemittancePage Step 4)

```jsx
{/* Step 4: Upload Payment Proof */}
{step === 4 && createdRemittance && (
  // ... muestra resumen ...

  // Formulario de upload
  <input
    type="file"
    accept="image/*,.pdf"
    // SIN PREVIEW
  />

  // FALTA: Selector/Mostrador de Zelle
  // Usuario no sabe dónde transferir
)}
```

---

## Lo que Debería Haber

```jsx
{/* Step 4: Upload Payment Proof + Zelle Instructions */}
{step === 4 && createdRemittance && (
  <>
    {/* Seccion de instrucciones Zelle */}
    <ZellePaymentInfo
      remittance={createdRemittance}
      shippingZone={...}
    />

    {/* Seccion de upload con preview */}
    <FileUploadWithPreview
      onFileSelect={setPaymentData}
      acceptTypes={['image/*', '.pdf']}
      maxSize={5242880} // 5MB
      showPreview={true}
    />
  </>
)}
```

---

## Integración Requerida

### 1. En SendRemittancePage
- **Importar:** `FileUploadWithPreview` y `ZellePaymentInfo`
- **Step 4 cambios:**
  - Reemplazar `<input type="file">` con `<FileUploadWithPreview>`
  - Agregar `<ZellePaymentInfo>` ANTES del formulario de upload
  - Mostrar instrucciones claras sobre transferencia

### 2. En CartPage
- **Importar:** `FileUploadWithPreview`
- **En checkout:** Usar para upload de archivos si es necesario

### 3. En MyRemittancesPage
- **Importar:** Ambos componentes
- **Si el usuario necesita cargar proof faltante:** Usar estos componentes

---

## Datos Necesarios Para ZellePaymentInfo

```javascript
{
  remittance: {
    id: String,
    remittance_number: String,
    amount_to_deliver: Number,
    currency_delivered: String,
    zelle_account: {
      id: String,
      email_or_phone: String,
      account_holder_name: String,
      daily_limit: Number,
      daily_remaining: Number,
      monthly_limit: Number,
      monthly_remaining: Number,
      status: 'available' | 'at_limit' | 'unavailable'
    }
  },
  language: 'es' | 'en'
}
```

---

## Importancia

Estos componentes son **CRÍTICOS** porque:

1. **FileUploadWithPreview:**
   - Usuario necesita VER el archivo antes de subir
   - Evita errores de archivo incorrecto
   - Mejor UX que input básico

2. **ZellePaymentInfo:**
   - Usuario **NECESITA SABER** dónde transferir dinero
   - Sin esto, la remesa no se puede completar
   - Información crítica que se está faltando

---

## Acción Requerida

☑️ Recuperar componentes del historio de git
☑️ Integrar en SendRemittancePage
☑️ Integrar en CartPage (si aplica)
☑️ Pruebas completas del flujo

---

**Fecha reportado:** 27 de Octubre, 2025
**Severidad:** 🔴 CRÍTICA
**Impacto:** Remesas incompletas, experiencia de usuario pobre
