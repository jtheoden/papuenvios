# Plan de Mejoras UX/UI - Implementación Progresiva

**Fecha:** 2025-10-08
**Tokens restantes:** ~79,000 / 200,000

## Cambios Implementados ✅

### 1. UserPanel - Mejoras visuales
- ✅ **Nombre real del usuario** mostrado en lugar de username
- ✅ **Botón de WhatsApp** con mensaje informativo
  - Card verde destacado
  - Texto: "Ante dudas contactar a soporte vía WhatsApp"
  - Mensaje pre-llenado con nombre del usuario
- ✅ **Fondo correcto** usando `getBackgroundStyle()`

**Build compilado exitosamente.**

---

## Cambios Pendientes (Orden de Prioridad)

### ALTA PRIORIDAD - Crítico para funcionalidad

#### 1. Ocultar carrito para Admin/Super_Admin
**Archivo:** Header.jsx o NavBar component
**Cambio necesario:**
```javascript
// En el component del Header
{userRole !== 'admin' && userRole !== 'super_admin' && (
  <button onClick={() => onNavigate('cart')}>
    <ShoppingCart />
    {cart.length > 0 && <Badge>{cart.length}</Badge>}
  </button>
)}
```

#### 2. Badge de notificaciones para Admin
**Archivo:** Header.jsx
**Cambio necesario:**
```javascript
// Agregar query de órdenes pendientes
const [pendingOrdersCount, setPendingOrdersCount] = useState(0);

useEffect(() => {
  if (userRole === 'admin' || userRole === 'super_admin') {
    loadPendingOrders();
  }
}, [userRole]);

const loadPendingOrders = async () => {
  const { count } = await getPendingOrdersCount();
  setPendingOrdersCount(count);
};

// En el avatar del admin
<div className="relative">
  <Avatar />
  {pendingOrdersCount > 0 && (
    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
      {pendingOrdersCount}
    </span>
  )}
</div>
```

#### 3. Panel de Órdenes Pendientes (Admin)
**Archivo:** Nuevo componente `AdminOrdersPanel.jsx`
**Funcionalidad:**
- Vista de órdenes con `payment_status = 'pending'`
- Botones: Validar / Rechazar
- Modal con detalles completos:
  - Datos del usuario (nombre, email, teléfono)
  - Items del pedido con miniaturas
  - Comprobante de pago ampliable
  - Provincia y dirección de entrega
  - Desglose de costos
- Al validar: Actualiza estado, reduce inventario, notifica usuario
- Al rechazar: Input para razón, libera inventario, notifica usuario

**Integración en UserPanel.jsx:**
```javascript
const UserPanel = ({ onNavigate }) => {
  const { userRole } = useAuth();

  if (userRole === 'admin' || userRole === 'super_admin') {
    return <AdminOrdersPanel onNavigate={onNavigate} />;
  }

  return <UserOrdersPanel onNavigate={onNavigate} />;
};
```

#### 4. Formulario de Testimonials (User)
**Archivo:** UserPanel.jsx
**Ubicación:** Después de "Mis Pedidos"
**Campos:**
- Rating (1-5 estrellas)
- Comentario (textarea)
- Automático: user_id, avatar_url del userProfile
**Validación:**
- Solo usuarios que tengan al menos 1 orden validada
- Máximo 1 testimonial por usuario (o 1 por cada X días)

```javascript
<motion.div className="glass-effect p-6 rounded-2xl mt-6">
  <h2 className="text-2xl font-semibold mb-4">
    {language === 'es' ? 'Califica tu experiencia' : 'Rate your experience'}
  </h2>
  <form onSubmit={handleSubmitTestimonial}>
    <div className="mb-4">
      <label>{language === 'es' ? 'Calificación' : 'Rating'}</label>
      <StarRating value={rating} onChange={setRating} />
    </div>
    <div className="mb-4">
      <label>{language === 'es' ? 'Comentario' : 'Comment'}</label>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        rows={4}
        className="input-style w-full"
        placeholder={language === 'es' ? 'Comparte tu experiencia...' : 'Share your experience...'}
      />
    </div>
    <Button type="submit">
      {language === 'es' ? 'Enviar opinión' : 'Submit review'}
    </Button>
  </form>
</motion.div>
```

---

### MEDIA PRIORIDAD - Mejora UX

#### 5. Reorganizar SettingsPage con Tabs

**Decisión UX/UI:**
Usar **tabs verticales con íconos** en lugar de dropdown. Razones:
- Más intuitivo
- Acceso directo visual
- Mejor para opciones frecuentes
- Estándar en paneles de administración

**Estructura propuesta:**

