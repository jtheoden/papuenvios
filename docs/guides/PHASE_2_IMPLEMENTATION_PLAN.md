# Plan de Implementación - Fase 2

## Estado Actual: Tokens ~84k/200k (42% usado)

## ✅ Completado en esta sesión

### 1. Avatar y Nombre Completo en Testimonios
- **Archivo**: `src/lib/testimonialService.js`
- Agregado join con `user_profiles` para obtener `full_name` y `avatar_url`
- Fallback a avatar generado con UI Avatars API
- **HomePage.jsx** actualizado para mostrar avatar del usuario

### 2. Deducción de Inventario al Validar Pago
- **Archivo**: `src/lib/orderService.js` - función `validatePayment()`
- ✅ Reduce inventario de productos directos
- ✅ Reduce inventario de productos en combos (maneja combo_items)
- ✅ Calcula cantidad correcta: `combo_quantity * item_quantity_in_combo`

---

## 📋 Tareas Pendientes (Requieren implementación adicional)

### 3. Notificación Email al Usuario (Despacho de Orden)

**Requerimiento**: Enviar email al usuario cuando admin valida el pago, incluyendo fecha estimada de entrega.

**Implementación Recomendada**: Edge Function + Resend

**Archivo a crear**: `supabase/functions/notify-user-dispatch/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

serve(async (req) => {
  const { orderId, userId } = await req.json()

  // Get order details
  const supabase = createClient(...)
  const { data: order } = await supabase
    .from('orders')
    .select('*, user_profiles(*), shipping_zones(*)')
    .eq('id', orderId)
    .single()

  // Send email
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'noreply@tudominio.com',
      to: order.user_profiles.email,
      subject: `✅ Pedido ${order.order_number} Aprobado`,
      html: `
        <h2>¡Tu pedido ha sido aprobado!</h2>
        <p>Pedido: <strong>${order.order_number}</strong></p>
        <p>Fecha estimada de entrega: <strong>${order.estimated_delivery_date}</strong></p>
        <p>Estado: En procesamiento</p>
      `
    })
  })

  return new Response(JSON.stringify({ success: true }))
})
```

**Llamar desde**: `orderService.js` - función `validatePayment()` después de actualizar el estado

**Configurar**:
```bash
supabase secrets set RESEND_API_KEY=re_xxxxxx
```

---

### 4. Configuración de Fechas de Entrega por Zona

**SQL Migration**: Ya incluida en `MIGRATIONS_PHASE_2.sql`
- Campos agregados a `shipping_zones`: `delivery_days`, `delivery_note`

**UI a crear**: `src/components/SettingsPage.jsx` - Tab "Envíos"

**Componente sugerido**:
```jsx
// En Tab Envíos, agregar por cada zona:
<div className="space-y-2">
  <label>Días de entrega estimados</label>
  <input
    type="number"
    value={zone.delivery_days}
    onChange={(e) => updateZone(zone.id, { delivery_days: e.target.value })}
    className="w-20 input-style"
  />

  <label>Costo de transporte (interno)</label>
  <input
    type="number"
    step="0.01"
    value={zone.transport_cost}
    onChange={(e) => updateZone(zone.id, { transport_cost: e.target.value })}
    className="w-32 input-style"
  />

  <label>Nota de entrega (opcional)</label>
  <textarea
    value={zone.delivery_note}
    onChange={(e) => updateZone(zone.id, { delivery_note: e.target.value })}
    className="w-full input-style"
  />

  <Button
    onClick={() => updateZone(zone.id, { is_active: !zone.is_active })}
    variant={zone.is_active ? 'default' : 'outline'}
  >
    {zone.is_active ? 'Desactivar Zona' : 'Activar Zona'}
  </Button>
</div>
```

**Servicio a actualizar**: `src/lib/shippingService.js`
```javascript
export const updateShippingZone = async (zoneId, updates) => {
  const { data, error } = await supabase
    .from('shipping_zones')
    .update(updates)
    .eq('id', zoneId)
    .select()
    .single();

  return { data, error };
};
```

**Cálculo automático de fecha de entrega**:
En `orderService.js` - función `validatePayment()`:
```javascript
// Calcular fecha estimada de entrega
const deliveryDate = new Date();
deliveryDate.setDate(deliveryDate.getDate() + (order.shipping_zones?.delivery_days || 3));

await supabase
  .from('orders')
  .update({
    payment_status: 'validated',
    status: 'processing',
    estimated_delivery_date: deliveryDate.toISOString().split('T')[0],
    // ...
  })
```

