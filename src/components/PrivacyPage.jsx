import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getHeadingStyle } from '@/lib/styleUtils';

const LAST_UPDATED = '2026-04-20';
const CONTACT_EMAIL = 'soporte@papuenvios.com';

const Section = ({ title, children }) => (
  <div className="mb-8">
    <h2 className="text-xl font-semibold text-gray-800 mb-3">{title}</h2>
    <div className="text-gray-600 space-y-2 leading-relaxed">{children}</div>
  </div>
);

const PrivacyPage = ({ onNavigate }) => {
  const { language } = useLanguage();
  const es = language === 'es';

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex justify-center mb-4">
              <Shield className="w-12 h-12 text-blue-500" />
            </div>
            <h1 className={`${getHeadingStyle()} text-4xl mb-3`}>
              {es ? 'Política de Privacidad' : 'Privacy Policy'}
            </h1>
            <p className="text-sm text-gray-500">
              {es ? `Última actualización: ${LAST_UPDATED}` : `Last updated: ${LAST_UPDATED}`}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            {es ? (
              <>
                <Section title="1. Responsable del tratamiento">
                  <p>
                    PapuEnvios opera la plataforma de envío de remesas y productos accesible en{' '}
                    <strong>www.papuenvios.com</strong>. Para cualquier consulta sobre el tratamiento de
                    sus datos personales puede contactarnos en{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>
                    .
                  </p>
                </Section>

                <Section title="2. Datos que recopilamos">
                  <p>Recopilamos los siguientes datos cuando utiliza nuestro servicio:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li><strong>Datos de cuenta:</strong> nombre, dirección de correo electrónico.</li>
                    <li><strong>Datos de destinatario:</strong> nombre completo, municipio, datos bancarios en Cuba (almacenados cifrados).</li>
                    <li><strong>Datos de transacción:</strong> montos enviados, fechas, estado de las remesas y órdenes.</li>
                    <li><strong>Comprobantes de pago:</strong> imágenes subidas para validación de pagos Zelle.</li>
                    <li><strong>Datos técnicos:</strong> dirección IP, tipo de navegador, páginas visitadas (para análisis internos).</li>
                  </ul>
                </Section>

                <Section title="3. Finalidad del tratamiento">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Procesar y gestionar sus envíos de remesas y órdenes de productos.</li>
                    <li>Verificar pagos y prevenir fraudes.</li>
                    <li>Enviar notificaciones sobre el estado de sus envíos (WhatsApp, correo electrónico).</li>
                    <li>Cumplir con obligaciones legales y regulatorias aplicables.</li>
                    <li>Mejorar la plataforma mediante análisis de uso agregado.</li>
                  </ul>
                </Section>

                <Section title="4. Base legal">
                  <p>
                    El tratamiento de sus datos se basa en (a) la ejecución del contrato de servicio
                    que acepta al registrarse, (b) el cumplimiento de obligaciones legales y
                    (c) nuestro interés legítimo en prevenir fraudes y mejorar el servicio.
                  </p>
                </Section>

                <Section title="5. Compartir datos con terceros">
                  <p>No vendemos sus datos personales. Podemos compartirlos únicamente con:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li><strong>Supabase:</strong> proveedor de infraestructura y base de datos (alojado en Sao Paulo, Brasil).</li>
                    <li><strong>Resend:</strong> proveedor de envío de correos electrónicos transaccionales.</li>
                    <li><strong>Vercel:</strong> proveedor de alojamiento del sitio web.</li>
                    <li><strong>Autoridades regulatorias:</strong> cuando sea requerido por ley.</li>
                  </ul>
                </Section>

                <Section title="6. Transferencias internacionales">
                  <p>
                    Sus datos pueden ser procesados en servidores ubicados en Brasil (Supabase) y
                    Estados Unidos (Vercel, Resend). Estos proveedores cuentan con medidas de
                    seguridad adecuadas para la protección de datos personales.
                  </p>
                </Section>

                <Section title="7. Retención de datos">
                  <p>
                    Conservamos sus datos mientras su cuenta esté activa. Los registros de
                    transacciones se conservan por un mínimo de 5 años para cumplir con
                    obligaciones legales. Puede solicitar la eliminación de su cuenta escribiendo
                    a{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>
                    .
                  </p>
                </Section>

                <Section title="8. Sus derechos">
                  <p>
                    Dependiendo de su lugar de residencia, puede tener derecho a acceder,
                    rectificar, eliminar o portar sus datos, así como a oponerse a ciertos
                    tratamientos. Para ejercer estos derechos, contáctenos en{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>
                    . Residentes de California (EE.UU.) tienen derechos adicionales bajo la CCPA.
                  </p>
                </Section>

                <Section title="9. Seguridad">
                  <p>
                    Aplicamos medidas técnicas y organizativas para proteger sus datos, incluyendo
                    cifrado AES-256 de datos bancarios sensibles, control de acceso por roles y
                    políticas de seguridad a nivel de base de datos. Ningún sistema es 100% seguro;
                    en caso de brecha, le notificaremos según lo requiera la ley aplicable.
                  </p>
                </Section>

                <Section title="10. Contacto">
                  <p>
                    Para cualquier consulta sobre esta política, escríbanos a{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>
                    .
                  </p>
                </Section>
              </>
            ) : (
              <>
                <Section title="1. Data Controller">
                  <p>
                    PapuEnvios operates the remittance and product delivery platform at{' '}
                    <strong>www.papuenvios.com</strong>. For any questions about your personal data,
                    contact us at{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>
                    .
                  </p>
                </Section>

                <Section title="2. Data We Collect">
                  <p>We collect the following data when you use our service:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li><strong>Account data:</strong> name, email address.</li>
                    <li><strong>Recipient data:</strong> full name, municipality, Cuban bank account details (stored encrypted).</li>
                    <li><strong>Transaction data:</strong> amounts sent, dates, remittance and order status.</li>
                    <li><strong>Payment proofs:</strong> images uploaded for Zelle payment verification.</li>
                    <li><strong>Technical data:</strong> IP address, browser type, pages visited (for internal analytics).</li>
                  </ul>
                </Section>

                <Section title="3. Purpose of Processing">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Processing and managing your remittances and product orders.</li>
                    <li>Verifying payments and preventing fraud.</li>
                    <li>Sending notifications about your delivery status (WhatsApp, email).</li>
                    <li>Complying with applicable legal and regulatory obligations.</li>
                    <li>Improving the platform through aggregated usage analytics.</li>
                  </ul>
                </Section>

                <Section title="4. Legal Basis">
                  <p>
                    Processing is based on (a) performance of the service contract you accept upon
                    registration, (b) compliance with legal obligations, and (c) our legitimate
                    interest in fraud prevention and service improvement.
                  </p>
                </Section>

                <Section title="5. Sharing Data with Third Parties">
                  <p>We do not sell your personal data. We may share it only with:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li><strong>Supabase:</strong> infrastructure and database provider (hosted in São Paulo, Brazil).</li>
                    <li><strong>Resend:</strong> transactional email provider.</li>
                    <li><strong>Vercel:</strong> website hosting provider.</li>
                    <li><strong>Regulatory authorities:</strong> when required by law.</li>
                  </ul>
                </Section>

                <Section title="6. International Transfers">
                  <p>
                    Your data may be processed on servers in Brazil (Supabase) and the United States
                    (Vercel, Resend). These providers have adequate safeguards in place.
                  </p>
                </Section>

                <Section title="7. Data Retention">
                  <p>
                    We retain your data while your account is active. Transaction records are kept
                    for a minimum of 5 years for legal compliance. You may request account deletion
                    by writing to{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>
                    .
                  </p>
                </Section>

                <Section title="8. Your Rights">
                  <p>
                    Depending on your location, you may have the right to access, rectify, delete,
                    or port your data, and to object to certain processing. To exercise these rights,
                    contact us at{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>
                    . California residents have additional rights under the CCPA.
                  </p>
                </Section>

                <Section title="9. Security">
                  <p>
                    We apply technical and organizational measures to protect your data, including
                    AES-256 encryption of sensitive bank data, role-based access control, and
                    database-level security policies. No system is 100% secure; in the event of a
                    breach, we will notify you as required by applicable law.
                  </p>
                </Section>

                <Section title="10. Contact">
                  <p>
                    For any questions about this policy, write to{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>
                    .
                  </p>
                </Section>
              </>
            )}
          </div>

          {/* Back link */}
          <div className="text-center mt-8">
            <button
              onClick={() => onNavigate('home')}
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {es ? '← Volver al inicio' : '← Back to home'}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default PrivacyPage;
