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
  }
];

export function getHelpSectionsForRole(userRole) {
  if (userRole !== 'admin' && userRole !== 'super_admin') return [];
  return HELP_SECTIONS.filter(section => section.roles.includes(userRole));
}