---

### 5. Sistema de Mensajes Admin → Usuario

**SQL Migration**: Ya incluida en `MIGRATIONS_PHASE_2.sql`
- Tabla `admin_messages` con RLS policies

**Servicio a crear**: `src/lib/messageService.js`
```javascript
export const createAdminMessage = async (userId, subject, message, orderId = null) => {
  const { data, error } = await supabase
    .from('admin_messages')
    .insert({
      user_id: userId,
      admin_id: (await supabase.auth.getUser()).data.user.id,
      subject,
      message,
      related_order_id: orderId
    })
    .select()
    .single();

  return { data, error };
};

export const getUserMessages = async (userId) => {
  const { data, error } = await supabase
    .from('admin_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return { data, error };
};

export const getUnreadCount = async (userId) => {
  const { count, error } = await supabase
    .from('admin_messages')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  return { count, error };
};

export const markAsRead = async (messageId) => {
  const { error } = await supabase
    .from('admin_messages')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', messageId);

  return { error };
};
```

**Header.jsx - Badge de notificaciones**:
```jsx
const [unreadMessages, setUnreadMessages] = useState(0);

useEffect(() => {
  if (user && userRole === 'user') {
    const loadUnreadCount = async () => {
      const { count } = await getUnreadCount(user.id);
      setUnreadMessages(count || 0);
    };
    loadUnreadCount();

    // Poll every 30 seconds
    const interval = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(interval);
  }
}, [user, userRole]);

// En el avatar
{unreadMessages > 0 && (
  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
    {unreadMessages}
  </span>
)}
```

**UserPanel.jsx - Sección de mensajes**:
```jsx
const [messages, setMessages] = useState([]);

useEffect(() => {
  const loadMessages = async () => {
    const { data } = await getUserMessages(user.id);
    setMessages(data || []);
  };
  loadMessages();
}, [user.id]);

// Renderizar
<div className="p-8 rounded-2xl bg-white">
  <h2>Mensajes</h2>
  {messages.map(msg => (
    <div key={msg.id} className={`p-4 border rounded ${!msg.is_read ? 'bg-blue-50' : ''}`}>
      <div className="flex justify-between">
        <h3>{msg.subject}</h3>
        <span className="text-sm text-gray-500">
          {new Date(msg.created_at).toLocaleDateString()}
        </span>
      </div>
      <p>{msg.message}</p>
      {msg.related_order_id && (
        <Button size="sm" onClick={() => viewOrder(msg.related_order_id)}>
          Ver Pedido
        </Button>
      )}
    </div>
  ))}
</div>
```

---

### 6. Costos Operacionales (Tab Financiero)

**SQL Migration**: Ya incluida en `MIGRATIONS_PHASE_2.sql`
- Tabla `operational_costs` con RLS policies
- Función `get_daily_operational_cost()` para cálculos

**Servicio a crear**: `src/lib/operationalCostService.js`
```javascript
export const getOperationalCosts = async () => {
  const { data, error } = await supabase
    .from('operational_costs')
    .select('*')
    .order('created_at', { ascending: false });

  return { data, error };
};

export const createOperationalCost = async (costData) => {
  const { data, error } = await supabase
    .from('operational_costs')
    .insert({
      cost_name: costData.name,
      amount: costData.amount,
      frequency: costData.frequency,
      category: costData.category,
      description: costData.description,
      created_by: (await supabase.auth.getUser()).data.user.id
    })
    .select()
    .single();

  return { data, error };
};

export const updateOperationalCost = async (id, updates) => {
  const { data, error } = await supabase
    .from('operational_costs')
    .update({...updates, updated_at: new Date().toISOString()})
    .eq('id', id)
    .select()
    .single();

  return { data, error };
};

export const deleteOperationalCost = async (id) => {
  const { error } = await supabase
    .from('operational_costs')
    .update({ is_active: false })
    .eq('id', id);

  return { error };
};

export const getDailyCost = async () => {
  const { data, error } = await supabase
    .rpc('get_daily_operational_cost');

  return { data, error };
};
```

