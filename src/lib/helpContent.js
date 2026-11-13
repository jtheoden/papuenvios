const ADMIN_ROLES = ['admin', 'super_admin'];

const USER_ACCESS_ENTRIES = [
  {
    id: "users-permissions",
    question: { es: "¿Quién edita usuarios y roles?", en: "Who can edit users and roles?" },
    answer: {
      es: "Admin tiene acceso de solo lectura; solo super_admin edita roles, categorías y acceso desde Gestión de Usuarios. El selector permite user y admin; super_admin no se asigna desde la UI y las cuentas super_admin están protegidas allí. Confirma identidad antes de cambiar permisos.",
      en: "Admin has read-only access; only super_admin edits roles, categories and access in User management. The selector offers user and admin; super_admin cannot be assigned from the UI and super_admin accounts are protected there. Verify identity before changing permissions."
    }
  },
  {
    id: "users-disable",
    question: { es: "¿Cómo deshabilito una cuenta?", en: "How do I disable an account?" },
    answer: {
      es: "Como super_admin, pulsa Deshabilitar, escribe motivo obligatorio de 3–500 caracteres y confirma. No puedes hacerlo a ti mismo; la UI tampoco ofrece deshabilitar otro super_admin y el servidor protege al último super_admin habilitado. La acción registra actor, fecha y motivo. Habilitar revierte el bloqueo sin pedir motivo.",
      en: "As super_admin, choose Disable, enter a mandatory 3–500 character reason and confirm. Do not disable yourself; the UI also hides disabling another super_admin and the server protects the last super_admin enabled. The action records actor, date and reason. Enable reverses the block without requiring a reason."
    }
  },
  {
    id: "users-disabled-session",
    question: { es: "¿Deshabilitar elimina al usuario o cierra la sesión al instante?", en: "Does disabling delete the user or close their session instantly?" },
    answer: {
      es: "No elimina la cuenta. La base de datos bloquea sus datos de negocio inmediatamente. La sesión local se cierra cuando la app relee el perfil y detecta is_enabled=false: al renovar el token (aproximadamente cada hora) o al volver a la pestaña, con un mínimo de 5 min entre lecturas; no hay sondeo periódico del perfil. No es un borrado ni un bloqueo en el servicio de autenticación. Usa Deshabilitar para un bloqueo reversible. Eliminar es una acción distinta y su resultado en autenticación debe verificarse por separado.",
      en: "It does not delete the account. The database blocks its business data immediately. The local session closes when the app re-reads the profile and detects is_enabled=false: at token refresh (about hourly) or when returning to the tab, with a minimum of 5 min between reads; there is no periodic profile polling. This is neither deletion nor an authentication-service ban. Use Disable for a reversible block. Delete is a separate action and its outcome in authentication must be verified separately."
    }
  }
];

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
          es: "El estado del pedido y el del pago son distintos. Al validar el pago, el pedido pasa directamente a En proceso (processing) y consume stock en una transacción; sin stock suficiente no se aplica el cambio. Después: Despachado → Entregado → Completado. Pendiente también puede tener pago rechazado.",
          en: "Order status and payment status are separate. Validating payment moves the order straight to Processing (processing) and consumes stock in one transaction; insufficient stock prevents the change. Next: Dispatched → Delivered → Completed. A pending order may also have a rejected payment."
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
          es: "Ocultar/desactivar conserva el registro y retira el producto del catálogo público; se bloquea con pedidos en curso que lo incluyan directamente o en un combo. Eliminar es borrado físico e irreversible de producto, inventario y movimientos, y desactiva sus combos. Bloquea con pedidos no despachados/cerrados o asignaciones reservadas; estados desconocidos también bloquean. Despachados, entregados, completados y cancelados sin reservas no bloquean el borrado.",
          en: "Hiding/deactivating keeps the record and removes the product from the public catalog; in-flight orders containing it directly or in a combo block it. Delete is physical and irreversible removal of product, inventory and movements, and deactivates its combos. Orders not dispatched/closed or reserved allocations block deletion; unknown statuses also block it. Dispatched, delivered, completed and cancelled orders without reservations do not block deletion."
        }
      },
      {
        id: 'inventory-reservations',
        question: { es: '¿Por qué puede variar el inventario disponible?', en: 'Why can available inventory change?' },
        answer: {
          es: "Crear el pedido reserva unidades; validar el pago las consume. Cancelar antes de validar libera la reserva. Rechazar pago NO libera la reserva: el cliente puede subir otro comprobante. El stock consumido no vuelve automáticamente al cancelar: requiere devolución manual al inventario con motivo. Valores por defecto: 48 h sin comprobante, 168 h con comprobante sin revisar y máximo 5 reservas abiertas por cliente. Solo super_admin cambia la política en Configuración → Sistema; la limpieza de vencidos depende de la tarea programada.",
          en: "Creating the order reserves units; validating payment consumes them. Cancelling before validation releases the reservation. Rejecting payment does NOT release the reservation: the customer can upload another proof. Consumed stock is not returned automatically on cancellation: manual restocking with a reason is required. Defaults: 48 h without proof, 168 h with unreviewed proof and at most 5 open reservations per customer. Only super_admin changes the policy in Settings → System; expiry cleanup depends on the scheduled job."
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
          es: "Las remesas pendientes NO se recalculan automáticamente al cambiar la tasa del tipo. El cliente puede recalcular a la tasa actual en payment_pending o payment_rejected. En la UI solo super_admin crea tipos o edita tasas, comisiones y monedas; admin puede editar nombre, límites, SLA y estado activo. Verifica siempre la tasa guardada en cada remesa.",
          en: "Pending remittances are NOT automatically recalculated when the type rate changes. The customer can recalculate at the current rate in payment_pending or payment_rejected. In the UI only super_admin creates types or edits rates, fees and currencies; admin can edit name, limits, SLA and active status. Always check the rate stored on each remittance."
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
          es: "Solo para pruebas y solo super_admin. No la ejecutes basándote solo en esta ayuda: confirma entorno, respaldo recuperable y autorización. El botón requiere flag habilitado solo por SQL directo; escribe RESETEAR exactamente. La app no activa el flag y se auto-desarma al terminar. Borra pedidos, remesas, destinatarios, carritos, ofertas, combos, inventario y movimientos (stock 0), historial/estadísticas Zelle, cuentas bancarias, registros de notificaciones, alertas y métricas de visitas/categorías. Al borrar pedidos/remesas, también borra en cascada refund_requests, devengos y costos de mensajería y reajustes de pedidos/remesas. refund_request_events, sin FK, se conserva. Deshabilita usuarios no super_admin, no los borra. Conserva productos, categorías, configuración, tipos de remesa, zonas, tasas, monedas, publicaciones y cuentas Zelle (reinicia uso), además de activity_logs y logs de auditoría/destrucción. Verifica conteos y recarga inventario después; no hay deshacer desde la app.",
          en: "Test period and super_admin only. Do not execute it based only on this help: confirm environment, a recoverable backup and authorization. The button requires a flag enabled only through direct SQL; type RESETEAR exactly. The app cannot enable the flag and disarms itself when finished. It deletes orders, remittances, recipients, carts, offers, combos, inventory and movements (stock 0), Zelle history/statistics, bank accounts, notification logs, alerts and visit/category metrics. Deleting orders/remittances also deletes by cascade refund_requests, courier accruals and costs, and order/remittance readjustments. refund_request_events has no FK and is retained. It disables non-super_admin users, does not delete them. It keeps products, categories, configuration, remittance types, zones, rates, currencies, publications and Zelle accounts (usage resets), plus activity_logs and audit/destructive logs. Verify counts and reload inventory afterwards; the app has no undo."
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
          es: "La UI del registro es solo super_admin. Tiene retención configurada de 90 días; la purga depende de la tarea programada. Carga hasta 200 filas más recientes que cumplen los filtros del servidor, paginadas de 20. performed_by conserva la identidad del actor y no se redacta; evita compartirla por canales no autorizados. Reset y borrado masivo no borran activity_logs.",
          en: "The log UI is super_admin only. Configured retention is 90 days; purging depends on the scheduled job. It loads up to 200 newest rows matching the server filters, paginated by 20. performed_by keeps actor identity and is not redacted; do not share it through unauthorized channels. Reset and bulk deletion do not erase activity_logs."
        }
      }
    ]
  },
  {
    id: 'admin-settings', roles: ['super_admin'],
    title: { es: 'Configuración de plataforma', en: 'Platform settings' },
    entries: [
      { id: 'settings-overview', question: { es: '¿Cómo se organiza Configuración?', en: 'How is Settings organized?' }, answer: { es: 'Financiero controla márgenes y monedas; Envíos, zonas y tarifas; Visual, apariencia, temas y estructura del Hero; Pagos, métodos y cuentas receptoras; Mensajería, repartidores y pagos asociados; Contenido, funciones y guías publicadas; Sistema, controles operativos. Revisa primero la pestaña y el estado actual. Guarda solo cambios revisados y confirma el resultado visible.', en: 'Financial controls margins and currencies; Shipping, zones and rates; Visual, appearance, themes and Hero layout; Payments, methods and receiving accounts; Messaging, couriers and related payments; Content, feature cards and published guides; System, operational controls. Check the selected tab and current values first. Save only reviewed changes and verify the visible result.' } },
      { id: 'settings-payments', question: { es: '¿Dónde habilito métodos y qué ocurre con IBAN?', en: 'Where do I enable methods and what about IBAN?' }, answer: {"es": "En Pagos, la tarjeta superior controla cada método por Pedidos/Remesas. Solo permite activar métodos disponibles; las operaciones existentes siguen validándose al desactivar. Deshabilitar el último método exige confirmación adicional. IBAN/SEPA está No disponible y es solo lectura: no se puede activar ni introducir cuentas bancarias. Bizum tiene su propia pestaña de parámetros, cuentas y estado de tasa cuando el backend está disponible; no asumas su disponibilidad por ver el formulario.", "en": "In Payments, the top card controls each method for Orders/Remittances. Only available methods can be enabled; existing operations can still be validated after disabling. Disabling the last method requires extra confirmation. IBAN/SEPA is Not available and read-only: it cannot be enabled and bank account details must not be entered. Bizum has its own parameters, accounts and rate-status tab when the backend is available; seeing a form does not prove availability."} },
      { id: 'settings-financial-risk', question: { es: '¿Qué hago ante una alerta financiera roja?', en: 'What should I do when a red financial warning appears?' }, answer: { es: 'Detén el guardado y corrige el dato señalado. Revisa precios de pedidos frente al costo, márgenes/ganancias negativos, tasa y comisión de cada tipo de remesa, y reembolsos vencidos. Un precio bajo costo, una tasa de entrega superior a la de mercado o una comisión que anula el neto puede causar pérdidas; concilia reembolsos por ID y no repitas pagos. La alerta explica el riesgo, pero no sustituye la revisión ni autoriza una excepción.', en: 'Stop the save and correct the flagged value. Review order prices against cost, negative margins/profit, each remittance type’s rate and fee, and overdue refunds. A below-cost price, delivery rate above market, or fee that eliminates the net amount can cause losses; reconcile refunds by ID and do not duplicate payments. The warning explains the risk but does not replace review or authorize an override.' } },
      { id: 'settings-messaging-content', question: { es: '¿Cómo administrar Mensajería y Contenido?', en: 'How do I manage Messaging and Content?' }, answer: {"es": "Mensajería administra mensajeros, reglas versionadas de costo por entrega, devengos y reportes. Contenido tiene tres guardados independientes: Notificaciones, tarjetas de inicio y Publicaciones y Guías. Guarda cada bloque por separado y verifica su resultado.", "en": "Messaging manages couriers, versioned delivery cost rules, accruals and reports. Content has three independent saves: Notifications, home cards and Publications and Guides. Save each block separately and verify its result."} }
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
    entries: USER_ACCESS_ENTRIES
  },
  {
    id: 'admin-user-panel', roles: ['super_admin'],
    title: { es: 'Panel de Usuario', en: 'User panel' },
    entries: [
      { id: 'user-panel-operations', question: { es: '¿Qué muestra el Panel de Usuario?', en: 'What does the User Panel show?' }, answer: {"es": "Para admin y super_admin es la cola de trabajo de pedidos, remesas y devoluciones: valida o rechaza comprobantes, avanza entregas y resuelve devoluciones según estado. No es solo Mis compras del cliente. Confirma siempre ID, monto y evidencia antes de actuar.", "en": "For admin and super_admin this is the work queue for orders, remittances and refunds: validate or reject proofs, advance deliveries and resolve refunds according to status. It is not just the customer’s My purchases view. Always confirm ID, amount and evidence before acting."} },
      { id: 'user-panel-support', question: { es: '¿Cómo orientar a un usuario con un pedido o remesa?', en: 'How should I guide a user about an order or remittance?' }, answer: {"es": "No puedes validar, procesar, entregar, ajustar comisión ni reajustar tu propia compra/remesa: debe hacerlo otro administrador. Puedes cancelar tu pedido propio pending sin pago validado o tu remesa payment_pending. La devolución propia tiene la excepción de super_admin con confirmación adicional. Si aparece CONFLICT, otro admin cambió el registro: revisa la lista actualizada y el estado nuevo antes de actuar; no repitas la acción a ciegas. Para soporte pide el ID, nunca contraseñas.", "en": "You cannot validate, process, deliver, adjust commission or readjust your own purchase/remittance: another administrator must do it. You can cancel your own pending order without validated payment or your payment_pending remittance. Your own refund has a super_admin exception with extra confirmation. CONFLICT means another admin changed the record: check the refreshed list and new status before acting; do not blindly repeat the action. For support ask for the ID, never passwords."} }
    ]
  }
];

