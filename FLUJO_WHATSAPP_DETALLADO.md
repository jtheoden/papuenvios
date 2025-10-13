# Flujo Detallado - Mensaje Automático WhatsApp

**Tokens**: 120,751 / 200,000 (60.4%)

---

## 📱 FLUJO COMPLETO: Desde Click hasta WhatsApp

### FASE 1: Usuario Confirma Pedido

**Archivo**: `CartPage.jsx`
**Ubicación**: Usuario en página del carrito con comprobante subido

```
┌─────────────────────────────────────┐
│  CARRITO DE COMPRAS                 │
│                                     │
│  Producto 1: $10.00                 │
│  Producto 2: $15.00                 │
│  Envío: $5.00                       │
│  ─────────────────                  │
│  Total: $30.00 USD                  │
│                                     │
│  Comprobante: ✅ pago.jpg           │
│                                     │
│  [CONFIRMAR PAGO] ◄── USUARIO CLICK │
└─────────────────────────────────────┘
```

**Código que se ejecuta** (`CartPage.jsx:257`):
```javascript
const handleConfirmPayment = async () => {
  // ... validaciones
  setProcessingPayment(true);
  // ...
}
```

---

### FASE 2: Creación de la Orden en Base de Datos

**Líneas 283-355 de CartPage.jsx**

```javascript
// 1. Obtener moneda
const currency = currencies.find(c => c.code === selectedCurrency);

// 2. Obtener zona de envío
const shippingZone = shippingZones.find(z =>
  z.province_name === recipientDetails.province
);

// 3. Preparar items de la orden
const orderItems = cart.map(item => ({
  itemType: item.type || 'product',
  itemId: item.id,
  nameEs: item.name_es || item.name,
  quantity: item.quantity,
  unitPrice: getItemPrice(item),
  totalPrice: getItemPrice(item) * item.quantity,
  inventoryId: item.inventory_id || null
}));

// 4. Preparar datos de la orden
const orderData = {
  userId: user.id,
  orderType: 'product',
  subtotal: subtotal,
  shippingCost: shippingCost,
  totalAmount: subtotal + shippingCost,
  currencyId: currency.id,
  recipientInfo: JSON.stringify(recipientDetails),
  paymentMethod: 'zelle',
  shippingZoneId: shippingZone?.id || null,
  zelleAccountId: null
};

// 5. CREAR ORDEN EN SUPABASE
const orderResult = await createOrder(orderData, orderItems);
```

**Base de Datos - Tablas Afectadas**:
```sql
-- Tabla: orders
INSERT INTO orders (
  order_number,        -- "ORD-20251010-12345" (generado)
  user_id,            -- UUID del usuario
  order_type,         -- "product"
  status,             -- "pending"
  subtotal,           -- 25.00
  shipping_cost,      -- 5.00
  total_amount,       -- 30.00
  currency_id,        -- UUID de USD
  recipient_info,     -- JSON con datos del destinatario
  payment_method,     -- "zelle"
  payment_status,     -- "pending"
  shipping_zone_id,   -- UUID de zona
  created_at          -- TIMESTAMP
) RETURNING *;

-- Tabla: order_items (para cada producto)
INSERT INTO order_items (
  order_id,           -- UUID de la orden creada
  item_type,          -- "product"
  item_id,            -- UUID del producto
  name_es,            -- "Football Ball"
  quantity,           -- 2
  unit_price,         -- 10.00
  total_price,        -- 20.00
  inventory_id        -- UUID del inventario
);
```

**Resultado**:
```javascript
const createdOrder = {
  id: "a1b2c3d4-...",
  order_number: "ORD-20251010-12345",
  user_id: "user-uuid-...",
  total_amount: 30.00,
  status: "pending",
  created_at: "2025-10-10T14:30:45Z"
  // ... más campos
}
```

---

### FASE 3: Upload del Comprobante de Pago

**Líneas 358-364 de CartPage.jsx**

```javascript
// Upload payment proof to Supabase Storage
const uploadResult = await uploadPaymentProof(
  paymentProof,        // File object
  createdOrder.id      // Order UUID
);

if (!uploadResult.success) {
  console.error('Error uploading payment proof:', uploadResult.error);
  // Continue anyway - order is created
}
```

**Supabase Storage**:
```
Bucket: payment-proofs/
├── {order-uuid-1}/proof.jpg
├── {order-uuid-2}/proof.png
└── {createdOrder.id}/pago.jpg  ← Se sube aquí
```