**SettingsPage.jsx - Tab Financiero**:
```jsx
const [operationalCosts, setOperationalCosts] = useState([]);
const [showCostForm, setShowCostForm] = useState(false);
const [newCost, setNewCost] = useState({
  name: '',
  amount: 0,
  frequency: 'monthly',
  category: 'other',
  description: ''
});

// Formulario
<div className="space-y-4">
  <input
    placeholder="Nombre del costo (ej: Electricidad)"
    value={newCost.name}
    onChange={(e) => setNewCost({...newCost, name: e.target.value})}
  />
  <input
    type="number"
    placeholder="Monto"
    value={newCost.amount}
    onChange={(e) => setNewCost({...newCost, amount: e.target.value})}
  />
  <select
    value={newCost.frequency}
    onChange={(e) => setNewCost({...newCost, frequency: e.target.value})}
  >
    <option value="daily">Diario</option>
    <option value="weekly">Semanal</option>
    <option value="biweekly">Quincenal</option>
    <option value="monthly">Mensual</option>
    <option value="yearly">Anual</option>
  </select>
  <select
    value={newCost.category}
    onChange={(e) => setNewCost({...newCost, category: e.target.value})}
  >
    <option value="energy">Energía</option>
    <option value="salaries">Salarios</option>
    <option value="rent">Renta</option>
    <option value="supplies">Suministros</option>
    <option value="other">Otro</option>
  </select>
  <textarea
    placeholder="Descripción (opcional)"
    value={newCost.description}
    onChange={(e) => setNewCost({...newCost, description: e.target.value})}
  />
  <Button onClick={handleCreateCost}>Agregar Costo</Button>
</div>

// Lista de costos
<div className="space-y-2">
  {operationalCosts.map(cost => (
    <div key={cost.id} className="flex justify-between items-center p-3 border rounded">
      <div>
        <p className="font-semibold">{cost.cost_name}</p>
        <p className="text-sm text-gray-600">{cost.category} - {cost.frequency}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-bold">${cost.amount}</span>
        <Button size="sm" variant="destructive" onClick={() => deleteCost(cost.id)}>
          Eliminar
        </Button>
      </div>
    </div>
  ))}
</div>
```

---

### 7. Tab de Pedidos en Administración

**Componente a crear**: `src/components/OrdersAdminPage.jsx`

**Características**:
- Tabla con todos los pedidos
- Filtros: usuario, fecha creación, fecha procesamiento, zona, estado
- Modal con detalles del pedido (similar a UserPanel)
- Botones de acción (validar, rechazar, marcar como entregado)

**Estructura sugerida**:
```jsx
const [orders, setOrders] = useState([]);
const [filters, setFilters] = useState({
  userId: '',
  startDate: '',
  endDate: '',
  province: '',
  municipality: '',
  status: 'all'
});

// Filtros en la parte superior
<div className="grid grid-cols-6 gap-4 mb-6">
  <select onChange={(e) => setFilters({...filters, userId: e.target.value})}>
    <option value="">Todos los usuarios</option>
    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
  </select>

  <input
    type="date"
    onChange={(e) => setFilters({...filters, startDate: e.target.value})}
  />

  <input
    type="date"
    onChange={(e) => setFilters({...filters, endDate: e.target.value})}
  />

  <select onChange={(e) => setFilters({...filters, province: e.target.value})}>
    <option value="">Todas las provincias</option>
    {provinces.map(p => <option key={p} value={p}>{p}</option>)}
  </select>

  <select onChange={(e) => setFilters({...filters, municipality: e.target.value})}>
    <option value="">Todos los municipios</option>
    {municipalities.map(m => <option key={m} value={m}>{m}</option>)}
  </select>

  <select onChange={(e) => setFilters({...filters, status: e.target.value})}>
    <option value="all">Todos</option>
    <option value="pending">Pendiente</option>
    <option value="processing">En Proceso</option>
    <option value="completed">Completado</option>
    <option value="rejected">Rechazado</option>
  </select>
</div>

// Tabla
<table className="w-full">
  <thead>
    <tr>
      <th>Pedido</th>
      <th>Usuario</th>
      <th>Fecha Creación</th>
      <th>Fecha Procesamiento</th>
      <th>Estado</th>
      <th>Total</th>
      <th>Acciones</th>
    </tr>
  </thead>
  <tbody>
    {filteredOrders.map(order => (
      <tr key={order.id}>
        <td>{order.order_number}</td>
        <td>{order.user_profiles?.full_name}</td>
        <td>{new Date(order.created_at).toLocaleDateString()}</td>
        <td>{order.validated_at ? new Date(order.validated_at).toLocaleDateString() : '-'}</td>
        <td><Badge status={order.status}>{order.status}</Badge></td>
        <td>${order.total_amount}</td>
        <td>
          <Button size="sm" onClick={() => viewOrderDetails(order)}>
            Ver Detalles
          </Button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

**Integración**: Agregar en `AdminPage.jsx` o crear ruta separada

---

### 8. Dashboard con Análisis de Costos

**Actualizar**: `src/components/DashboardPage.jsx`

**Nuevas métricas a agregar**:
```jsx
const [costAnalytics, setCostAnalytics] = useState({
  totalTransportCosts: 0,
  totalOperationalCosts: 0,
  dailyOperationalCost: 0,
  weeklyOperationalCost: 0,
  monthlyOperationalCost: 0,
  profit: 0 // revenue - costs
});