export function getHelpSectionsForRole(userRole) {
  if (userRole !== 'admin' && userRole !== 'super_admin') return [];
  const sections = HELP_SECTIONS.filter(section => section.roles.includes(userRole));
  return userRole === 'super_admin' ? [...sections, ...buildAdminContextGuides()] : sections;
}

const ORDER_OPERATION_ENTRIES = [
  {
    id: "order-validation",
    question: { es: "¿Qué hace Validar pago y cómo rechazo un comprobante?", en: "What does Validate payment do and how do I reject proof?" },
    answer: {
      es: "Al validar el pago pasa directamente a En proceso (processing) y consume stock; no necesitas iniciar procesamiento salvo el caso legado pending con pago validated. Si falta stock, no cambia nada. Rechazar exige motivo de 1–500 caracteres: el pedido sigue pending, el cliente puede reintentar y NO se libera la reserva.",
      en: "Validating payment moves straight to Processing (processing) and consumes stock; Start processing is only needed for the legacy pending order with validated payment. Insufficient stock leaves everything unchanged. Reject requires a 1–500 character reason: the order stays pending, the customer may retry and the reservation is NOT released."
    }
  },
  {
    id: "order-cancel-restock",
    question: { es: "¿Cuándo puedo cancelar y devolver stock?", en: "When can I cancel and return stock?" },
    answer: {
      es: "La cancelación normal del admin solo admite pending o processing, con motivo de 1–500 caracteres y confirmación. Con pago validado abre una devolución, pero no devuelve stock consumido. Usa Devolver al inventario como acción manual con motivo tras comprobar el retorno físico; no confundas reembolso con restock.",
      en: "Normal admin cancellation is only for pending or processing, with a 1–500 character reason and confirmation. Validated payment opens a refund request, but consumed stock is not returned. Use Return to inventory as a manual action with a reason after checking physical return; a refund is not a restock."
    }
  },
  {
    id: "order-readjust",
    question: { es: "¿Qué permite Reajustar pedido?", en: "What does Readjust order allow?" },
    answer: {
      es: "Solo super_admin puede Reajustar pedido, nunca el propio: precios unitarios, descuento, envío y estados de pedido/pago, con motivo de 10–500 caracteres e historial auditado. No reembolsa ni abona automáticamente la diferencia, conserva fechas existentes y no recalcula devengos del mensajero. Al reabrir cierra la devolución pendiente; si queda activo y pagado consume stock o falla toda la operación. Si la función no está disponible, no intentes eludirla.",
      en: "Only super_admin can Readjust order, never their own: unit prices, discount, shipping and order/payment statuses, with a 10–500 character reason and audited history. It does not automatically refund or credit the difference, keeps existing dates and does not recalculate courier accruals. Reopening closes the pending refund; if active and paid it consumes stock or the whole operation fails. If the function is unavailable, do not bypass it."
    }
  },
  {
    id: "order-delivery",
    question: { es: "¿Cómo despacho y confirmo entrega?", en: "How do I dispatch and confirm delivery?" },
    answer: {
      es: "Despacha desde processing; el tracking es opcional. Marca Entregado desde dispatched, con foto opcional, y después Completar desde delivered. El selector de mensajero es opcional al entregar; registra la asignación antes de calcular el costo. No valides ni avances tu propia compra: debe hacerlo otro administrador.",
      en: "Dispatch from processing; tracking is optional. Mark Delivered from dispatched with an optional photo, then Complete from delivered. The courier selector is optional at delivery; assignment is recorded before cost calculation. Do not validate or advance your own purchase: another administrator must do it."
    }
  }
];