**Resultado**:
```javascript
{
  success: true,
  url: "https://qcw...supabase.co/storage/v1/object/public/payment-proofs/{order-id}/pago.jpg"
}
```

---

### FASE 4: Preparación del Mensaje WhatsApp

**Líneas 366-380 de CartPage.jsx**

```javascript
// INICIO: Verificar que esté configurado el WhatsApp del admin
if (businessInfo?.whatsapp) {

  // 1. CALCULAR TOTAL
  const totalAmount = subtotal + shippingCost;
  // Ejemplo: 25.00 + 5.00 = 30.00

  // 2. CONSTRUIR MENSAJE CON DATOS DE LA ORDEN
  const message =
    `🔔 *${language === 'es' ? 'NUEVO PEDIDO' : 'NEW ORDER'}*\n\n` +

    // Número de pedido (en negrita con *)
    `📋 ${language === 'es' ? 'Pedido' : 'Order'}: *${createdOrder.order_number}*\n` +

    // Datos del cliente
    `👤 ${language === 'es' ? 'Cliente' : 'Customer'}: ${recipientDetails.fullName}\n` +
    `📞 ${language === 'es' ? 'Teléfono' : 'Phone'}: ${recipientDetails.phone}\n` +

    // Total (en negrita)
    `💰 ${language === 'es' ? 'Total' : 'Total'}: *$${totalAmount.toFixed(2)} ${selectedCurrency}*\n` +

    // Dirección de entrega
    `📍 ${language === 'es' ? 'Dirección' : 'Address'}:\n` +
    `   ${recipientDetails.province} - ${recipientDetails.municipality}\n` +
    `   ${recipientDetails.address}\n\n` +

    // Estado del comprobante
    `📸 ${language === 'es' ? 'Comprobante de pago subido' : 'Payment proof uploaded'}\n` +

    // Timestamp
    `⏰ ${new Date().toLocaleString(language === 'es' ? 'es-CU' : 'en-US')}`;

  // ... continúa en siguiente fase
}
```

**Variables Disponibles en este Punto**:
```javascript
createdOrder = {
  order_number: "ORD-20251010-12345",
  id: "uuid-...",
  total_amount: 30.00
}

recipientDetails = {
  fullName: "Juan Pérez",
  phone: "+5312345678",
  province: "La Habana",
  municipality: "Plaza de la Revolución",
  address: "Calle 23 #456 entre A y B"
}

businessInfo = {
  whatsapp: "+5398765432"  // Número configurado en Settings
}

totalAmount = 30.00
selectedCurrency = "USD"
language = "es"
```

**Mensaje Resultante** (string completo):
```
🔔 *NUEVO PEDIDO*

📋 Pedido: *ORD-20251010-12345*
👤 Cliente: Juan Pérez
📞 Teléfono: +5312345678
💰 Total: *$30.00 USD*
📍 Dirección:
   La Habana - Plaza de la Revolución
   Calle 23 #456 entre A y B

📸 Comprobante de pago subido
⏰ 10/10/2025, 14:30:45
```

---

### FASE 5: Generación de URL de WhatsApp

**Líneas 382-384 de CartPage.jsx**

```javascript
// 3. GENERAR URL DE WHATSAPP
const whatsappURL = generateWhatsAppURL(
  businessInfo.whatsapp,  // "+5398765432"
  message                 // Mensaje completo del paso anterior
);

// 4. ABRIR WHATSAPP
window.open(whatsappURL, '_blank', 'noopener,noreferrer');
```

**Función `generateWhatsAppURL()`** - Archivo: `whatsappService.js:51-58`

```javascript
export const generateWhatsAppURL = (phone, message = '') => {
  // PASO 1: Formatear teléfono
  const formattedPhone = formatPhoneForWhatsApp(phone);

  // PASO 2: Codificar mensaje para URL
  const encodedMessage = encodeURIComponent(message);

  // PASO 3: Construir URL de WhatsApp
  return `https://wa.me/${formattedPhone}?text=${encodedMessage}`;
};
```

**Detalle del Formateo del Teléfono**:

```javascript
// formatPhoneForWhatsApp("+5398765432")