```
┌─────────────────┬──────────────────────────────────────┐
│                 │  AJUSTES FINANCIEROS                 │
│ 💰 Financiero  │  ┌─────────────────────────────────┐ │
│ 🎨 Visual      │  │ Tasas de Referencia (sticky)    │ │
│ 📊 Contenido   │  │ USD: 1.00 | EUR: 0.92 | CUP: 24 │ │
│                 │  └─────────────────────────────────┘ │
│                 │                                      │
│                 │  • Ajustes Financieros              │
│                 │  • Tasas de Cambio                   │
│                 │  • Configuración de Remesas          │
│                 │  • Zonas de Envío                    │
│                 │                                      │
└─────────────────┴──────────────────────────────────────┘
```

**Tabs:**
1. **Financiero** 💰
   - Banner superior con tasas de referencia (sticky)
   - Ajustes Financieros (profit margins)
   - Gestión de Monedas
   - Tasas de Cambio
   - Configuración de Remesas
   - Zonas de Envío
   - Cuentas Zelle

2. **Visual** 🎨
   - Personalización de Apariencia (colores, logos)
   - Diapositivas de Portada (carousel)

3. **Contenido** 📊
   - Productos
   - Combos
   - Categorías
   - Testimonios

**Implementación:**
```javascript
const [activeTab, setActiveTab] = useState('financial');

const tabs = [
  { id: 'financial', icon: <DollarSign />, label_es: 'Financiero', label_en: 'Financial' },
  { id: 'visual', icon: <Palette />, label_es: 'Visual', label_en: 'Visual' },
  { id: 'content', icon: <FileText />, label_es: 'Contenido', label_en: 'Content' }
];

return (
  <div className="flex gap-6">
    {/* Sidebar */}
    <div className="w-48 space-y-2">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg ${
            activeTab === tab.id ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'
          }`}
        >
          {tab.icon}
          <span>{language === 'es' ? tab.label_es : tab.label_en}</span>
        </button>
      ))}
    </div>

    {/* Content */}
    <div className="flex-1">
      {activeTab === 'financial' && <FinancialSettings />}
      {activeTab === 'visual' && <VisualSettings />}
      {activeTab === 'content' && <ContentSettings />}
    </div>
  </div>
);
```

---

## Estimación de Tokens

| Tarea | Tokens estimados | Prioridad |
|-------|------------------|-----------|
| Ocultar carrito admin | ~5,000 | ALTA |
| Badge notificaciones | ~8,000 | ALTA |
| Panel Admin Órdenes | ~25,000 | ALTA |
| Formulario Testimonials | ~12,000 | ALTA |
| Reorganizar Settings | ~20,000 | MEDIA |
| **TOTAL** | **~70,000** | |

**Tokens disponibles:** ~79,000
**Margen de seguridad:** ~9,000 tokens

---

## Orden de Implementación Sugerido

### Sesión 1 (ahora) - ~40k tokens
1. ✅ UserPanel WhatsApp + nombre (HECHO)
2. Ocultar carrito para admin
3. Badge de notificaciones admin
4. Panel Admin Órdenes básico

### Sesión 2 (siguiente) - ~35k tokens
5. Formulario Testimonials
6. Reorganizar SettingsPage con tabs
7. Testing y ajustes finales

---

## Notas Técnicas

### Datos del usuario en orden (para admin):
Ya están disponibles en `getOrderById()`:
```javascript
{
  order: {
    recipient_info: JSON {
      fullName, phone, province, municipality, address
    },
    user_id: UUID,
    // Necesita join con user_profiles para email
  }
}
```

**Modificación necesaria en orderService.js:**
```javascript
.select(`
  *,
  order_items (*),
  currencies (code, symbol),
  shipping_zones (province_name, shipping_cost),
  user_profiles!orders_user_id_fkey (full_name, email, phone)  // <-- AGREGAR
`)
```

### Testimonials schema:
Ya existe en BD:
```sql
CREATE TABLE testimonials (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  rating integer CHECK (rating >= 1 AND rating <= 5),
  comment_es text,
  comment_en text,
  avatar_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz
);
```

---

## Archivos a Modificar

### UserPanel.jsx ✅
- Listo para compilar

### Header.jsx / NavBar.jsx
- Ocultar carrito para admin
- Agregar badge de notificaciones

### AdminOrdersPanel.jsx (NUEVO)
- Crear component completo

### UserPanel.jsx
- Agregar formulario testimonials

### SettingsPage.jsx
- Reorganizar con tabs

### orderService.js
- Agregar join con user_profiles

---

## Próximo Paso

**¿Quieres que continúe con la implementación de las tareas de ALTA PRIORIDAD?**

Si dices sí, implementaré en orden:
1. Ocultar carrito admin
2. Badge notificaciones
3. Panel Admin Órdenes
4. Formulario Testimonials

Esto usará ~40k tokens, dejando ~39k de margen para ajustes.