const REMITTANCE_OPERATION_ENTRIES = [
  {
    id: "remittance-transitions",
    question: { es: "¿Validar también inicia Procesar?", en: "Does Validate also start Process?" },
    answer: {
      es: "Validar comprobante pasa de payment_proof_uploaded a payment_validated: no inicia Procesar. Pulsa Procesar para pasar a processing, luego confirma entrega (foto opcional) y completa desde delivered. Rechazar el comprobante requiere motivo de 1–500 caracteres y permite al cliente volver a subirlo.",
      en: "Validating proof moves payment_proof_uploaded to payment_validated: it does not start Process. Press Process to enter processing, then confirm delivery (optional photo) and complete from delivered. Rejecting proof requires a 1–500 character reason and lets the customer upload again."
    }
  },
  {
    id: "remittance-admin-cancel",
    question: { es: "¿Cuándo puede cancelar el admin?", en: "When can the admin cancel?" },
    answer: {
      es: "El admin solo puede cancelar normalmente en payment_pending, con motivo de 1–500 caracteres. Comprueba primero en Zelle si llegó dinero: no tener comprobante no demuestra impago. Esta cancelación no crea devolución. Con comprobante subido corresponde Rechazar, no Cancelar; validada o en proceso no admite cancelación normal.",
      en: "The admin can only use payment_pending for normal cancellation, with a 1–500 character reason. Check Zelle for received money first: missing proof does not prove non-payment. This cancellation creates no refund. Uploaded proof uses Reject, not Cancel; validated or processing remittances do not allow normal cancellation."
    }
  },
  {
    id: "remittance-commission",
    question: { es: "¿Cómo funciona Ajustar comisión?", en: "How does Adjust commission work?" },
    answer: {
      es: "Admin y super_admin pueden ajustar en payment_pending o payment_rejected; se congela al subir el comprobante. La comisión debe ser ≥0 y menor que lo enviado, con hasta 2 decimales y motivo de 10–500 caracteres no visible al cliente. Conserva la tasa aplicada y pone el descuento de oferta a 0. Si sube, el cliente debe aceptar antes de subir comprobante, o cancelar; si baja, solo recibe aviso.",
      en: "Admin and super_admin can adjust in payment_pending or payment_rejected; the commission freezes on proof upload. It must be ≥0 and below the sent amount, with up to 2 decimals and a 10–500 character reason hidden from the customer. It keeps the applied rate and sets the offer discount to 0. If it increases, the customer must accept before uploading proof, or cancel; a decrease only sends a notice."
    }
  },
  {
    id: "remittance-readjust",
    question: { es: "¿Qué cambia Reajustar remesa?", en: "What changes with Readjust remittance?" },
    answer: {
      es: "Reajustar remesa (solo en Dashboard → Remesas). Solo super_admin puede reajustar, nunca su propia remesa: monto enviado, tasa, comisión, monto a entregar y estado, con motivo de 10–500 caracteres e historial auditado. Sin un monto a entregar explícito, solo si cambia el monto enviado, la tasa o la comisión recalcula (enviado − comisión) × tasa. Si solo cambia el estado, conserva el monto a entregar guardado. Conserva fechas y no recalcula el devengo del mensajero: ajústalo aparte en Mensajería → Por pagar. Cancelar desde un estado con pago validado abre una devolución. Si la función no está disponible, no intentes eludirla.",
      en: "Readjust remittance (only in Dashboard → Remittances). Only super_admin can readjust, never their own remittance: sent amount, rate, commission, delivery amount and status, with a 10–500 character reason and audited history. Without an explicit delivery amount, only changes to the sent amount, rate or commission recalculate (sent − commission) × rate. If only the status changes, the stored delivery amount is kept. It keeps dates and does not recalculate the courier accrual: adjust it separately in Messaging → Payable. Cancelling from a validated-payment state opens a refund. If the function is unavailable, do not bypass it."
    }
  }
];

const ZELLE_ACCOUNT_ENTRIES = [
  {
    id: "zelle-limits",
    question: { es: "¿Los límites Zelle bloquean pagos?", en: "Do Zelle limits block payments?" },
    answer: {
      es: "Los límites son orientativos: la asignación automática los respeta y el selector avisa, pero no bloquean pagos ni pedidos. El uso se calcula en USD con día/mes en America/New_York; 0 o vacío significa sin límite. Revisa titular, contacto visible (email/teléfono), prioridad y destino pedidos/remesas antes de guardar.",
      en: "Limits are advisory: automatic assignment respects them and the selector warns, but they do not block payments or orders. Usage is calculated in USD with day/month in America/New_York; 0 or empty means unlimited. Check holder, visible contact (email/phone), priority and orders/remittances scope before saving."
    }
  },
  {
    id: "zelle-delete",
    question: { es: "¿Eliminar una cuenta Zelle la borra siempre?", en: "Does Delete always remove a Zelle account?" },
    answer: {
      es: "No: si hay operaciones con comprobante pendiente de validar, el borrado normal se bloquea. Con historial u operaciones sin comprobante, desactiva en vez de borrar; para los afectados sin comprobante intenta crear alertas persistentes y enviar emails (los avisos pueden fallar sin revertir la desactivación). Solo sin dependencias hace borrado físico. Concilia primero los pagos y el resultado mostrado.",
      en: "No: operations with proof awaiting validation block normal deletion. With history or operations without proof, it deactivates rather than deletes; for affected operations without proof it attempts persistent alerts and emails (notification failure does not undo deactivation). Only an account without dependencies is physically deleted. Reconcile payments and check the reported result first."
    }
  }
];

