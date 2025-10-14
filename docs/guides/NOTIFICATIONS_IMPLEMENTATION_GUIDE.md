# Guía de Implementación de Notificaciones

## Resumen
Este documento explica cómo implementar las notificaciones por email y WhatsApp cuando un usuario completa un pedido y sube el comprobante de pago.

## Estado Actual

### ✅ Implementado
1. **Configuración de notificaciones** en SettingsPage:
   - `notificationSettings.whatsapp`: Número de WhatsApp para soporte individual
   - `notificationSettings.whatsappGroup`: URL del grupo de WhatsApp para notificaciones
   - `notificationSettings.adminEmail`: Email del administrador

2. **Generación de URLs de WhatsApp** en `whatsappService.js`:
   - `generateWhatsAppURL()`: Crea URLs de WhatsApp con mensaje pre-llenado
   - `notifyAdminNewPayment()`: Genera mensaje de notificación (actualmente solo genera URL)

### 🔧 Pendiente de Implementar

## Opciones de Implementación

### Opción 1: Cliente-Side (Limitado)
**Pros**: Simple, no requiere backend
**Contras**: Requiere interacción del usuario, no es automático

**Implementación**:
En `CartPage.jsx` después de crear la orden:

```javascript
// Después de uploadPaymentProof exitoso
if (businessInfo?.whatsapp) {
  const message = notifyAdminNewPayment({
    orderNumber: createdOrder.order_number,
    customerName: user.profile?.full_name,
    total: totalWithShipping,
    currency: selectedCurrency,
    payment_proof_url: uploadResult.url
  }, language);

  const whatsappURL = generateWhatsAppURL(businessInfo.whatsapp, message);

  // Mostrar botón para que usuario notifique (opcional)
  // O abrir automáticamente (puede ser bloqueado por navegadores)
  window.open(whatsappURL, '_blank');
}

// Para grupo de WhatsApp
if (notificationSettings?.whatsappGroup) {
  window.open(notificationSettings.whatsappGroup, '_blank');
}
```

**Limitación**: Los emails NO pueden enviarse desde el cliente por razones de seguridad.

---

### Opción 2: Supabase Edge Functions (Recomendado)
**Pros**: Serverless, escalable, integrado con Supabase
**Contras**: Requiere configuración adicional

**Pasos de Implementación**:

#### 1. Crear Edge Function para Notificaciones

```bash
# En la terminal
cd supabase/functions
supabase functions new notify-order
```

Crear archivo `supabase/functions/notify-order/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const WHATSAPP_API_TOKEN = Deno.env.get('WHATSAPP_API_TOKEN') // Meta Business API

serve(async (req) => {
  try {
    const { orderData, notificationSettings } = await req.json()

    // 1. Enviar Email via Resend
    if (notificationSettings.adminEmail && RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'noreply@tudominio.com',
          to: notificationSettings.adminEmail,
          subject: `Nuevo Pedido: ${orderData.orderNumber}`,
          html: `
            <h2>Nuevo Pedido Recibido</h2>
            <p><strong>Pedido:</strong> ${orderData.orderNumber}</p>
            <p><strong>Cliente:</strong> ${orderData.customerName}</p>
            <p><strong>Total:</strong> $${orderData.total} ${orderData.currency}</p>
            <p><strong>Comprobante:</strong> <a href="${orderData.paymentProofUrl}">Ver comprobante</a></p>
          `
        })
      })
    }

    // 2. Enviar WhatsApp via Meta Business API
    if (notificationSettings.whatsapp && WHATSAPP_API_TOKEN) {
      const message = `🔔 *Nuevo Pedido*\\n\\nPedido: ${orderData.orderNumber}\\nCliente: ${orderData.customerName}\\nTotal: $${orderData.total} ${orderData.currency}\\n\\nComprobante: ${orderData.paymentProofUrl}`

      await fetch(`https://graph.facebook.com/v17.0/{PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: notificationSettings.whatsapp,
          type: 'text',
          text: { body: message }
        })
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
```

#### 2. Configurar Variables de Entorno

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxx
supabase secrets set WHATSAPP_API_TOKEN=EAAxxxxxx
```