function formatPhoneForWhatsApp(phone) {
  // 1. Limpiar caracteres no-numéricos
  let cleaned = phone.replace(/\D/g, '');
  // "+5398765432" → "5398765432"

  // 2. Manejar códigos de país
  if (cleaned.startsWith('1')) {
    cleaned = cleaned.substring(1); // US/Canada
  } else if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1); // Quitar 0 inicial
  }
  // "5398765432" → "5398765432" (Cuba, se mantiene)

  return cleaned;
}

// RESULTADO: "5398765432"
```

**Detalle de la Codificación del Mensaje**:

```javascript
// encodeURIComponent(mensaje)

// ANTES (string original):
"🔔 *NUEVO PEDIDO*\n\n📋 Pedido: *ORD-20251010-12345*\n..."

// DESPUÉS (URL encoded):
"%F0%9F%94%94%20*NUEVO%20PEDIDO*%0A%0A%F0%9F%93%8B%20Pedido%3A%20*ORD-20251010-12345*%0A..."

// Ejemplos de codificación:
// 🔔 → %F0%9F%94%94
// * → *  (no se codifica)
// \n → %0A
// espacio → %20
// : → %3A
```

**URL Final Generada**:
```
https://wa.me/5398765432?text=%F0%9F%94%94%20*NUEVO%20PEDIDO*%0A%0A%F0%9F%93%8B%20Pedido%3A%20*ORD-20251010-12345*%0A%F0%9F%91%A4%20Cliente%3A%20Juan%20P%C3%A9rez%0A%F0%9F%93%9E%20Tel%C3%A9fono%3A%20%2B5312345678%0A%F0%9F%92%B0%20Total%3A%20*%2430.00%20USD*%0A%F0%9F%93%8D%20Direcci%C3%B3n%3A%0A%20%20%20La%20Habana%20-%20Plaza%20de%20la%20Revoluci%C3%B3n%0A%20%20%20Calle%2023%20%23456%20entre%20A%20y%20B%0A%0A%F0%9F%93%B8%20Comprobante%20de%20pago%20subido%0A%E2%8F%B0%2010%2F10%2F2025%2C%2014%3A30%3A45
```

---

### FASE 6: Apertura de WhatsApp

**Línea 384 de CartPage.jsx**

```javascript
window.open(whatsappURL, '_blank', 'noopener,noreferrer');
```

**Parámetros de `window.open()`**:
- `whatsappURL`: URL completa de WhatsApp
- `'_blank'`: Abrir en nueva pestaña/ventana
- `'noopener,noreferrer'`: Seguridad (no compartir contexto)

**Comportamiento del Navegador**:

#### En Desktop:
```
1. Navegador detecta protocolo wa.me
2. Si WhatsApp Web está activo:
   → Abre WhatsApp Web en nueva pestaña
3. Si no está activo:
   → Redirige a https://web.whatsapp.com con mensaje pre-llenado
4. Usuario ve chat con admin listo
```

#### En Mobile:
```
1. Navegador detecta protocolo wa.me
2. Sistema operativo pregunta:
   "Abrir con WhatsApp?"
3. Usuario toca "Abrir"
4. App WhatsApp se abre
5. Chat con admin aparece con mensaje listo
```

---

### FASE 7: WhatsApp Renderiza el Mensaje

**En WhatsApp Web (Desktop)**:

```
┌────────────────────────────────────────┐
│ WhatsApp Web                     [×]   │
├────────────────────────────────────────┤
│ 🔍 Buscar                              │
├────────────────────────────────────────┤
│ Chats    Estados    Llamadas           │
├────────────────────────────────────────┤
│                                        │
│  ┌──────────────────────────────────┐ │
│  │ +5398765432 (Admin)              │ │
│  ├──────────────────────────────────┤ │
│  │                                  │ │
│  │  🔔 *NUEVO PEDIDO*              │ │
│  │                                  │ │
│  │  📋 Pedido: *ORD-20251010-12345*│ │
│  │  👤 Cliente: Juan Pérez          │ │
│  │  📞 Teléfono: +5312345678        │ │
│  │  💰 Total: *$30.00 USD*          │ │
│  │  📍 Dirección:                   │ │
│  │     La Habana - Plaza...         │ │
│  │     Calle 23 #456...             │ │
│  │                                  │ │
│  │  📸 Comprobante de pago subido   │ │
│  │  ⏰ 10/10/2025, 14:30:45         │ │
│  │                                  │ │
│  ├──────────────────────────────────┤ │
│  │ Escribe un mensaje...      [🎤] │ │
│  │ ▲ MENSAJE LISTO            [>] │ │
│  └──────────────────────────────────┘ │
│                                        │
└────────────────────────────────────────┘
           ↑
     ADMIN SOLO PRESIONA ESTE BOTÓN
