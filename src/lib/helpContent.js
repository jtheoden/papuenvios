const ADMIN_ROLES = ['admin', 'super_admin'];

export const HELP_SECTIONS = [
  {
    id: 'orders',
    roles: ADMIN_ROLES,
    title: { es: 'Pedidos', en: 'Orders' },
    entries: [
      {
        id: 'order-lifecycle',
        question: { es: '¿Qué significan los estados de un pedido?', en: 'What do order statuses mean?' },
        answer: {
          es: 'Pendiente requiere revisión del pago; En proceso indica preparación; Despachado está en camino; Entregado espera cierre o confirmación; Completado finaliza el flujo. Revisa el comprobante antes de validar un pago.',
          en: 'Pending needs payment review; Processing means preparation; Dispatched is in transit; Delivered awaits closure or confirmation; Completed closes the flow. Review proof before validating a payment.'
        }
      },
      {
        id: 'payment-proof',
        question: { es: '¿Qué debo comprobar antes de validar un pago?', en: 'What should I check before validating a payment?' },
        answer: {
          es: 'Comprueba que el comprobante sea legible, corresponda al pedido y coincida con el importe y la cuenta receptora. Si hay dudas, no lo valides: solicita aclaración por el canal operativo establecido.',
          en: 'Check that proof is readable, belongs to the order, and matches the amount and receiving account. If uncertain, do not validate it; request clarification through the established operations channel.'
        }
      }
    ]
  },
  {
    id: 'catalog',
    roles: ADMIN_ROLES,
    title: { es: 'Catálogo e inventario', en: 'Catalog and inventory' },
    entries: [
      {
        id: 'hide-vs-delete',
        question: { es: '¿Ocultar un producto es lo mismo que eliminarlo?', en: 'Is hiding a product the same as deleting it?' },
        answer: {
          es: 'No. Desactivar u ocultar un producto lo retira del catálogo público, pero conserva su registro. Eliminarlo es una acción distinta y puede ser irreversible; revisa sus dependencias y confirma el alcance antes de continuar.',
          en: 'No. Deactivating or hiding a product removes it from the public catalog but keeps its record. Deletion is different and may be irreversible; review dependencies and confirm scope before proceeding.'
        }
      },
      {
        id: 'inventory-reservations',
        question: { es: '¿Por qué puede variar el inventario disponible?', en: 'Why can available inventory change?' },
        answer: {
          es: 'El inventario disponible puede considerar unidades comprometidas por pedidos abiertos. Verifica los pedidos relacionados antes de ajustar existencias manualmente.',
          en: 'Available inventory may account for units committed to open orders. Check related orders before manually adjusting stock.'
        }
      }
    ]
  },
  {
    id: 'remittances',
    roles: ADMIN_ROLES,
    title: { es: 'Remesas', en: 'Remittances' },
    entries: [
      {
        id: 'rate-change',
        question: { es: '¿Cambiar una tasa modifica remesas ya creadas?', en: 'Does changing a rate modify existing remittances?' },
        answer: {
          es: 'La ayuda no sustituye la revisión del detalle de cada remesa. Antes de cambiar tasas o comisiones, confirma el alcance mostrado en la configuración y verifica una operación pendiente de prueba; no asumas que operaciones existentes se recalculan.',
          en: 'This help does not replace reviewing each remittance. Before changing rates or fees, confirm the scope shown in settings and verify a pending test operation; do not assume existing transactions are recalculated.'
        }
      }
    ]
  },
  {
    id: 'platform',
    roles: ['super_admin'],
    title: { es: 'Sistema y acciones críticas', en: 'System and critical actions' },
    entries: [
      {
        id: 'platform-reset',
        question: { es: '¿Qué debo hacer antes de un reset de plataforma?', en: 'What should I do before a platform reset?' },
        answer: {
          es: 'Es una operación de alto impacto. No la ejecutes basándote solo en esta ayuda: consulta el runbook vigente, confirma el entorno y alcance, verifica respaldos y autorización, y pide una segunda revisión antes de activar el proceso. Esta ayuda no ejecuta resets ni reemplaza el procedimiento operativo.',
          en: 'This is a high-impact operation. Do not execute it based only on this help: consult the current runbook, confirm environment and scope, verify backups and authorization, and get a second review before starting. This help cannot execute resets or replace the operational procedure.'
        }
      },
      {
        id: 'roles',
        question: { es: '¿Quién puede cambiar roles administrativos?', en: 'Who can change administrative roles?' },
        answer: {
          es: 'Los cambios de rol afectan permisos de acceso. Confirma la identidad y necesidad de la persona, aplica solo el privilegio mínimo y valida que el cambio esté autorizado. No compartas credenciales ni eleves tu propio acceso desde esta pantalla.',
          en: 'Role changes affect access permissions. Confirm the person’s identity and need, apply least privilege, and verify authorization. Do not share credentials or elevate your own access from this screen.'
        }
      },
      {
        id: 'audit-log',
        question: { es: '¿Para qué sirve el registro de actividad?', en: 'What is the activity log for?' },
        answer: {
          es: 'Permite revisar eventos y acciones administrativas para diagnóstico y trazabilidad. Úsalo con el mínimo de datos necesario y evita copiar información personal a canales no autorizados.',
          en: 'It helps review events and administrative actions for diagnostics and traceability. Use only the data needed and avoid copying personal information into unauthorized channels.'
        }
      }
    ]
  },
  {
    id: 'admin-settings', roles: ['super_admin'],
    title: { es: 'Configuración de plataforma', en: 'Platform settings' },
    entries: [
      { id: 'settings-overview', question: { es: '¿Cómo se organiza Configuración?', en: 'How is Settings organized?' }, answer: { es: 'Financiero controla márgenes y monedas; Envíos, zonas y tarifas; Visual, apariencia, temas y estructura del Hero; Pagos, métodos y cuentas receptoras; Mensajería, repartidores y pagos asociados; Contenido, funciones y guías publicadas; Sistema, controles operativos. Revisa primero la pestaña y el estado actual. Guarda solo cambios revisados y confirma el resultado visible.', en: 'Financial controls margins and currencies; Shipping, zones and rates; Visual, appearance, themes and Hero layout; Payments, methods and receiving accounts; Messaging, couriers and related payments; Content, feature cards and published guides; System, operational controls. Check the selected tab and current values first. Save only reviewed changes and verify the visible result.' } },
      { id: 'settings-payments', question: { es: '¿Cómo activar Bizum e IBAN para pedidos o remesas?', en: 'How do I enable Bizum and IBAN for orders or remittances?' }, answer: { es: 'Para el flujo EUR, configura primero una tasa de cambio EUR vigente en Financiero y verifica dirección, fecha y conversión de prueba. Después, en Pagos, activa Bizum y/o IBAN/SEPA por separado para Pedidos y Remesas; cada método solo debe aparecer para el flujo y moneda compatibles. USD continúa usando Zelle. Antes de habilitar operaciones reales, confirma cuenta receptora, instrucciones, conciliación y liquidación al destinatario en Cuba. No confundas la tasa de cambio con un impuesto.', en: 'For the EUR flow, first configure a current EUR exchange rate in Financial settings and verify its direction, effective date and a test conversion. Then, in Payments, enable Bizum and/or IBAN/SEPA separately for Orders and Remittances; each method should appear only for a compatible flow and currency. USD continues to use Zelle. Before enabling live operations, confirm the receiving account, payment instructions, reconciliation and payout to the recipient in Cuba. Do not confuse the exchange rate with a tax.' } },
      { id: 'settings-financial-risk', question: { es: '¿Qué hago ante una alerta financiera roja?', en: 'What should I do when a red financial warning appears?' }, answer: { es: 'Detén el guardado y corrige el dato señalado. Revisa precios de pedidos frente al costo, márgenes/ganancias negativos, tasa y comisión de cada tipo de remesa, y reembolsos vencidos. Un precio bajo costo, una tasa de entrega superior a la de mercado o una comisión que anula el neto puede causar pérdidas; concilia reembolsos por ID y no repitas pagos. La alerta explica el riesgo, pero no sustituye la revisión ni autoriza una excepción.', en: 'Stop the save and correct the flagged value. Review order prices against cost, negative margins/profit, each remittance type’s rate and fee, and overdue refunds. A below-cost price, delivery rate above market, or fee that eliminates the net amount can cause losses; reconcile refunds by ID and do not duplicate payments. The warning explains the risk but does not replace review or authorize an override.' } },
      { id: 'settings-messaging-content', question: { es: '¿Cómo administrar Mensajería y Contenido?', en: 'How do I manage Messaging and Content?' }, answer: { es: 'Mensajería administra repartidores, tipos de pago suscritos, pendientes e informes; desactivar no elimina el historial y las suscripciones aplican a entregas futuras. Contenido configura tarjetas de inicio y publicaciones/guías: expande el elemento, revisa visibilidad y destino, conserva cambios y verifica el resultado público. Una imagen rota debe corregirse antes de publicar.', en: 'Messaging manages couriers, subscribed payment types, pending items and reports; deactivation does not erase history, and subscriptions apply to future deliveries. Content configures home cards and publications/guides: expand the item, review visibility and destination, save changes and verify the public result. Fix broken images before publishing.' } }
    ]
  },
  {
    id: 'admin-dashboard', roles: ['super_admin'],
    title: { es: 'Panel de Control', en: 'Control dashboard' },
    entries: [
      { id: 'dashboard-workflow', question: { es: '¿Cómo revisar el Panel de Control?', en: 'How should I review the Control dashboard?' }, answer: { es: 'Resumen General muestra métricas; Historial de Órdenes permite buscar y filtrar; Remesas lista operaciones y estados; Tipos de Remesas administra tasas, límites y comisiones; Ofertas y Cupones gestiona descuentos; Registro de Actividad da trazabilidad; Historial de Pagos concilia transacciones. Confirma identificador, importe, beneficiario, estado y comprobante antes de cualquier acción irreversible.', en: 'Overview shows metrics; Order History searches and filters; Remittances lists operations and statuses; Remittance Types manages rates, limits and fees; Offers and Coupons manages discounts; Activity Log provides traceability; Payment History reconciles transactions. Confirm identifier, amount, recipient, status and proof before any irreversible action.' } },
      { id: 'dashboard-financial', question: { es: '¿Qué hacer ante una diferencia de centavos?', en: 'What should I do about a cent discrepancy?' }, answer: { es: 'No ajustes una operación manualmente basándote solo en la vista previa. Compara importe solicitado, comisión, neto a recibir, cotización y monto persistido; conserva el ID de operación y registra los pasos para reproducir. Si ya se canceló, confirma el estado final y no repitas el pago.', en: 'Do not manually adjust an operation based only on the preview. Compare requested amount, fee, recipient net, quote and persisted amount; retain the operation ID and record reproduction steps. If already canceled, confirm final status and do not repeat payment.' } }
    ]
  },
  {
    id: 'admin-users', roles: ['super_admin'],
    title: { es: 'Gestión de Usuarios', en: 'User management' },
    entries: [
      { id: 'users-roles', question: { es: '¿Cómo cambiar el acceso de un usuario?', en: 'How do I change a user’s access?' }, answer: { es: 'Busca y confirma la identidad antes de editar. Asigna el mínimo rol necesario; valida las consecuencias de suspender o eliminar y conserva trazabilidad. No compartas credenciales ni promociones una cuenta sin autorización explícita.', en: 'Find and verify the identity before editing. Grant the least privilege needed; validate the consequences of suspending or deleting and retain an audit trail. Never share credentials or elevate an account without explicit authorization.' } },
      { id: 'users-catalog', question: { es: '¿Dónde se administran categorías y catálogo?', en: 'Where are categories and catalog managed?' }, answer: { es: 'En Administración → Categorías se crean o editan etiquetas y descripciones; Inventario gestiona productos y stock; Combos administra paquetes. Revisa productos asociados antes de borrar una categoría y confirma que los cambios se reflejen en el catálogo público.', en: 'Under Administration → Categories, create or edit labels and descriptions; Inventory manages products and stock; Combos manages bundles. Review linked products before deleting a category and verify changes in the public catalog.' } }
    ]
  },
  {
    id: 'admin-user-panel', roles: ['super_admin'],
    title: { es: 'Panel de Usuario', en: 'User panel' },
    entries: [
      { id: 'user-panel-operations', question: { es: '¿Qué muestra el Panel de Usuario?', en: 'What does the User Panel show?' }, answer: { es: 'Permite al usuario consultar pedidos pendientes, remesas y devoluciones, abrir detalles y comprobantes y contactar soporte. Los estados y acciones disponibles dependen del flujo de cada registro. Al ayudar, verifica el ID y explica el siguiente paso sin validar pagos ni cambiar datos en nombre del usuario.', en: 'Users can review pending orders, remittances and returns, open details and proofs, and contact support. Statuses and available actions depend on each record’s workflow. When assisting, verify the ID and explain the next step without validating payments or changing data on the user’s behalf.' } },
      { id: 'user-panel-support', question: { es: '¿Cómo orientar a un usuario con un pedido o remesa?', en: 'How should I guide a user about an order or remittance?' }, answer: { es: 'Solicita el identificador, revisa el estado y el historial correspondiente en el Panel de Control y explica el estado actual y el canal de seguimiento. No solicites contraseñas ni datos de pago completos; deriva discrepancias al procedimiento de soporte.', en: 'Ask for the identifier, check its status and history in the Control dashboard, then explain the current status and follow-up channel. Never request passwords or full payment details; escalate discrepancies through the support procedure.' } }
    ]
  }
];