useEffect(() => {
  const loadCostAnalytics = async () => {
    // Total transport costs from validated orders
    const { data: orders } = await supabase
      .from('order_analytics')
      .select('transport_cost')
      .eq('payment_status', 'validated');

    const totalTransport = orders?.reduce((sum, o) => sum + (o.transport_cost || 0), 0) || 0;

    // Daily operational cost
    const { data: dailyCost } = await supabase.rpc('get_daily_operational_cost');

    setCostAnalytics({
      totalTransportCosts: totalTransport,
      dailyOperationalCost: dailyCost || 0,
      weeklyOperationalCost: (dailyCost || 0) * 7,
      monthlyOperationalCost: (dailyCost || 0) * 30,
      // Calculate profit
      profit: totalRevenue - totalTransport - ((dailyCost || 0) * 30)
    });
  };

  loadCostAnalytics();
}, []);

// Renderizar cards de costos
<div className="grid grid-cols-3 gap-6">
  <Card>
    <h3>Costos de Transporte</h3>
    <p className="text-3xl font-bold">${costAnalytics.totalTransportCosts.toFixed(2)}</p>
  </Card>

  <Card>
    <h3>Costos Operacionales (Mensual)</h3>
    <p className="text-3xl font-bold">${costAnalytics.monthlyOperationalCost.toFixed(2)}</p>
  </Card>

  <Card>
    <h3>Ganancia Neta</h3>
    <p className="text-3xl font-bold text-green-600">${costAnalytics.profit.toFixed(2)}</p>
  </Card>
</div>
```

---

### 9. Exportación de Reportes (Excel/PDF)

**Librerías a instalar**:
```bash
npm install xlsx jspdf jspdf-autotable
```

**Servicio a crear**: `src/lib/reportService.js`
```javascript
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const exportToExcel = (data, filename) => {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
  XLSX.writeFile(wb, `${filename}.xlsx`);
};

export const generateFinancialReport = async (period = 'monthly') => {
  // Get orders, costs, analytics
  const { data: orders } = await supabase
    .from('order_analytics')
    .select('*')
    .eq('payment_status', 'validated')
    // Apply period filter...

  const { data: operationalCosts } = await getOperationalCosts();

  const totalRevenue = orders.reduce((sum, o) => sum + o.total_amount, 0);
  const totalTransport = orders.reduce((sum, o) => sum + (o.transport_cost || 0), 0);
  const { data: dailyOpCost } = await getDailyCost();

  return {
    period,
    totalOrders: orders.length,
    totalRevenue,
    totalTransportCosts: totalTransport,
    totalOperationalCosts: dailyOpCost * 30, // for monthly
    netProfit: totalRevenue - totalTransport - (dailyOpCost * 30),
    orders,
    operationalCosts
  };
};