// Tuples: [localized title, ES answer or focused entries, EN answer, existing visual metadata].
const ADMIN_CONTEXT_GUIDES = {
  'settings-financiero': [{"es": "Financiero", "en": "Financial"}, [
      {
        id: "financial-reprice",
        question: { es: "¿Guardar una tasa USD↔CUP cambia precios?", en: "Does saving a USD↔CUP rate change prices?" },
        answer: {
          es: "Sí: al guardar una tasa USD↔CUP, el flujo de reprecio actualiza productos con costo CUP y todos los combos con total positivo. Productos: costo CUP ÷ tasa; combos: total anterior × tasa anterior ÷ tasa nueva. Revisa la vista previa antes de guardar; pide segunda confirmación si la variación absoluta supera 10 % frente a la tasa de la última ejecución (applied, noop o backfill). Solo sin ninguna ejecución previa se exige también en la primera aplicación. Tras el backfill del 2026-11-10, se compara con esa tasa guardada hasta la siguiente ejecución. Los pedidos existentes no cambian. Si falla el reprecio, la tasa puede quedar guardada: revisa Precios desactualizados y Reintentar, no supongas que se revirtió.",
          en: "Yes: when saving a USD↔CUP rate, the repricing flow updates CUP-cost products and all combos with a positive total. Products: CUP cost ÷ rate; combos: previous total × previous rate ÷ new rate. Review the preview before saving; a second confirmation is required if the absolute change exceeds 10 % versus the rate of the latest run (applied, noop or backfill). Only with no previous run is it also required for the first application. After the 2026-11-10 backfill, comparison uses that stored rate until the next run. Existing orders do not change. If repricing fails, the rate may remain saved: check Prices outdated and Retry; do not assume rollback."
        }
      },
      {
        id: "financial-permissions-margins",
        question: { es: "¿Quién cambia tasas y qué significa margen?", en: "Who changes rates and what does margin mean?" },
        answer: {
          es: "Solo super_admin crea, edita, desactiva o elimina tasas y desactiva monedas (y sus tasas); las monedas no se borran físicamente. Los márgenes globales de productos/combos aceptan 0–999,99 % y solo prellenan formularios: no reprecian registros existentes. Margen aquí es recargo sobre costo, no porcentaje de ganancia sobre venta. En productos la prioridad es producto > categoría > global.",
          en: "Only super_admin creates, edits, deactivates or deletes rates and deactivates currencies (and their rates); currencies are not physically deleted. Global product/combo margins accept 0–999.99 % and only prefill forms: they do not reprice existing records. Margin here means markup on cost, not profit percentage of sales. Product precedence is product > category > global."
        }
      }
    ], null],
  'settings-envios': [{"es": "Envíos", "en": "Shipping"}, [
      {
        id: "shipping-autosave",
        question: { es: "¿Cómo se guardan las tarifas de envío?", en: "How are shipping rates saved?" },
        answer: {
          es: "Autoguardado al salir del campo. Costo Envío lo paga el cliente; Costo Transporte es interno. En provincia, al salir de Costo Envío con costo y transporte en 0 se desactiva la zona; cambiar solo Costo Transporte no recalcula su estado activo. En un municipio, Costo Envío 0 se guarda como envío gratis. Una fila municipal activa prevalece; si falta o está inactiva rige la provincial.",
          en: "Fields autosave on field blur. Shipping Cost is paid by the customer; Transport Cost is internal. For a province, blurring Shipping Cost when shipping and transport costs are 0 deactivates the zone; changing only Transport Cost does not recompute its active status. For a municipality, Shipping Cost 0 is saved as free shipping. An active municipal row takes precedence; if missing or inactive, the province rate applies."
        }
      }
    ], null, [
    { src: '/help-examples/shipping-zones.png', alt: { es: 'Resumen de zonas de envío por provincia.', en: 'Shipping zones by province.' } },
    { src: '/help-examples/shipping-zone-detail.png', alt: { es: 'Excepciones de envío para una zona.', en: 'Shipping exceptions for a zone.' } },
  ]],
  'settings-visual': [{"es": "Visual", "en": "Visual"}, [
      {
        id: "visual-save-permissions",
        question: { es: "¿Cuándo se guardan tema, Hero y personalización?", en: "When are theme, Hero and personalization saved?" },
        answer: {
          es: "En la UI, tema y composición del Hero son solo super_admin. La vista previa es un borrador que puede afectar toda la app mientras editas: no se persiste hasta Guardar Personalización. Restaurar el tema también necesita guardar. Las diapositivas del carrusel tienen acciones de guardado independientes; no dependen de ese botón.",
          en: "In the UI, theme and Hero composition are super_admin only. Live preview is a draft that can affect the whole app while editing: it is not persisted until Save Personalization. Restoring the theme also needs saving. Carousel slides have independent save actions; they do not depend on that button."
        }
      }
    ], null, { src: '/help-examples/hero-layout.png', alt: { es: 'Opciones de composición del Hero.', en: 'Hero layout options.' } }],
  'settings-zelle': [{"es": "Pagos · Zelle", "en": "Payments · Zelle"}, ZELLE_ACCOUNT_ENTRIES, null],
  'settings-zelle-zelle': [{"es": "Pagos · Cuentas Zelle", "en": "Payments · Zelle accounts"}, ZELLE_ACCOUNT_ENTRIES, null, { src: '/help-examples/zelle-accounts-redacted.png', alt: { es: 'Ejemplo de configuración de cuentas Zelle con datos de contacto ocultos.', en: 'Zelle accounts example with contact data redacted.' } }],
  'settings-zelle-iban': [{"es": "Pagos · IBAN/SEPA", "en": "Payments · IBAN/SEPA"}, 'IBAN/SEPA está No disponible y es solo lectura. No se puede activar ni introducir datos bancarios aquí. Los badges EUR→USD y EUR→CUP solo informan del estado de tasas; no habilitan cobros.', 'IBAN/SEPA is Not available and read-only. It cannot be activated and bank details must not be entered here. EUR→USD and EUR→CUP badges only report rate status; they do not enable collections.'],
  'settings-zelle-bizum': [{"es": "Pagos · Bizum", "en": "Payments · Bizum"}, [
      {
        id: "bizum-parameters",
        question: { es: "¿Qué configura la pestaña Bizum?", en: "What does the Bizum tab configure?" },
        answer: {
          es: "Configura parámetros y cuentas receptoras: margen Bizum, validez/gracia de cotización, límites por operación/usuario y avisos de tasa. Requiere tasa USD→EUR activa y fresca; una tasa antigua puede provocar aviso o bloqueo según los umbrales del servidor. El formulario no activa el método: usa los interruptores superiores solo si está disponible. La pestaña puede ocultarse si falta el catálogo o esquema del backend.",
          en: "Configure parameters and receiving accounts: Bizum spread, quote validity/grace, operation/user limits and rate warnings. An active, fresh USD→EUR rate is required; a stale rate can trigger a warning or block according to server thresholds. The form does not activate the method: use the top switches only when available. The tab may be hidden if the backend catalog or schema is missing."
        }
      }
    ], null],
  'settings-mensajeria': [{"es": "Mensajería", "en": "Messaging"}, [
      {
        id: "courier-overview",
        question: { es: "¿Qué administra Mensajería?", en: "What does Messaging manage?" },
        answer: {
          es: "Administra mensajeros, reglas de costo por entrega, devengos Por pagar y Reportes. Desactivar un mensajero conserva su historial e impide nuevas asignaciones. El costo se calcula al entregar; si no hay regla o tasa aplicable queda desconocido, nunca cero. Si el módulo muestra No disponible, no interpretes la falta de datos como costo cero.",
          en: "Manage couriers, delivery cost rules, Payable accruals and Reports. Deactivating a courier keeps history and prevents new assignments. Cost is calculated on delivery; missing applicable rules or rates leave it unknown, never zero. If the module shows Unavailable, missing data is not zero cost."
        }
      }
    ], null],
  'settings-mensajeria-couriers': [{"es": "Mensajería · Mensajeros", "en": "Messaging · Couriers"}, 'Agrega el nombre del mensajero, verifica que quede activo y edita sus datos cuando corresponda. Desactivar impide asignaciones futuras, pero conserva el historial. Revisa sus tipos de pago suscritos antes de asignarle nuevas entregas.', 'Add the courier name, verify active status and edit their details when needed. Deactivation prevents future assignments but preserves history. Review subscribed payment types before assigning new deliveries.', { src: '/help-examples/couriers-redacted.png', alt: { es: 'Ejemplo de mensajeros con nombres ocultos.', en: 'Couriers example with names redacted.' } }],
  'settings-mensajeria-types': [{"es": "Mensajería · Tipos de pago", "en": "Messaging · Payment types"}, [
      {
        id: "courier-cost-rules",
        question: { es: "¿Tipos de pago son métodos de pago?", en: "Are Payment types payment methods?" },
        answer: {
          es: "No: son reglas de costo por entrega para pedidos, remesas o ambos, no métodos de cobro. Elige monto fijo USD/CUP, CUP por USD o porcentaje de una base compatible. Cada cambio crea una versión nueva con vigencia desde/hasta; el inicio no puede estar en el pasado. Conserva versiones anteriores para auditoría; no reescribe entregas ya devengadas.",
          en: "No: these are delivery cost rules for orders, remittances or both, not collection methods. Choose a fixed USD/CUP amount, CUP per USD or percentage of a compatible base. Each change creates a new version with a validity window; its start cannot be in the past. Previous versions remain for audit; existing delivery accruals are not rewritten."
        }
      },
      {
        id: "courier-rule-precedence",
        question: { es: "¿Qué regla gana y cómo funcionan los rangos?", en: "Which rule wins and how do ranges work?" },
        answer: {
          es: "Prioridad: mensajero (propia o suscrita) > zona > tipo de remesa > rango > general. En (X,Y], X queda excluido e Y incluido. Evita solapes y mezcla de monedas en el mismo alcance y periodo. Los huecos requieren aceptación explícita: una entrega en un hueco queda con costo desconocido, no bloqueada. Usa el simulador antes de guardar.",
          en: "Priority: courier (own or subscribed) > zone > remittance type > range > general. In (X,Y], X is excluded and Y included. Avoid overlapping ranges and mixed currencies in the same scope and period. Gaps require explicit acceptance: a delivery in a gap has unknown cost, not a blocked delivery. Use the simulator before saving."
        }
      },
      {
        id: "courier-subscriptions",
        question: { es: "¿Qué cambia una suscripción de mensajero?", en: "What does a courier subscription change?" },
        answer: {
          es: "Suscribir un tipo general le da prioridad de mensajero para entregas futuras; no cambia costos ya registrados. No se puede suscribir un tipo propio de otro mensajero. Quitar una suscripción tampoco cambia entregas anteriores; revisa los avisos de huecos.",
          en: "Subscribing a general type gives it courier-level priority for future deliveries; recorded costs stay unchanged. A type belonging to another courier cannot be subscribed. Removing a subscription also leaves past deliveries unchanged; review gap warnings."
        }
      }
    ], null, { src: '/help-examples/messenger-payment-thresholds.png', alt: { es: 'Configuración de umbrales de pago para mensajería.', en: 'Messenger payment thresholds settings.' } }],
  'settings-mensajeria-payable': [{"es": "Mensajería · Por pagar", "en": "Messaging · Payable"}, [
      {
        id: "courier-unknown-payment",
        question: { es: "¿Puedo pagar un costo desconocido?", en: "Can I pay an unknown cost?" },
        answer: {
          es: "Un costo desconocido no es cero: no puedes pagar un devengo desconocido. Recalcular solo completa un importe desconocido y usa la regla y tasa de ahora, no las de la entrega. Selecciona conceptos conocidos del mensajero, revisa el total y registra método, referencia y fecha al Marcar pagado. El pago es inmutable y no se edita ni borra.",
          en: "An unknown cost is not zero: you cannot pay an accrual with an unknown amount. Recalculate only fills an unknown amount and uses the current rule and rate, not delivery-time values. Select known items for the courier, review the total and record method, reference and date when marking paid. The payment is immutable and cannot be edited or deleted."
        }
      },
      {
        id: "courier-corrections-backfill",
        question: { es: "¿Quién anula, ajusta o genera costos faltantes?", en: "Who can void, adjust or backfill missing costs?" },
        answer: {
          es: "Admin puede anular o reasignar un devengo no pagado. Solo super_admin puede anular uno pagado, Ajustar monto de una entrega pagada o Generar costos faltantes (backfill). Anular/ajustar exige motivo de 10–500 caracteres; el ajuste añade un concepto, no cambia el pago original. Backfill genera devengos faltantes con la regla y tasa de ahora; revisa el periodo antes de confirmar.",
          en: "Admin can void or reassign an unpaid accrual. Only super_admin can void a paid one, Adjust amount for a paid delivery or Generate missing costs (backfill). Voiding/adjusting requires a 10–500 character reason; an adjustment adds an item without changing the original payment. Backfill generates missing accruals using the current rule and rate; review the period before confirming."
        }
      },
      {
        id: "courier-after-delivery",
        question: { es: "¿Cómo asigno mensajero tras la entrega?", en: "How do I assign a courier after delivery?" },
        answer: {
          es: "Solo super_admin: filtra Entregadas sin mensajero para operaciones delivered/completed con devengo de entrega sin asignar, desconocido y no pagado. Elige mensajero y motivo de 10–500 caracteres; revisa la vista previa del servidor (costo, regla, precedencia y tasa/origen) y confirma el efecto retroactivo. Puede cambiar cifras de meses anteriores: no hay cierres congelados. Usa reglas de hoy; para USD→CUP de remesas usa la tasa congelada de la operación. Si cambia la cotización exige otra vista previa.",
          en: "Only super_admin: filter Delivered without courier for delivered/completed operations with an unassigned, unknown, unpaid delivery accrual. Choose a courier and a 10–500 character reason; review the server preview (cost, rule, precedence and rate/source) and confirm the retroactive effect. It can change past months: there are no frozen closings. It uses today’s rules; USD→CUP remittances use the operation’s frozen rate. A changed quote requires a fresh preview."
        }
      }
    ], null, { src: '/help-examples/messenger-payable.png', alt: { es: 'Lista de entregas pendientes de pago.', en: 'List of deliveries pending payment.' } }],
  'settings-mensajeria-reports': [{"es": "Mensajería · Reportes", "en": "Messaging · Reports"}, [
      {
        id: "courier-report-csv",
        question: { es: "¿Qué contiene el reporte CSV?", en: "What is in the CSV report?" },
        answer: {
          es: "Filtra periodo y mensajero. El CSV desglosa entregas de pedidos/remesas, USD enviados, devengado CUP/USD, pagado, pendiente, anulado y anulado tras pago. Los importes desconocidos y márgenes desconocidos se cuentan aparte, nunca como cero; no incluye datos personales de clientes.",
          en: "Filter by period and courier. The CSV breaks down order/remittance deliveries, USD sent, CUP/USD accrued, paid, pending, voided and voided after payment. Unknown amounts and unknown margins are counted separately, never as zero; customer personal data is not included."
        }
      },
      {
        id: "courier-margin-thresholds",
        question: { es: "¿Qué significan los umbrales de margen?", en: "What do margin thresholds mean?" },
        answer: {
          es: "Configura objetivo, alerta baja y crítico bajo por separado para pedidos y remesas. Campos vacíos = sin alertas; no hay valores numéricos predeterminados del negocio. Los reportes separan alerta, crítico y desconocido. Un costo desconocido no equivale a margen sano.",
          en: "Set target, low warning and low critical separately for orders and remittances. Empty fields = no alerts; there are no preset business threshold numbers. Reports separate warning, critical and unknown. An unknown cost does not mean a healthy margin."
        }
      }
    ], null, { src: '/help-examples/messenger-reports.png', alt: { es: 'Filtros para reportes de mensajería.', en: 'Messenger report filters.' } }],
  'settings-contenido': [{"es": "Contenido", "en": "Content"}, [
      {
        id: "content-independent-saves",
        question: { es: "¿Un Guardar aplica todo Contenido?", en: "Does one Save apply all Content changes?" },
        answer: {
          es: "No: hay tres guardados independientes. Notificaciones guarda el destino WhatsApp Cuenta/Grupo; tarjetas de inicio guarda visibilidad, destino y orden; Guardar publicaciones aplica Publicaciones y Guías. Quitar una tarjeta o publicación solo se persiste al guardar su bloque. Borrar una publicación guardada también elimina su portada: es irreversible.",
          en: "No: there are three independent saves. Notifications saves the WhatsApp Account/Group destination; home cards saves visibility, destination and order; Save publications applies Publications and Guides. Removing a card or publication is only persisted when its block is saved. Deleting a saved publication also removes its cover: it is irreversible."
        }
      },
      {
        id: "content-notifications",
        question: { es: "¿Los avisos WhatsApp se envían automáticamente?", en: "Are WhatsApp notices sent automatically?" },
        answer: {
          es: "Los botones abren enlaces WhatsApp por acción del usuario, no envíos automáticos del servidor. Configura Cuenta (número) o Grupo (enlace) y guarda Notificaciones. Sin destino, Contactar/notificar queda no disponible. Trata el número y el enlace de invitación como datos privados.",
          en: "The buttons open WhatsApp links through user action, not automatic server sends. Configure Account (number) or Group (link) and save Notifications. Without a destination, Contact/notify is unavailable. Treat the number and invite link as private data."
        }
      }
    ], null, [
    { src: '/help-examples/home-features.png', alt: { es: 'Configuración de funcionalidades de la página principal.', en: 'Home page feature settings.' } },
    { src: '/help-examples/publications-guides.png', alt: { es: 'Publicaciones y guías disponibles.', en: 'Available publications and guides.' } },
  ]],
  'settings-notifications': [{"es": "Notificaciones", "en": "Notifications"}, 'Configura si los avisos salen a una cuenta o a un grupo. Verifica el número y enlace de destino con el responsable antes de guardar; trata los enlaces de invitación y los números de contacto como datos privados.', 'Choose whether notifications go to an account or group. Verify the destination number and link with the owner before saving; treat invite links and contact numbers as private data.', { src: '/help-examples/notifications-redacted.png', alt: { es: 'Ejemplo de ajustes de notificaciones con número y enlace ocultos.', en: 'Notification settings example with phone and invite link redacted.' } }],
  'settings-stock-policy': [{"es": "Política de reservas de stock", "en": "Stock reservation policy"}, 'Ajusta los plazos de retención y límites solo tras confirmar la política operativa. Comprueba los rangos permitidos: la liberación de reservas vencidas depende de la tarea programada de expiración; guardar no activa esa tarea ni devuelve stock ya consumido.', 'Change reservation windows and limits only after confirming the operating policy. Check allowed ranges: releasing expired reservations depends on the scheduled expiry job; saving does not activate that job or return already consumed stock.', { src: '/help-examples/stock-reservation-policy.png', alt: { es: 'Controles de la política de reservas de stock.', en: 'Stock reservation policy controls.' } }],
  'settings-sistema': [{"es": "Sistema", "en": "System"}, [
      {
        id: "system-reset",
        question: { es: "¿Qué borra y conserva el reset?", en: "What does reset delete and keep?" },
        answer: {
          es: "Solo para pruebas y solo super_admin. No la ejecutes basándote solo en esta ayuda: confirma entorno, respaldo recuperable y autorización. El botón requiere flag habilitado solo por SQL directo; escribe RESETEAR exactamente. La app no activa el flag y se auto-desarma al terminar. Borra pedidos, remesas, destinatarios, carritos, ofertas, combos, inventario y movimientos (stock 0), historial/estadísticas Zelle, cuentas bancarias, registros de notificaciones, alertas y métricas de visitas/categorías. Al borrar pedidos/remesas, también borra en cascada refund_requests, devengos y costos de mensajería y reajustes de pedidos/remesas. refund_request_events, sin FK, se conserva. Deshabilita usuarios no super_admin, no los borra. Conserva productos, categorías, configuración, tipos de remesa, zonas, tasas, monedas, publicaciones y cuentas Zelle (reinicia uso), además de activity_logs y logs de auditoría/destrucción. Verifica conteos y recarga inventario después; no hay deshacer desde la app.",
          en: "Test period and super_admin only. Do not execute it based only on this help: confirm environment, a recoverable backup and authorization. The button requires a flag enabled only through direct SQL; type RESETEAR exactly. The app cannot enable the flag and disarms itself when finished. It deletes orders, remittances, recipients, carts, offers, combos, inventory and movements (stock 0), Zelle history/statistics, bank accounts, notification logs, alerts and visit/category metrics. Deleting orders/remittances also deletes by cascade refund_requests, courier accruals and costs, and order/remittance readjustments. refund_request_events has no FK and is retained. It disables non-super_admin users, does not delete them. It keeps products, categories, configuration, remittance types, zones, rates, currencies, publications and Zelle accounts (usage resets), plus activity_logs and audit/destructive logs. Verify counts and reload inventory afterwards; the app has no undo."
        }
      },
      {
        id: "system-stock-policy",
        question: { es: "¿Qué política de reservas puedo guardar?", en: "Which reservation policy can I save?" },
        answer: {
          es: "Solo super_admin cambia la política. Valores por defecto: 48 h sin comprobante (incluye pago rechazado), 168 h con comprobante sin revisar y máximo 5 reservas abiertas por cliente. Rangos: 6–720 h, 24–2160 h y 1–50; el plazo con comprobante no puede ser menor al sin comprobante. Superar el máximo rechaza y cancela el nuevo pedido. Se aplica a nuevas reservas y a la próxima limpieza: depende de la tarea programada de expiración; guardar no activa esa tarea. Los vencidos se cancelan y liberan reserva, no stock ya consumido.",
          en: "Only super_admin changes the policy. Defaults: 48 h without proof (including rejected payment), 168 h with unreviewed proof and at most 5 open reservations per customer. Bounds: 6–720 h, 24–2160 h and 1–50; the proof window cannot be shorter than the no-proof window. Exceeding the cap rejects and cancels the new order. It applies to new reservations and the next cleanup: expiry depends on the scheduled cleanup job; saving does not activate that job. Expired orders are cancelled and reservations released, not already consumed stock."
        }
      }
    ], null, { src: '/help-examples/platform-reset.png', alt: { es: 'Aviso de restablecimiento de la plataforma.', en: 'Platform reset warning.' } }],
  'dashboard-overview': [{"es": "Resumen General", "en": "Overview"}, [
      {
        id: "dashboard-headlines",
        question: { es: "¿Qué significan Ventas, Ingreso neto y Cobrado?", en: "What do Sales, Net income and Collected mean?" },
        answer: {
          es: "Ventas = total bruto de pedidos activos con pago validado, incluido envío y costo de mercadería; no incluye remesas. Cobrado = esos totales de pedidos + monto enviado de remesas validadas + sus cargos de envío/entrega. Incluye dinero que debes entregar al destinatario: no es ganancia. Las tres cifras no se suman entre sí; son lecturas distintas del mismo negocio, visibles para super_admin.",
          en: "Sales = gross total of active orders with validated payment, including shipping and cost of goods; remittances are excluded. Collected = those order totals + sent amounts of validated remittances + their delivery charges. It includes money owed to recipients: it is not profit. The three figures must not be added together; they are different views of the same business, visible to super_admin."
        }
      },
      {
        id: "dashboard-net-estimate",
        question: { es: "¿Por qué el Ingreso neto es estimado?", en: "Why is Net income estimated?" },
        answer: {
          es: "Ingreso neto = ganancia estimada de productos − descuentos del pedido + diferencia de envío de pedidos con costo conocido + comisiones y cargos de entrega de remesas − costo conocido de mensajería de remesas. La estimación usa el recargo del artículo o el predeterminado si no tiene margen. Excluye el costo desconocido de mensajería y lo cuenta aparte; desconocido no es cero. Asignar mensajero retroactivamente puede cambiar meses anteriores.",
          en: "Net income = estimated product profit − order discounts + order shipping difference where cost is known + remittance commissions and delivery charges − known remittance courier cost. The estimate uses the item markup or the default when its margin is missing. It excludes unknown courier cost and counts it separately; unknown is not zero. Retroactive courier assignment can change past months."
        }
      },
      {
        id: "dashboard-financial-windows",
        question: { es: "¿Qué fecha y periodo usa el dinero?", en: "Which date and period do financial figures use?" },
        answer: {
          es: "Hoy/Mes/Año son ventanas de calendario en America/New_York hasta ahora, no 24 h/30 días móviles. Cuenta por fecha de validación del pago (validated_at en pedidos, payment_validated_at en remesas), no por fecha de creación. Solo cuentan pedidos processing/dispatched/delivered/completed con pago validado y remesas payment_validated/processing/delivered/completed; cancelados o sin validar no entran en estas cifras.",
          en: "Today/Month/Year are calendar windows in America/New_York through now, not rolling 24 h/30 days. They count by payment validation date (validated_at for orders, payment_validated_at for remittances), not creation date. Only processing/dispatched/delivered/completed orders with validated payment and payment_validated/processing/delivered/completed remittances count; cancelled or unvalidated operations are excluded."
        }
      },
      {
        id: "dashboard-visits",
        question: { es: "¿Las visitas usan el mismo calendario?", en: "Do visits use the same calendar?" },
        answer: {
          es: "No. Aunque las etiquetas digan semana/mes/año, las visitas usan ventanas móviles de 7/30/365 días y un total histórico. No son los periodos calendario del dinero. Un guion o No disponible indica falta de datos o error, no cero: revisa el estado de carga y Actualizar antes de comparar.",
          en: "No. Although labelled week/month/year, visits use rolling 7/30/365-day windows and a historical total. These are not the financial calendar periods. A dash or Unavailable means missing data or an error, not zero: check loading status and Refresh before comparing."
        }
      }
    ], null],
  'dashboard-orders': [{"es": "Historial de Órdenes", "en": "Order history"}, ORDER_OPERATION_ENTRIES, null, { src: '/help-examples/order-history-redacted.png', alt: { es: 'Ejemplo del historial de órdenes con datos de clientes ocultos.', en: 'Order history example with customer data redacted.' } }],
  'dashboard-remittances': [{"es": "Remesas", "en": "Remittances"}, REMITTANCE_OPERATION_ENTRIES, null, { src: '/help-examples/remittances-redacted.png', alt: { es: 'Ejemplo de remesas con identificadores personales ocultos.', en: 'Remittances example with personal identifiers redacted.' } }],
  'dashboard-remittance-types': [{"es": "Tipos de Remesas", "en": "Remittance types"}, [
      {
        id: "remittance-type-pricing",
        question: { es: "¿Quién edita tasas y comisiones de tipos?", en: "Who edits type rates and fees?" },
        answer: {
          es: "En la UI solo super_admin crea tipos y edita tasa, comisión y monedas; admin edita nombre, límites, SLA y activo. La tasa de entrega no puede superar la de mercado. Desactivar afecta cotizaciones nuevas. Cambiar la tasa no recalcula remesas pendientes: el cliente puede recalcular las que siguen en payment_pending o payment_rejected.",
          en: "In the UI only super_admin creates types and edits rates, fees and currencies; admin edits name, limits, SLA and active status. Delivery rate cannot exceed market rate. Deactivation affects new quotes. A rate change does not recalculate pending remittances: the customer can recalculate those still in payment_pending or payment_rejected."
        }
      }
    ], null, { src: '/help-examples/remittance-types.png', alt: { es: 'Listado de tipos de remesas y sus reglas.', en: 'Remittance types and their rules.' } }],
  'dashboard-offers': [{"es": "Ofertas y Cupones", "en": "Offers and coupons"}, [
      {
        id: "offer-window-scope",
        question: { es: "¿Qué exige una oferta o cupón?", en: "What does an offer or coupon require?" },
        answer: {
          es: "Elige Aplica a: product, combo o remittance. El código se normaliza a MAYÚSCULAS; valor de descuento debe ser positivo. Fechas de inicio y fin obligatorias, inicio anterior al fin. Revisa mínimo de compra y máximos global/por usuario. Para remesas solo acepta ofertas remittance; no supongas que elegir product/combo garantiza un filtro de artículos en pedidos.",
          en: "Choose Applies to: product, combo or remittance. The code is normalized to UPPERCASE; discount value must be positive. Start and end dates are required, with start before end. Check minimum purchase and global/per-user caps. Remittances only accept remittance offers; choosing product/combo does not guarantee an item-level filter on orders."
        }
      },
      {
        id: "offer-stacking",
        question: { es: "¿Cómo se acumulan descuentos?", en: "How do discounts stack?" },
        answer: {
          es: "En pedidos se aplica primero el descuento de categoría de usuario y luego la oferta sobre el importe restante. Verifica ventana, mínimo y usos antes de prometer un descuento. Desactivar afecta compras futuras; borrar es definitivo. Los límites de uso son de mejor esfuerzo, no una garantía de exclusión bajo concurrencia.",
          en: "Orders apply the user category discount first, then the offer to the remaining amount. Check window, minimum and usage before promising a discount. Deactivation affects future purchases; deletion is permanent. Usage caps are best effort, not a concurrency exclusion guarantee."
        }
      }
    ], null, [
    { src: '/help-examples/offers-redacted.png', alt: { es: 'Ejemplo de ofertas con códigos promocionales ocultos.', en: 'Offers example with promo codes redacted.' } },
    { src: '/help-examples/coupon-detail-redacted.png', alt: { es: 'Detalle de cupón con el código promocional oculto.', en: 'Coupon details with promo code redacted.' } },
  ]],
  'dashboard-activity-log': [{"es": "Registro de Actividad", "en": "Activity log"}, [
      {
        id: "activity-retention",
        question: { es: "¿Cuánto dura el registro de actividad?", en: "How long is the activity log retained?" },
        answer: {
          es: "La retención configurada es de 90 días, con purga programada diaria de filas más antiguas; no es un archivo permanente. Que el cron esté activo debe verificarse en el entorno. Reset y borrado masivo no borran activity_logs; la política de retención sigue siendo independiente.",
          en: "Configured retention is 90 days, with scheduled daily purging of older rows; this is not a permanent archive. Whether the cron is active must be verified in the environment. Reset and bulk deletion do not erase activity_logs; retention remains an independent policy."
        }
      },
      {
        id: "activity-search-limit",
        question: { es: "¿Por qué solo veo 200 filas?", en: "Why do I only see 200 rows?" },
        answer: {
          es: "La UI es solo super_admin. Los filtros de búsqueda, acción, entidad y fechas se aplican en el servidor; devuelve hasta las 200 filas más recientes que coinciden, en páginas de 20. Acota fechas o acción para localizar eventos anteriores dentro de la retención; el límite no es de 200 filas globales antes de filtrar. Confirma el registro fuente para verificar un pago.",
          en: "The UI is super_admin only. Search, action, entity and date filters run on the server; it returns up to the 200 newest matching rows, in pages of 20. Narrow dates or action to find older events within retention; this is not a global 200-row limit before filtering. Verify a payment against its source record."
        }
      },
      {
        id: "activity-actor-privacy",
        question: { es: "¿Se ocultan todos los correos del registro?", en: "Are all emails in the log hidden?" },
        answer: {
          es: "No. El trigger redacta correos dentro de descripción y metadata, pero performed_by mantiene la identidad de auditoría del actor y no se redacta. Puede mostrar su correo. Comparte solo lo necesario por canales autorizados; no confundas el registro de actividad con un comprobante de pago.",
          en: "No. The trigger redacts emails in description and metadata, but performed_by retains the actor’s audit identity and is not redacted. It may show their email. Share only necessary data through authorized channels; the activity log is not payment proof."
        }
      }
    ], null, { src: '/help-examples/activity-log-redacted.png', alt: { es: 'Ejemplo del registro de actividad con datos personales ocultos.', en: 'Activity log example with personal data redacted.' } }],
  'dashboard-zelle-history': [{ es: 'Historial de Pagos', en: 'Payment history' }, [
    {
      id: 'zelle-history-volume',
      question: { es: '¿Qué suma el Volumen total de Zelle?', en: 'What does Zelle Total volume include?' },
      answer: {
        es: 'Es una vista de solo lectura. Los filtros de búsqueda, estado, tipo y cuenta afectan las tarjetas, expresadas en USD. Volumen total incluye rechazados, además de validados y pendientes: no equivale a dinero validado. El estado se alimenta al validar o rechazar la operación original; aquí no se corrige.',
        en: 'This is a read-only view. Search, status, type and account filters affect the cards, expressed in USD. Total volume includes rejected transactions as well as validated and pending ones: it is not validated money. Status is fed by validating or rejecting the source operation; it is not corrected here.'
      }
    },
    {
      id: 'zelle-history-missing',
      question: { es: '¿Una fila ausente significa que no hubo pago?', en: 'Does a missing row mean there was no payment?' },
      answer: {
        es: 'No. Una fila ausente no prueba impago: la sincronización del historial es de mejor esfuerzo y requiere cuenta Zelle asociada. Consulta el pedido o remesa y el comprobante original para conciliar; no repitas pagos por una ausencia en esta lista.',
        en: 'No. A missing row does not prove non-payment: history synchronization is best effort and requires an associated Zelle account. Reconcile against the order or remittance and original proof; do not repeat payments because this list lacks a row.'
      }
    }
  ], null, { src: '/help-examples/payment-history-redacted.png', alt: { es: 'Ejemplo del historial de pagos con datos personales y de cuenta ocultos.', en: 'Payment history example with personal and account data redacted.' } }],
  'admin-inventory': [{"es": "Administración · Inventario", "en": "Administration · Inventory"}, [
      {
        id: "inventory-product-cost",
        question: { es: "¿Qué reviso al editar un producto?", en: "What should I check when editing a product?" },
        answer: {
          es: "Revisa costo, moneda, margen y existencias disponibles. Disponible = total − reservado; no bajes el total por debajo de lo reservado. Si el costo se mantiene en CUP, el precio base USD depende de la tasa y participa en el reprecio del catálogo. El margen del producto prevalece sobre categoría y global; estos últimos solo prellenan, no reprecian productos existentes.",
          en: "Check cost, currency, margin and available stock. Available = total − reserved; do not lower the total below reserved units. A cost maintained in CUP makes the USD base price rate-dependent and part of catalog repricing. Product margin overrides category and global; the latter only prefill and do not reprice existing products."
        }
      },
      {
        id: "catalog-bulk-delete",
        question: { es: "¿Cómo funciona el borrado masivo?", en: "How does bulk deletion work?" },
        answer: {
          es: "Solo super_admin selecciona y borra productos/categorías en lote. Revisa la vista previa de productos y confirma la palabra indicada por la UI. El resultado es parcial por elemento: uno bloqueado no aborta los demás. Pedidos abiertos o stock reservado bloquean productos; tener productos bloquea categorías. Es borrado físico e irreversible, no ocultar; guarda snapshot en el log de operaciones destructivas y conserva el registro de actividad.",
          en: "Only super_admin selects and bulk-deletes products/categories. Review the product preview and confirm the word shown by the UI. Results are partial per item: one blocked item does not abort the rest. Open orders or reserved stock block products; linked products block categories. Deletion is physical and irreversible, not hiding; it saves a snapshot in the destructive operations log and preserves the activity log."
        }
      }
    ], null, [
    { src: '/help-examples/inventory-list.png', alt: { es: 'Tabla de productos y existencias.', en: 'Products and inventory table.' } },
    { src: '/help-examples/product-details.png', alt: { es: 'Detalle de un producto.', en: 'Product details.' } },
    { src: '/help-examples/product-edit.png', alt: { es: 'Formulario para editar un producto.', en: 'Product edit form.' } },
    { src: '/help-examples/product-create.png', alt: { es: 'Formulario para agregar un producto.', en: 'Product creation form.' } },
  ]],
  'admin-categories': [{"es": "Administración · Categorías", "en": "Administration · Categories"}, [
      {
        id: "category-slug-delete",
        question: { es: "¿Puedo editar el slug o borrar una categoría usada?", en: "Can I edit the slug or delete a used category?" },
        answer: {
          es: "El slug no es editable: se genera desde el nombre ES al crear y editar; renombrar cambia el slug. Los nombres ES y EN son obligatorios. No se puede borrar si tiene productos, activos o inactivos. El borrado es físico; la política de borrado de categorías exige super_admin. El margen sugerido solo prellena productos, no cambia precios existentes.",
          en: "The slug is not editable: it is generated from the ES name on create and edit; renaming changes the slug. ES and EN names are required. Deletion is blocked if any active or inactive products use it. Deletion is physical; the category delete policy requires super_admin. Suggested margin only prefills products; it does not change existing prices."
        }
      }
    ], null, [
    { src: '/help-examples/categories-list.png', alt: { es: 'Listado de categorías.', en: 'Categories list.' } },
    { src: '/help-examples/category-edit.png', alt: { es: 'Formulario para editar una categoría.', en: 'Category edit form.' } },
  ]],
  'admin-combos': [{"es": "Administración · Combos", "en": "Administration · Combos"}, [
      {
        id: "combo-component-stock",
        question: { es: "¿Los combos tienen inventario propio?", en: "Do combos have their own inventory?" },
        answer: {
          es: "Los combos no tienen stock propio: la disponibilidad depende del stock de cada componente y de las cantidades requeridas. El precio base se calcula con costos de componentes × cantidades al editar. No confundas esa composición con el reprecio por tasa USD↔CUP: ese flujo escala los totales de combos por la relación de tasas. Borrar un producto desactiva los combos que lo contienen.",
          en: "Combos have no stock of their own: availability depends on each component’s stock and required quantities. Editing computes base price from component costs × quantities. Do not confuse composition with USD↔CUP rate repricing: that flow scales combo totals by the rate ratio. Deleting a product deactivates combos containing it."
        }
      }
    ], null, [
    { src: '/help-examples/combos-list.png', alt: { es: 'Listado de combos y estado de disponibilidad.', en: 'Bundles list and availability status.' } },
    { src: '/help-examples/combo-edit.png', alt: { es: 'Formulario para editar un combo.', en: 'Bundle edit form.' } },
  ]],
  'admin-management': [{"es": "Administración · Gestión", "en": "Administration · Management"}, [
      {
        id: "testimonial-moderation",
        question: { es: "¿Qué se gestiona en Gestión?", en: "What is managed in Management?" },
        answer: {
          es: "Aquí se moderan testimonios, no ajustes globales: Destacado/Normal y Mostrar/Ocultar. Cada acción se guarda al pulsarla; no hay un Guardar general. Ocultar no borra el testimonio.",
          en: "This tab moderates testimonials, not global settings: Featured/Normal and Show/Hide. Each action saves when clicked; there is no global Save. Hiding does not delete the testimonial."
        }
      }
    ], null],
  'user-management-users': [{"es": "Gestión de Usuarios · Usuarios", "en": "User management · Users"}, USER_ACCESS_ENTRIES, null, { src: '/help-examples/user-management-redacted.png', alt: { es: 'Ejemplo de gestión de usuarios con identificadores personales ocultos.', en: 'User management example with personal identifiers redacted.' } }],
  'user-management-categories': [{"es": "Gestión de Usuarios · Categorías", "en": "User management · Categories"}, 'Revisa reglas, descuentos y criterios de clasificación; comprueba usuarios afectados antes de recalcular en lote. Guarda cambios acotados y confirma el resultado de una muestra antes de ejecutar acciones masivas.', 'Review rules, discounts and classification criteria; check affected users before bulk recalculation. Save scoped changes and verify a sample before bulk actions.'],
  'user-panel-orders': [{"es": "Panel de Usuario · Pedidos", "en": "User panel · Orders"}, ORDER_OPERATION_ENTRIES, null],
  'user-panel-remittances': [{"es": "Panel de Usuario · Remesas", "en": "User panel · Remittances"}, REMITTANCE_OPERATION_ENTRIES, null],
  'user-panel-returns': [{"es": "Panel de Usuario · Devoluciones", "en": "User panel · Refunds"}, [
      {
        id: "refund-trigger",
        question: { es: "¿Cuándo se crea una devolución?", en: "When is a refund request created?" },
        answer: {
          es: "Al cancelar un pedido o remesa, se crea una solicitud solo si antes había pago validado o comprobante subido. Sin pago ni comprobante no se crea solicitud. Con comprobante sin validar, usa Verificar recepción: confirma en la cuenta Zelle que llegó el dinero; si nunca llegó, marca No procede con motivo. Reabrir la operación cierra su solicitud pendiente como No procede/Reabierto.",
          en: "Cancelling an order or remittance creates a request only if payment was validated or proof was uploaded beforehand. With no payment or proof, no request is created. For unvalidated proof, use Verify receipt: check the Zelle account for the money; if it never arrived, mark Not applicable with a reason. Reopening the operation closes its pending request as Not applicable/Reopened."
        }
      },
      {
        id: "refund-window",
        question: { es: "¿Cuánto debo esperar para reembolsar?", en: "How long must I wait to refund?" },
        answer: {
          es: "Espera 48 h reales desde la cancelación; no puedes marcar reembolsado antes. Después vence al final del quinto día: 5 días hábiles, lunes a viernes en America/New_York, sin descontar festivos. Filtra En espera, Por devolver o Vencidas y atiende por urgencia. El monto pendiente solo suma USD; no mezcla otras monedas.",
          en: "Wait 48 h of elapsed time after cancellation; marking refunded is blocked before then. The deadline is the end of the fifth day: 5 business days, Monday–Friday in America/New_York, without a holiday calendar. Filter On hold, To refund or Overdue and work by urgency. The pending amount totals USD only; other currencies are not mixed."
        }
      },
      {
        id: "refund-manual-proof",
        question: { es: "¿Cómo marco un reembolso manual por Zelle?", en: "How do I record a manual Zelle refund?" },
        answer: {
          es: "El reembolso se hace manualmente por Zelle fuera de la app; Copiar datos ayuda a conciliar la operación. Confirma la recepción del pago original en la cuenta indicada. Tras enviar el reembolso, registra referencia (1–200 caracteres), fecha entre el fin de las 48 h y hoy (no posterior al momento actual) y comprobante obligatorio JPG/PNG/WebP/PDF de hasta 5 MB. Marcar reembolsado registra el envío, no mueve dinero. No procede requiere motivo de 1–500 caracteres.",
          en: "The refund is sent manually through Zelle outside the app; Copy details helps reconcile the operation. Confirm receipt of the original payment in the indicated account. After sending the refund, record a reference (1–200 characters), a date between the end of the 48 h wait and now, and mandatory proof in JPG/PNG/WebP/PDF up to 5 MB. Mark refunded records the transfer; it does not move money. Not applicable requires a 1–500 character reason."
        }
      },
      {
        id: "refund-own-operation",
        question: { es: "¿Puedo resolver mi propia devolución?", en: "Can I resolve my own refund?" },
        answer: {
          es: "Un admin no puede resolver una devolución de su propia operación: debe hacerlo otro administrador. Excepción: super_admin puede resolver la propia con confirmación explícita adicional; queda auditada. No permite abrir ni cerrar una disputa propia.",
          en: "An admin cannot resolve a refund for their own operation: another administrator must do it. Exception: super_admin can resolve their own refund with additional explicit confirmation; it is audited. It does not allow opening or closing their own dispute."
        }
      },
      {
        id: "refund-disputes-purge",
        question: { es: "¿Qué pasa con disputas y comprobantes vencidos?", en: "What happens to disputes and expired proofs?" },
        answer: {
          es: "El comprobante vence un año después del reembolso. Una disputa abierta impide la purga. Si el mantenimiento está disponible, un administrador previsualiza el conteo y confirma Purgar comprobantes vencidos: el borrado es definitivo y por lotes; si cambió el conteo, necesita nueva confirmación. No confundas vencimiento con borrado ya ejecutado.",
          en: "Proof expires one year after the refund. An open dispute blocks the purge. When maintenance is available, an administrator previews the count and confirms Purge expired proofs: deletion is permanent and batched; a changed count requires a fresh confirmation. Expiry does not mean deletion has already run."
        }
      }
    ], null]
};