#### 3. Llamar desde CartPage.jsx

```javascript
import { supabase } from '@/lib/supabase';

// Después de uploadPaymentProof exitoso
const { data, error } = await supabase.functions.invoke('notify-order', {
  body: {
    orderData: {
      orderNumber: createdOrder.order_number,
      customerName: user.profile?.full_name,
      total: totalWithShipping,
      currency: selectedCurrency,
      paymentProofUrl: uploadResult.url
    },
    notificationSettings: notificationSettings
  }
});
```

---

### Opción 3: Database Triggers + Edge Functions (Automático)
**Pros**: Completamente automático, no requiere código en frontend
**Contras**: Más complejo de configurar

**Implementación**:

```sql
-- Crear trigger en Supabase
CREATE OR REPLACE FUNCTION notify_new_order()
RETURNS TRIGGER AS $$
BEGIN
  -- Llamar Edge Function cuando se crea una orden con payment_proof_url
  IF NEW.payment_proof_url IS NOT NULL AND OLD.payment_proof_url IS NULL THEN
    PERFORM net.http_post(
      url := 'https://your-project.supabase.co/functions/v1/notify-order',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'orderId', NEW.id,
        'orderNumber', NEW.order_number
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_order_payment_proof
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_order();
```

---

## Servicios de Email Recomendados

### 1. Resend (Recomendado)
- **Pros**: Fácil de usar, moderno, buena documentación
- **Precio**: 100 emails gratis/día, $20/mes para 50k emails
- **Setup**: https://resend.com/

### 2. SendGrid
- **Pros**: Popular, confiable
- **Precio**: 100 emails gratis/día, planes desde $15/mes
- **Setup**: https://sendgrid.com/

### 3. AWS SES
- **Pros**: Muy económico para alto volumen
- **Precio**: $0.10 por 1000 emails
- **Setup**: Requiere configuración AWS

---

## Servicios de WhatsApp Recomendados

### 1. Meta WhatsApp Business API (Oficial)
- **Pros**: Oficial, confiable, soporta templates
- **Precio**: Varía por país, primeras 1000 conversaciones gratis/mes
- **Setup**: https://developers.facebook.com/docs/whatsapp

### 2. Twilio WhatsApp API
- **Pros**: Fácil de usar, buena documentación
- **Precio**: ~$0.005 por mensaje
- **Setup**: https://www.twilio.com/whatsapp

### 3. Cliente-Side (Limitado)
- **Pros**: Gratis, no requiere API
- **Contras**: Requiere click del usuario, abre WhatsApp web/app
- **Uso**: Ya implementado en `generateWhatsAppURL()`

---

## Recomendación Final

**Para Producción**: Usar **Opción 2** (Supabase Edge Functions)
- Email: **Resend** (simple y moderno)
- WhatsApp: **Twilio** (más fácil que Meta API) o **Cliente-Side** (gratis, requiere click)

**Para MVP/Testing**: Usar **Opción 1** (Cliente-Side)
- WhatsApp: Ya implementado con `generateWhatsAppURL()`
- Email: Mostrar mensaje al admin para revisar panel

---

## Siguiente Paso

Decidir qué opción implementar basado en:
1. **Presupuesto**: ¿Hay budget para servicios de email/WhatsApp?
2. **Volumen**: ¿Cuántos pedidos por día se esperan?
3. **UX**: ¿Es aceptable que el usuario tenga que hacer click para notificar?
4. **Tiempo**: ¿Cuánto tiempo hay para implementar?

**Mi recomendación inmediata**: Implementar Opción 1 (cliente-side) para WhatsApp y agregar Opción 2 (Edge Functions) para email cuando haya más tiempo.