export function getHelpSectionsForRole(userRole) {
  if (userRole !== 'admin' && userRole !== 'super_admin') return [];
  const sections = HELP_SECTIONS.filter(section => section.roles.includes(userRole));
  return userRole === 'super_admin' ? [...sections, ...buildAdminContextGuides()] : sections;
}

const ADMIN_CONTEXT_GUIDES = {
  'settings-financiero': ['Financiero', 'Revisa márgenes por defecto, monedas activas y tasas de cambio antes de guardar. Confirma vigencia, par de monedas y dirección; un margen negativo puede dejar precios por debajo del costo. Para Bizum/IBAN en EUR, primero configura una tasa EUR vigente y luego activa cada método por separado para pedidos o remesas en Pagos. La configuración no corrige retroactivamente operaciones existentes.', 'Review default margins, active currencies and exchange rates before saving. Confirm validity, currency pair and direction; a negative margin can put prices below cost. For EUR Bizum/IBAN, first configure a current EUR rate, then enable each method separately for orders or remittances in Payments. Settings do not retroactively correct existing transactions.'],
  'settings-envios': ['Envíos', 'Configura costo de envío y transporte por provincia; expande la provincia para excepciones municipales. Un costo cero sin envío gratis deshabilita la zona. Comprueba al menos una ubicación real antes de guardar.', 'Configure delivery and transport costs per province; expand a province for municipal exceptions. Zero cost without free shipping disables the zone. Verify at least one real destination before saving.', [
    { src: '/help-examples/shipping-zones.png', alt: { es: 'Resumen de zonas de envío por provincia.', en: 'Shipping zones by province.' } },
    { src: '/help-examples/shipping-zone-detail.png', alt: { es: 'Excepciones de envío para una zona.', en: 'Shipping exceptions for a zone.' } },
  ]],
  'settings-visual': ['Visual', 'Elige tema, paleta y apariencia del Hero (ancho completo o estructura estrecha). Previsualiza escritorio y móvil; guarda y verifica Inicio, tarjetas y navegación sin cambiar la estructura accidentalmente.', 'Choose the theme, palette and Hero appearance (full-width or narrow structure). Preview desktop and mobile; save and verify Home, cards and navigation without changing the layout unintentionally.', { src: '/help-examples/hero-layout.png', alt: { es: 'Opciones de composición del Hero.', en: 'Hero layout options.' } }],
  'settings-zelle': ['Pagos · Zelle', 'Verifica por separado si Zelle admite Pedidos y Remesas. En Cuentas revisa titular, email/teléfono de contacto, límites, estado y destino (productos/remesas). El email puede quedar vacío cuando no sea el contacto elegido; no crees ni edites cuentas reales sin autorización.', 'Check separately whether Zelle is enabled for Orders and Remittances. In Accounts review the holder, email/phone contact, limits, status and destination (products/remittances). Email may be blank when it is not the chosen contact method; do not create or edit live accounts without authorization.'],
  'settings-zelle-zelle': ['Pagos · Cuentas Zelle', 'En esta sección administra las cuentas receptoras Zelle: nombre, titular, contacto, límites, orden de prioridad, estado y si acepta pedidos o remesas. Valida que email/teléfono coincidan con el canal mostrado al cliente; email es opcional cuando no se usa como contacto.', 'Manage Zelle receiving accounts here: name, holder, contact, limits, priority, status and whether it accepts orders or remittances. Verify email/phone matches the customer-facing contact; email is optional when it is not used for contact.', { src: '/help-examples/zelle-accounts-redacted.png', alt: { es: 'Ejemplo de configuración de cuentas Zelle con datos de contacto ocultos.', en: 'Zelle accounts example with contact data redacted.' } }],
  'settings-zelle-bizum': ['Pagos · Bizum', 'Bizum está marcado como próximamente/deshabilitado en la configuración actual. No lo presentes como método disponible ni actives operaciones hasta que el proveedor y el flujo estén habilitados y probados.', 'Bizum is marked upcoming/disabled in the current configuration. Do not present it as available or enable transactions until the provider and flow are enabled and tested.'],
  'settings-mensajeria': ['Mensajería', 'Mensajeros: alta, edición y desactivación; desactivar conserva historial. Tipos de pago: define suscripciones por mensajero y prioridad frente al tipo general. Por pagar: concilia entrega y pago antes de marcar pagado. Reportes: filtra y verifica periodo antes de exportar.', 'Couriers: create, edit and deactivate; deactivation preserves history. Payment types: configure courier subscriptions and priority over the general type. Payable: reconcile delivery and payment before marking paid. Reports: filter and verify the period before export.'],
  'settings-mensajeria-couriers': ['Mensajería · Mensajeros', 'Agrega el nombre del mensajero, verifica que quede activo y edita sus datos cuando corresponda. Desactivar impide asignaciones futuras, pero conserva el historial. Revisa sus tipos de pago suscritos antes de asignarle nuevas entregas.', 'Add the courier name, verify active status and edit their details when needed. Deactivation prevents future assignments but preserves history. Review subscribed payment types before assigning new deliveries.', { src: '/help-examples/couriers-redacted.png', alt: { es: 'Ejemplo de mensajeros con nombres ocultos.', en: 'Couriers example with names redacted.' } }],
  'settings-mensajeria-types': ['Mensajería · Tipos de pago', 'Crea o edita el método de pago disponible para repartidores y sus reglas. Suscribir un mensajero aplica prioridad específica a entregas futuras; no modifica entregas ya asignadas. Confirma disponibilidad antes de activar.', 'Create or edit payment methods available to couriers and their rules. A courier subscription applies a specific priority to future deliveries; it does not change already assigned deliveries. Verify availability before activation.', { src: '/help-examples/messenger-payment-thresholds.png', alt: { es: 'Configuración de umbrales de pago para mensajería.', en: 'Messenger payment thresholds settings.' } }],
  'settings-mensajeria-payable': ['Mensajería · Por pagar', 'Concilia entrega, monto, mensajero y evidencia de cobro. Marca pagado solo tras confirmar el pago; revisa ID y fecha para evitar duplicados. Si no coincide, deja pendiente y deriva según el procedimiento operativo.', 'Reconcile delivery, amount, courier and collection evidence. Mark paid only after confirming payment; check ID and date to avoid duplicates. If it does not match, leave it pending and escalate through the operating procedure.', { src: '/help-examples/messenger-payable.png', alt: { es: 'Lista de entregas pendientes de pago.', en: 'List of deliveries pending payment.' } }],
  'settings-mensajeria-reports': ['Mensajería · Reportes', 'Selecciona el periodo y filtros de mensajero/estado antes de comparar totales. Aclara si el reporte incluye pagos pendientes o solo completados; conserva el rango usado para que la conciliación sea reproducible.', 'Select the period and courier/status filters before comparing totals. Confirm whether pending payments are included or only completed ones; retain the selected range so reconciliation is reproducible.', { src: '/help-examples/messenger-reports.png', alt: { es: 'Filtros para reportes de mensajería.', en: 'Messenger report filters.' } }],
  'settings-contenido': ['Contenido', 'Funciones controla tarjetas del inicio, visibilidad y destinos; Publicaciones y Guías permite ordenar, editar, ocultar y publicar artículos, imágenes o videos. Revisa enlaces y vista pública; corrige medios rotos antes de publicar.', 'Features controls Home cards, visibility and destinations; Publications and Guides lets you order, edit, hide and publish articles, images or videos. Check links and public view; fix broken media before publishing.', [
    { src: '/help-examples/home-features.png', alt: { es: 'Configuración de funcionalidades de la página principal.', en: 'Home page feature settings.' } },
    { src: '/help-examples/publications-guides.png', alt: { es: 'Publicaciones y guías disponibles.', en: 'Available publications and guides.' } },
  ]],
  'settings-notifications': ['Notificaciones', 'Configura si los avisos salen a una cuenta o a un grupo. Verifica el número y enlace de destino con el responsable antes de guardar; trata los enlaces de invitación y los números de contacto como datos privados.', 'Choose whether notifications go to an account or group. Verify the destination number and link with the owner before saving; treat invite links and contact numbers as private data.', { src: '/help-examples/notifications-redacted.png', alt: { es: 'Ejemplo de ajustes de notificaciones con número y enlace ocultos.', en: 'Notification settings example with phone and invite link redacted.' } }],
  'settings-stock-policy': ['Política de reservas de stock', 'Ajusta los plazos de retención y límites solo tras confirmar la política operativa. Comprueba los rangos permitidos y explica que las reservas vencidas liberan stock automáticamente.', 'Change reservation windows and limits only after confirming the operating policy. Check allowed ranges and note that expired reservations release stock automatically.', { src: '/help-examples/stock-reservation-policy.png', alt: { es: 'Controles de la política de reservas de stock.', en: 'Stock reservation policy controls.' } }],
  'settings-sistema': ['Sistema', 'Usa controles de sistema solo con autorización y un procedimiento aprobado. Antes de una operación de alto impacto verifica entorno, alcance, respaldo y segundo revisor; esta guía no ejecuta ni autoriza resets.', 'Use system controls only with authorization and an approved procedure. Before high-impact operations, verify environment, scope, backup and second reviewer; this guide neither executes nor authorizes resets.', { src: '/help-examples/platform-reset.png', alt: { es: 'Aviso de restablecimiento de la plataforma.', en: 'Platform reset warning.' } }],
  'dashboard-overview': ['Resumen General', 'Interpreta métricas junto con su periodo y estado de carga; un valor ausente no significa cero. Contrasta totales con Historial de Órdenes, Remesas e Historial de Pagos antes de decisiones financieras.', 'Read metrics with their period and loading state; a missing value does not mean zero. Reconcile totals with Order History, Remittances and Payment History before financial decisions.'],
  'dashboard-orders': ['Historial de Órdenes', 'Busca por ID/cliente, filtra estado y fechas; abre el detalle para comparar artículos, total y comprobante. Valida un pago solo si el comprobante coincide; las acciones de despacho y cierre deben seguir el estado registrado.', 'Search by ID/customer and filter status and dates; open details to compare items, total and proof. Validate payment only when proof matches; dispatch and closure actions must follow the recorded status.', { src: '/help-examples/order-history-redacted.png', alt: { es: 'Ejemplo del historial de órdenes con datos de clientes ocultos.', en: 'Order history example with customer data redacted.' } }],
  'dashboard-remittances': ['Remesas', 'Filtra por número, destinatario, estado y rango de fechas. Verifica monto enviado, neto, método y ubicación. Antes de completar o cancelar, confirma ID y estado actual; no repitas una operación ya cancelada.', 'Filter by number, recipient, status and date range. Verify sent amount, net, method and location. Before completing or canceling, confirm ID and current status; do not repeat an already canceled operation.', { src: '/help-examples/remittances-redacted.png', alt: { es: 'Ejemplo de remesas con identificadores personales ocultos.', en: 'Remittances example with personal identifiers redacted.' } }],
  'dashboard-remittance-types': ['Tipos de Remesas', 'Para cada tipo valida monedas de origen/entrega, tasa de mercado, tasa de entrega, comisión, límites, método y SLA/alerta. Desactivar afecta disponibilidad futura; verifica una cotización de prueba después de guardar.', 'For each type verify source/delivery currencies, market rate, delivery rate, fee, limits, method and SLA/alert. Deactivation affects future availability; verify a test quote after saving.', { src: '/help-examples/remittance-types.png', alt: { es: 'Listado de tipos de remesas y sus reglas.', en: 'Remittance types and their rules.' } }],
  'dashboard-offers': ['Ofertas y Cupones', 'Comprueba código único, porcentaje/monto, mínimo, fechas y máximo de usos. Usa el filtro Activos/Inactivos para validar estado; editar o desactivar puede afectar futuras compras, no asumas que cambia usos anteriores.', 'Check code uniqueness, percentage/amount, minimum, dates and maximum uses. Use Active/Inactive filters to verify status; editing or deactivating may affect future purchases—do not assume past uses change.', [
    { src: '/help-examples/offers-redacted.png', alt: { es: 'Ejemplo de ofertas con códigos promocionales ocultos.', en: 'Offers example with promo codes redacted.' } },
    { src: '/help-examples/coupon-detail-redacted.png', alt: { es: 'Detalle de cupón con el código promocional oculto.', en: 'Coupon details with promo code redacted.' } },
  ]],
  'dashboard-activity-log': ['Registro de Actividad', 'Busca por usuario, acción o entidad y acota por fechas. Usa el registro para auditoría y diagnóstico, no para inferir un pago sin consultar su registro fuente. Comparte solo datos necesarios y por canales autorizados.', 'Search by user, action or entity and narrow by date. Use the log for audit and diagnosis, not to infer payment without checking its source record. Share only necessary data through authorized channels.', { src: '/help-examples/activity-log-redacted.png', alt: { es: 'Ejemplo del registro de actividad con datos personales ocultos.', en: 'Activity log example with personal data redacted.' } }],
  'dashboard-zelle-history': ['Historial de Pagos', 'Concilia volumen total, validado y pendiente con cuenta Zelle, importe, tipo, estado y destinatario/ID. Abre filtros para acotar el periodo y confirma el registro origen antes de corregir discrepancias.', 'Reconcile total, validated and pending volume with Zelle account, amount, type, status and recipient/ID. Filter the period and confirm the source record before correcting discrepancies.', { src: '/help-examples/payment-history-redacted.png', alt: { es: 'Ejemplo del historial de pagos con datos personales y de cuenta ocultos.', en: 'Payment history example with personal and account data redacted.' } }],
  'admin-inventory': ['Administración · Inventario', 'Busca el SKU/producto, valida costo, precio, margen y stock reservado por pedidos abiertos. Ajusta existencias con motivo y revisa el catálogo público después; no borres productos con operaciones asociadas sin revisar dependencias.', 'Search SKU/product, verify cost, price, margin and stock reserved by open orders. Adjust stock with a reason and check the public catalog afterward; review dependencies before deleting products with linked transactions.', [
    { src: '/help-examples/inventory-list.png', alt: { es: 'Tabla de productos y existencias.', en: 'Products and inventory table.' } },
    { src: '/help-examples/product-details.png', alt: { es: 'Detalle de un producto.', en: 'Product details.' } },
    { src: '/help-examples/product-edit.png', alt: { es: 'Formulario para editar un producto.', en: 'Product edit form.' } },
    { src: '/help-examples/product-create.png', alt: { es: 'Formulario para agregar un producto.', en: 'Product creation form.' } },
  ]],
  'admin-categories': ['Administración · Categorías', 'Al crear/editar revisa nombre, slug, descripción y margen sugerido. Antes de borrar una categoría confirma productos asociados y el efecto en el catálogo; guarda y comprueba el resultado visible.', 'When creating/editing, review name, slug, description and suggested margin. Before deleting, check linked products and catalog impact; save and verify the visible result.', [
    { src: '/help-examples/categories-list.png', alt: { es: 'Listado de categorías.', en: 'Categories list.' } },
    { src: '/help-examples/category-edit.png', alt: { es: 'Formulario para editar una categoría.', en: 'Category edit form.' } },
  ]],
  'admin-combos': ['Administración · Combos', 'Verifica componentes, cantidades, disponibilidad, precio y margen del combo. Guarda cambios y valida la composición y precio en la tienda; no uses stock del combo como sustituto de revisar existencias de cada componente.', 'Verify bundle components, quantities, availability, price and margin. Save and validate composition and price in the store; do not treat bundle stock as a substitute for checking each component.', [
    { src: '/help-examples/combos-list.png', alt: { es: 'Listado de combos y estado de disponibilidad.', en: 'Bundles list and availability status.' } },
    { src: '/help-examples/combo-edit.png', alt: { es: 'Formulario para editar un combo.', en: 'Bundle edit form.' } },
  ]],
  'admin-management': ['Administración · Gestión', 'Revisa las opciones administrativas disponibles y confirma el alcance antes de aplicar cambios globales. Comprueba los permisos requeridos, guarda una sola modificación a la vez y valida el estado resultante.', 'Review available administrative options and confirm scope before global changes. Check required permissions, save one change at a time and verify the resulting state.'],
  'user-management-users': ['Gestión de Usuarios · Usuarios', 'Busca y confirma identidad por email antes de cambiar rol, estado o acceso. Aplica mínimo privilegio, revisa permisos derivados y deja trazabilidad. Nunca compartas credenciales ni eleves el acceso propio.', 'Verify identity by email before changing role, status or access. Apply least privilege, review derived permissions and retain an audit trail. Never share credentials or elevate your own access.', { src: '/help-examples/user-management-redacted.png', alt: { es: 'Ejemplo de gestión de usuarios con identificadores personales ocultos.', en: 'User management example with personal identifiers redacted.' } }],
  'user-management-categories': ['Gestión de Usuarios · Categorías', 'Revisa reglas, descuentos y criterios de clasificación; comprueba usuarios afectados antes de recalcular en lote. Guarda cambios acotados y confirma el resultado de una muestra antes de ejecutar acciones masivas.', 'Review rules, discounts and classification criteria; check affected users before bulk recalculation. Save scoped changes and verify a sample before bulk actions.'],
  'user-panel-orders': ['Panel de Usuario · Pedidos', 'Revisa identificador, estado, importe y comprobante. Explica el paso siguiente según el estado; no valides ni modifiques operaciones en nombre del usuario sin autorización y evidencia.', 'Review ID, status, amount and proof. Explain the next step for the status; do not validate or modify operations for the user without authorization and evidence.'],
  'user-panel-remittances': ['Panel de Usuario · Remesas', 'Localiza la remesa por ID, confirma el estado y destinatario y compara lo enviado con lo recibido y las comisiones mostradas. Si hay diferencia, registra el ID y deriva al flujo de soporte sin duplicar el envío.', 'Find the remittance by ID, confirm status and recipient, and compare sent/received amounts and displayed fees. For discrepancies, record the ID and escalate through support without duplicating the transfer.'],
  'user-panel-returns': ['Panel de Usuario · Devoluciones', 'Verifica pedido original, motivo, estado y mensajes del caso. Explica plazos y siguiente acción; no prometas reembolsos hasta confirmar aprobación y registro de pago.', 'Verify original order, reason, status and case messages. Explain timelines and next action; do not promise a refund until approval and payment record are confirmed.']
};