function buildAdminContextGuides() {
  return Object.entries(ADMIN_CONTEXT_GUIDES).map(([id, [title, es, en, visualExample]]) => {
    // Focused guides reuse the same entry shape as the base sections.
    const entries = Array.isArray(es) ? es : [{
      id,
      question: { es: `¿Cómo trabajar en ${title.es}?`, en: `How do I work in ${title.en}?` },
      answer: { es, en }
    }];
    return {
      id: `context-${id}`, roles: ['super_admin'], title,
      entries: entries.map((entry, index) => index === 0 && visualExample ? {
        ...entry,
        visualExamples: Array.isArray(visualExample) ? visualExample : [visualExample]
      } : entry)
    };
  });
}

export function getHelpSectionForPage(page, tab, detailTab) {
  if (page === 'settings' && tab === 'mensajeria' && ['couriers', 'types', 'payable', 'reports'].includes(detailTab)) {
    return `context-settings-mensajeria-${detailTab}`;
  }
  if (page === 'settings' && tab === 'zelle' && ['zelle', 'bizum', 'iban'].includes(detailTab)) {
    return `context-settings-zelle-${detailTab}`;
  }
  const pageKey = { settings: 'settings', dashboard: 'dashboard', admin: 'admin', 'user-management': 'user-management', 'user-panel': 'user-panel' }[page];
  // The queue tab is `refunds`; preserve the existing returns guide id for links.
  const guideTab = page === 'user-panel' && tab === 'refunds' ? 'returns' : tab;
  const contextual = guideTab ? `context-${pageKey}-${guideTab}` : null;
  return contextual || ({ settings: 'admin-settings', dashboard: 'admin-dashboard', admin: 'catalog', 'user-management': 'admin-users', 'user-panel': 'admin-user-panel' }[page] || null);
}