```

**En App WhatsApp (Mobile)**:

```
┌─────────────────────────┐
│ ← +5398765432 (Admin)   │
├─────────────────────────┤
│                         │
│  🔔 *NUEVO PEDIDO*     │
│                         │
│  📋 Pedido:             │
│  *ORD-20251010-12345*   │
│                         │
│  👤 Cliente:            │
│  Juan Pérez             │
│                         │
│  📞 Teléfono:           │
│  +5312345678            │
│                         │
│  💰 Total:              │
│  *$30.00 USD*           │
│                         │
│  📍 Dirección:          │
│  La Habana - Plaza...   │
│  Calle 23 #456...       │
│                         │
│  📸 Comprobante...      │
│  ⏰ 10/10/2025...       │
│                         │
├─────────────────────────┤
│ Escribe...         [🎤]│
│ ▲ MENSAJE LISTO    [>] │
└─────────────────────────┘
```

---

### FASE 8: Admin Envía el Mensaje

**Acción del Admin**:
```
1. Ve el mensaje completo pre-escrito
2. Presiona botón "Enviar" (>)
3. ✅ MENSAJE ENVIADO
```

**Resultado en WhatsApp**:
```
Chat: +5398765432 ↔ +5312345678

[14:30:45] +5312345678 (Cliente):
🔔 *NUEVO PEDIDO*

📋 Pedido: *ORD-20251010-12345*
👤 Cliente: Juan Pérez
📞 Teléfono: +5312345678
💰 Total: *$30.00 USD*
📍 Dirección:
   La Habana - Plaza de la Revolución
   Calle 23 #456 entre A y B

📸 Comprobante de pago subido
⏰ 10/10/2025, 14:30:45

                    ✓✓ (Entregado)
```

---

### FASE 9: Confirmación al Usuario

**Líneas 387-393 de CartPage.jsx**

```javascript
// Success toast
toast({
  title: language === 'es' ? '✅ Pedido confirmado' : '✅ Order confirmed',
  description: language === 'es'
    ? `Tu pedido ${createdOrder.order_number} ha sido creado. Recibirás una notificación cuando sea validado.`
    : `Your order ${createdOrder.order_number} has been created. You'll receive a notification when it's validated.`
});
```

**Vista del Usuario**:
```
┌──────────────────────────────────────┐
│  ✅ Pedido confirmado                │
│  Tu pedido ORD-20251010-12345 ha     │
│  sido creado. Recibirás una          │
│  notificación cuando sea validado.   │
└──────────────────────────────────────┘
```

**Líneas 395-396**:
```javascript
// Clear cart and navigate
clearCart();
onNavigate('user-panel');
```

**Usuario es redirigido a**:
```
Panel de Usuario → Mis Pedidos