export const exportFinancialReportPDF = async (period) => {
  const report = await generateFinancialReport(period);

  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text(`Reporte Financiero - ${period}`, 14, 20);

  doc.setFontSize(12);
  doc.text(`Total de Pedidos: ${report.totalOrders}`, 14, 40);
  doc.text(`Ingresos Totales: $${report.totalRevenue.toFixed(2)}`, 14, 50);
  doc.text(`Costos de Transporte: $${report.totalTransportCosts.toFixed(2)}`, 14, 60);
  doc.text(`Costos Operacionales: $${report.totalOperationalCosts.toFixed(2)}`, 14, 70);
  doc.text(`Ganancia Neta: $${report.netProfit.toFixed(2)}`, 14, 80);

  // Orders table
  autoTable(doc, {
    head: [['Pedido', 'Cliente', 'Total', 'Transporte', 'Fecha']],
    body: report.orders.map(o => [
      o.order_number,
      o.customer_name,
      `$${o.total_amount}`,
      `$${o.transport_cost || 0}`,
      new Date(o.created_at).toLocaleDateString()
    ]),
    startY: 90
  });

  doc.save(`reporte-financiero-${period}.pdf`);
};
```

**DashboardPage.jsx - Botones de exportación**:
```jsx
<div className="flex gap-3 mb-6">
  <Button onClick={() => exportFinancialReportPDF('weekly')}>
    📊 Reporte Semanal (PDF)
  </Button>
  <Button onClick={() => exportFinancialReportPDF('monthly')}>
    📊 Reporte Mensual (PDF)
  </Button>
  <Button onClick={() => exportFinancialReportPDF('yearly')}>
    📊 Reporte Anual (PDF)
  </Button>

  <Button onClick={async () => {
    const report = await generateFinancialReport('monthly');
    exportToExcel(report.orders, 'reporte-pedidos');
  }}>
    📑 Exportar Excel
  </Button>
</div>
```

---

### 10. Tracking de Visitas y Mejoras de Analytics

**Ya existe**: Tabla `page_visits` (mencionada en código)

**Mejorar**:
1. **Eliminar redundancias** en DashboardPage (hay secciones duplicadas)
2. **Agregar métricas relevantes**:
   - Tasa de conversión (visitas → pedidos)
   - Valor promedio de pedido
   - Productos más vendidos
   - Zonas con más pedidos
   - Usuarios más activos

**Queries sugeridas**:
```javascript
// Conversion rate
const conversionRate = (totalOrders / totalVisits) * 100;

// Average order value
const avgOrderValue = totalRevenue / totalOrders;

// Top products
const { data: topProducts } = await supabase
  .from('order_items')
  .select('item_name_es, quantity')
  .eq('item_type', 'product')
  // Group by and sum quantities...

// Top zones
const { data: topZones } = await supabase
  .from('orders')
  .select('shipping_zones(province_name), count')
  // Group by zone...
```

---

## 📊 Resumen de Archivos a Crear/Modificar

### SQL (Ya creados)
- ✅ `supabase/MIGRATIONS_PHASE_2.sql`

### Servicios Nuevos
- [ ] `src/lib/messageService.js`
- [ ] `src/lib/operationalCostService.js`
- [ ] `src/lib/reportService.js`

### Componentes Nuevos
- [ ] `src/components/OrdersAdminPage.jsx`

### Componentes a Modificar
- [ ] `src/components/SettingsPage.jsx` (Tab Envíos: fechas + transporte)
- [ ] `src/components/SettingsPage.jsx` (Tab Financiero: costos operacionales)
- [ ] `src/components/UserPanel.jsx` (Sección de mensajes)
- [ ] `src/components/Header.jsx` (Badge de mensajes)
- [ ] `src/components/DashboardPage.jsx` (Costos + reportes + analytics)
- [ ] `src/lib/orderService.js` (Email notification + fecha entrega)
- [ ] `src/lib/shippingService.js` (updateShippingZone)

### Edge Functions a Crear
- [ ] `supabase/functions/notify-user-dispatch/index.ts`

---

## ⚠️ Próximos Pasos Recomendados

1. **Ejecutar migrations**: `MIGRATIONS_PHASE_2.sql` en Supabase
2. **Instalar dependencias**: `npm install xlsx jspdf jspdf-autotable`
3. **Implementar en orden de prioridad**:
   - Alta: Fechas de entrega + Costos de transporte (Tab Envíos)
   - Alta: Email notification al validar pago
   - Media: Sistema de mensajes admin
   - Media: Costos operacionales
   - Media: Tab de Pedidos en Admin
   - Baja: Reportes Excel/PDF
   - Baja: Analytics mejorados

---

**Tokens restantes**: ~115k/200k (42% usado)
**Estimado para completar todas las tareas**: ~80-100k tokens adicionales