function buildAdminContextGuides() {
  return Object.entries(ADMIN_CONTEXT_GUIDES).map(([id, [title, es, en, visualExample]]) => ({
    id: `context-${id}`, roles: ['super_admin'], title: { es: title, en: title },
    entries: [{ id, question: { es: `¿Cómo trabajar en ${title}?`, en: `How do I work in ${title}?` }, answer: { es, en }, visualExamples: visualExample ? (Array.isArray(visualExample) ? visualExample : [visualExample]) : [] }]
  }));
}

export function getHelpSectionForPage(page, tab, detailTab) {
  if (page === 'settings' && tab === 'mensajeria' && ['couriers', 'types', 'payable', 'reports'].includes(detailTab)) {
    return `context-settings-mensajeria-${detailTab}`;
  }
  if (page === 'settings' && tab === 'zelle' && ['zelle', 'bizum'].includes(detailTab)) {
    return `context-settings-zelle-${detailTab}`;
  }
  if (page === 'settings' && ['payments', 'pagos'].includes(tab)) return 'admin-settings';
  const pageKey = { settings: 'settings', dashboard: 'dashboard', admin: 'admin', 'user-management': 'user-management', 'user-panel': 'user-panel' }[page];
  const contextual = tab ? `context-${pageKey}-${tab}` : null;
  return contextual || ({ settings: 'admin-settings', dashboard: 'admin-dashboard', admin: 'admin-dashboard', 'user-management': 'admin-users', 'user-panel': 'admin-user-panel' }[page] || null);
}
