# Fix: Payment Proof Upload & WhatsApp Contact

**Fecha:** 2025-10-08
**Objetivo:** Corregir error al subir comprobante de pago y agregar botón de contacto por WhatsApp

## Problemas Identificados

### 1. Error al subir comprobante de pago
```
Error uploading payment proof: TypeError: Cannot read properties of undefined (reading 'formats')
at validateImage (imageUtils.js:64:20)
```

**Causa:** El tipo `payment_proof` no existía en `IMAGE_CONSTRAINTS` de imageUtils.js

### 2. Error en remittanceService
```
Failed to load resource: the server responded with a status of 400 ()
Error fetching remittance configs
```

**Causa:** El servicio intentaba consultar `system_messages` con un campo `message_type` que no existe en el schema actual

### 3. Falta de canal de soporte
No había forma de contactar al negocio durante el proceso de pago

## Soluciones Implementadas

### 1. imageUtils.js - Agregado constraint para payment_proof

**Archivo:** `/src/lib/imageUtils.js`

**Cambio:**
```javascript
payment_proof: {
  maxSizeMB: 5,
  maxWidth: 2000,
  maxHeight: 2000,
  aspectRatio: null, // Any aspect ratio
  quality: 0.85,
  formats: ['image/jpeg', 'image/png', 'image/webp']
}
```

**Razón:**
- Permite comprobantes de pago en cualquier orientación (aspectRatio: null)
- Acepta archivos más grandes (5MB) para garantizar legibilidad
- Soporta formatos comunes de capturas de pantalla

### 2. remittanceService.js - Eliminadas queries incorrectas

**Archivo:** `/src/lib/remittanceService.js`

**Cambios:**
- `getRemittanceConfigs()`: Ahora retorna configs por defecto directamente
- `saveRemittanceConfig()`: Implementación temporal sin BD
- `deleteRemittanceConfig()`: Implementación temporal sin BD

**Código:**
```javascript
export const getRemittanceConfigs = async () => {
  try {
    // For now, return default configs
    // TODO: Implement proper storage when remittance configurations table is created
    return {
      success: true,
      configs: getDefaultRemittanceConfigs()
    };
  } catch (error) {
    console.error('Error fetching remittance configs:', error);
    return { success: false, configs: getDefaultRemittanceConfigs(), error: error.message };
  }
};
```

**Razón:**
- El schema de `system_messages` cambió y no tiene campo `message_type`
- Las configuraciones de remesas necesitan su propia tabla dedicada
- Por ahora usa valores por defecto hardcodeados (MN, USD, MLC)

### 3. CartPage.jsx - Agregado botón de WhatsApp

**Archivo:** `/src/components/CartPage.jsx`

**Imports agregados:**
```javascript
import { MessageCircle } from 'lucide-react';
import { generateWhatsAppURL } from '@/lib/whatsappService';
```

**Contexto actualizado:**
```javascript
const { ..., businessInfo } = useBusiness();
```

**UI agregada (después del upload de comprobante):**
```javascript
{/* WhatsApp Contact Button */}
{businessInfo?.whatsapp && (
  <div className="mb-6">
    <div className="p-4 bg-green-50 rounded-lg border border-green-200">
      <p className="text-sm text-gray-700 mb-3">
        {language === 'es'
          ? '¿Tienes dudas sobre el pago? Contáctanos por WhatsApp'
          : 'Questions about payment? Contact us via WhatsApp'}
      </p>
      <Button
        variant="outline"
        className="w-full border-green-600 text-green-600 hover:bg-green-50"
        onClick={() => {
          const message = language === 'es'
            ? `Hola! Tengo una consulta sobre mi pago. Total: ${...}`
            : `Hello! I have a question about my payment. Total: ${...}`;
          window.open(generateWhatsAppURL(businessInfo.whatsapp, message), '_blank');
        }}
      >
        <MessageCircle className="mr-2 h-5 w-5" />
        {language === 'es' ? 'Contactar por WhatsApp' : 'Contact via WhatsApp'}
      </Button>
    </div>
  </div>
)}
```

**Características:**
- Solo se muestra si hay WhatsApp configurado en businessInfo
- Abre WhatsApp con mensaje pre-llenado incluyendo el total
- Mensaje bilingüe (ES/EN)
- Diseño verde para asociar con WhatsApp
- Incluye el monto total de la compra en el mensaje

## Beneficios

1. **Comprobantes de pago:** Ahora se pueden subir correctamente sin errores
2. **Sin errores 400:** Eliminados los errores de consola en system_messages
3. **Canal de soporte:** Los usuarios pueden contactar directamente por WhatsApp durante el pago
4. **Mejor UX:** Mensaje contextual con el total del pedido
5. **Conversión:** Facilita la resolución de dudas antes de abandonar el carrito

## Archivos Modificados

1. `/src/lib/imageUtils.js` - Lines 48-56: Agregado constraint payment_proof
2. `/src/lib/remittanceService.js` - Lines 12-24, 69-81, 88-97: Implementación temporal sin BD
3. `/src/components/CartPage.jsx` - Lines 3, 14, 18, 521-545: Agregado botón WhatsApp

## Testing Recomendado

- [ ] Subir comprobante de pago en formato JPG
- [ ] Subir comprobante de pago en formato PNG
- [ ] Subir comprobante de pago en formato WebP
- [ ] Verificar que no aparezcan errores 400 en consola
- [ ] Hacer clic en botón de WhatsApp (verificar que abre con mensaje correcto)
- [ ] Verificar que el total en el mensaje de WhatsApp es correcto
- [ ] Probar en idioma español e inglés

## Notas Técnicas

### TODO Futuro:
- Crear tabla dedicada `remittance_configurations` para almacenar configs de remesas
- Migrar de configs hardcodeadas a configs administrables desde SettingsPage
- Considerar agregar botón de WhatsApp también en confirmación de pedido

### Formato de mensaje WhatsApp:
```
Hola! Tengo una consulta sobre mi pago. Total: $123.45 USD
```

El mensaje incluye:
- Saludo
- Contexto (consulta sobre pago)
- Total con símbolo de moneda
- Código de moneda