Donde verá:
┌─────────────────────────────────────┐
│ ORD-20251010-12345                  │
│ 10 de Octubre 2025                  │
│ $30.00 USD                          │
│ [Pendiente] [💬] [👁️]              │
└─────────────────────────────────────┘
```

---

## 🔄 DIAGRAMA DE FLUJO COMPLETO

```
┌─────────────────┐
│ Usuario hace    │
│ click en        │
│ CONFIRMAR PAGO  │
└────────┬────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ Validaciones:                       │
│ ✓ Comprobante existe                │
│ ✓ Usuario autenticado               │
│ ✓ Datos completos                   │
└────────┬────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ Preparar datos de orden:            │
│ • Currency ID (USD)                 │
│ • Shipping Zone ID (La Habana)      │
│ • Order Items (productos)           │
│ • Totales (subtotal + envío)        │
└────────┬────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ CREATE ORDER (Supabase)             │
│                                     │
│ INSERT INTO orders (...)            │
│ → Genera order_number               │
│ → Retorna orden creada              │
│                                     │
│ INSERT INTO order_items (...)       │
│ → Para cada producto                │
└────────┬────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ Upload Payment Proof (Storage)      │
│                                     │
│ PUT payment-proofs/{order-id}/...   │
│ → Retorna URL pública               │
└────────┬────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ ¿businessInfo.whatsapp existe?      │
└────┬───────────────────────┬────────┘
     │ NO                    │ SI
     │                       │
     ↓                       ↓
  [Skip]          ┌──────────────────────┐
                  │ Construir mensaje:   │
                  │ • Pedido number      │
                  │ • Datos cliente      │
                  │ • Total y dirección  │
                  │ • Timestamp          │
                  └──────┬───────────────┘
                         │
                         ↓
                  ┌──────────────────────┐
                  │ formatPhoneForWhatsApp│
                  │ "+5398765432"        │
                  │     ↓                │
                  │ "5398765432"         │
                  └──────┬───────────────┘
                         │
                         ↓
                  ┌──────────────────────┐
                  │ encodeURIComponent   │
                  │ (mensaje)            │
                  │     ↓                │
                  │ %F0%9F%94%94%20...   │
                  └──────┬───────────────┘
                         │
                         ↓
                  ┌──────────────────────────────┐
                  │ Construir URL:               │
                  │ https://wa.me/5398765432?... │
                  └──────┬───────────────────────┘
                         │
                         ↓
                  ┌──────────────────────┐
                  │ window.open(url)     │
                  └──────┬───────────────┘
                         │
                         ↓
                  ┌──────────────────────────┐
                  │ Desktop → WhatsApp Web   │
                  │ Mobile  → WhatsApp App   │
                  └──────┬───────────────────┘
                         │
                         ↓
                  ┌──────────────────────────┐
                  │ WhatsApp renderiza:      │
                  │ • Mensaje completo       │
                  │ • Listo para enviar      │
                  └──────┬───────────────────┘
                         │
                         ↓
                  ┌──────────────────────────┐
                  │ Admin presiona "Enviar"  │
                  └──────┬───────────────────┘
                         │
                         ↓
                  ┌──────────────────────────┐
                  │ ✅ Mensaje enviado       │
                  │ Chat guardado            │
                  └──────────────────────────┘
```

---

## ⏱️ TIMING Y RENDIMIENTO

### Tiempos Aproximados:

1. **Click → Validaciones**: ~100ms
2. **Crear Orden en BD**: ~200-500ms
3. **Upload Comprobante**: ~500-1500ms (depende de imagen)
4. **Construir Mensaje**: ~1ms
5. **Generar URL**: ~1ms
6. **Abrir WhatsApp**: ~100-300ms
7. **Total Desktop**: ~1-2 segundos
8. **Total Mobile**: ~2-3 segundos

---

## 🔒 SEGURIDAD Y PRIVACIDAD

### Datos que se Comparten:
- ✅ Número de orden (público para admin)
- ✅ Nombre cliente (necesario para envío)
- ✅ Teléfono cliente (para contacto)
- ✅ Dirección (necesaria para envío)
- ✅ Total (información de la orden)

### Datos que NO se Comparten:
- ❌ Email del cliente
- ❌ Contraseña
- ❌ Datos de pago (solo comprobante)
- ❌ Historial de compras
- ❌ Datos personales adicionales

### Seguridad del Mensaje:
- ✅ Encriptado end-to-end por WhatsApp
- ✅ Solo visible para admin destinatario
- ✅ No pasa por servidores propios
- ✅ URL temporal (no almacenada)

---

## 🐛 TROUBLESHOOTING

### Problema: WhatsApp no abre
**Causas posibles**:
1. `businessInfo.whatsapp` no configurado
2. Bloqueador de popups activo
3. WhatsApp no instalado (mobile)

**Debug**:
```javascript
console.log('businessInfo.whatsapp:', businessInfo?.whatsapp);
console.log('whatsappURL:', whatsappURL);
```

### Problema: Mensaje vacío
**Causa**: Error en construcción del mensaje

**Debug**:
```javascript
console.log('message:', message);
console.log('encodedMessage:', encodeURIComponent(message));
```

### Problema: Caracteres raros
**Causa**: Encoding incorrecto

**Solución**: Usar `encodeURIComponent()` siempre

---

## 📊 ESTADO ACTUAL

**Configuración Requerida**:
- [x] Campo `whatsapp` en Settings
- [x] Función `generateWhatsAppURL()`
- [x] Mensaje con todos los datos
- [x] Apertura automática
- [x] Soporte Desktop + Mobile

**Funcionamiento**:
- ✅ 100% Automático
- ✅ 1 solo click para admin
- ✅ Sin copiar/pegar
- ✅ Sin APIs de pago
- ✅ Sin intermediarios

---

**FLUJO COMPLETAMENTE DOCUMENTADO** ✅
