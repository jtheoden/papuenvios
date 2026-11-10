import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getHeadingStyle } from '@/lib/styleUtils';
import { LEGAL_LAST_UPDATED, ACTIVITY_LOGS_RETENTION_DAYS } from '@/lib/legalConfig';
import LegalContact from '@/components/LegalContact';
import { useAnchorScroll } from '@/hooks/useAnchorScroll';

const Section = ({ title, children }) => (
  <div className="mb-8">
    <h2 className="text-xl font-semibold text-gray-800 mb-3">{title}</h2>
    <div className="text-gray-600 space-y-2 leading-relaxed">{children}</div>
  </div>
);

const PrivacyPage = ({ onNavigate }) => {
  useAnchorScroll();
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
              {es ? `Última actualización: ${LEGAL_LAST_UPDATED}` : `Last updated: ${LEGAL_LAST_UPDATED}`}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            {es ? (
              <>
                <Section title="1. Responsable del tratamiento">
                  <p>
                    PapuEnvios opera la plataforma de envío de remesas y productos accesible en{' '}
                    <strong>www.papuenvios.com</strong>. Para cualquier consulta sobre el tratamiento
                    de sus datos personales, utilice <LegalContact es />.
                  </p>
                </Section>

                <Section title="2. Datos que recopilamos">
                  <p>Recopilamos los siguientes datos cuando utiliza nuestro servicio:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li><strong>Datos de cuenta:</strong> nombre, correo electrónico y foto de perfil que Google nos proporciona al iniciar sesión.</li>
                    <li><strong>Datos del pagador:</strong> nombre de quien realiza el pago y teléfono de contacto, informados al registrar el pago.</li>
                    <li><strong>Datos de destinatario:</strong> nombre, datos de contacto, dirección de entrega en Cuba y datos bancarios (estos últimos almacenados cifrados).</li>
                    <li><strong>Datos de transacción:</strong> montos, fechas, estado de las remesas y órdenes, y los productos adquiridos.</li>
                    <li><strong>Comprobantes:</strong> imágenes de comprobantes de pago Zelle y de evidencia de entrega, almacenadas en Supabase Storage.</li>
                    <li>
                      <strong>Registro de visitas (solo si usted acepta la analítica):</strong> solo si
                      usted acepta la analítica en el aviso de cookies, por cada página que visita
                      guardamos la ruta de la página (page_url), la página de origen (referrer), el
                      navegador (user_agent), un identificador de sesión (session_id) y, si inició
                      sesión, su identificador de usuario (user_id). El identificador de sesión se
                      conserva en el almacenamiento local de su navegador. Si no acepta, o si
                      retira su consentimiento, no se registra ninguna visita ni se crea ese
                      identificador. Su navegador puede enviar la señal Global Privacy Control; la
                      tratamos como un rechazo de la analítica, salvo que usted acepte
                      expresamente desde «Preferencias de cookies». Su decisión se guarda en su
                      navegador (clave papuenvios_consent). Puede cambiarla en cualquier momento
                      con el enlace «Preferencias de cookies» en las páginas con pie de página.
                      Retirar el consentimiento no borra las visitas ya almacenadas.
                    </li>
                  </ul>
                </Section>

                <Section title="3. Finalidad del tratamiento">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Procesar y gestionar sus envíos de remesas y órdenes de productos.</li>
                    <li>Verificar pagos y prevenir fraudes.</li>
                    <li>Comunicarnos con usted sobre el estado de sus envíos por correo electrónico y mediante enlaces de WhatsApp iniciados manualmente (ver sección 5).</li>
                    <li>Cumplir con obligaciones legales y regulatorias aplicables.</li>
                    <li>Entender el uso de la plataforma y mejorarla a partir del registro de visitas descrito arriba.</li>
                  </ul>
                </Section>

                <Section title="4. Base legal">
                  <p>
                    El tratamiento de sus datos se basa en (a) la ejecución del servicio que usted
                    solicita, (b) el cumplimiento de obligaciones legales y (c) nuestro interés
                    legítimo en prevenir fraudes y mejorar el servicio. El registro de visitas
                    (analítica) se realiza únicamente con su consentimiento previo.
                  </p>
                </Section>

                <Section title="5. Terceros y servicios externos">
                  <p>No vendemos sus datos personales. Utilizamos los siguientes proveedores y servicios:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li><strong>Google:</strong> el inicio de sesión se realiza con Google (OAuth, a través de Supabase Auth); Google nos facilita su nombre, correo y foto de perfil.</li>
                    <li><strong>Tipografía:</strong> la tipografía del sitio es servida desde nuestro sitio, por lo que su navegador no realiza solicitudes a terceros para cargarla.</li>
                    <li><strong>api.exchangerate-api.com:</strong> su navegador consulta este servicio para obtener tasas de cambio oficiales de referencia.</li>
                    <li><strong>Supabase:</strong> infraestructura, autenticación, base de datos y almacenamiento de archivos (región São Paulo, Brasil).</li>
                    <li><strong>Resend:</strong> envío de correos electrónicos transaccionales.</li>
                    <li><strong>Vercel:</strong> alojamiento del sitio web.</li>
                    <li>
                      <strong>WhatsApp:</strong> PapuEnvios no utiliza la API de WhatsApp Business ni
                      envía mensajes automáticos o de marketing por WhatsApp. Solo usamos enlaces
                      wa.me que abren una conversación con un mensaje prellenado, que se envía
                      únicamente cuando la persona usuaria u operadora lo decide. Los mensajes
                      enviados quedan sujetos a las condiciones de WhatsApp.
                    </li>
                    <li><strong>Autoridades regulatorias:</strong> cuando sea requerido por ley.</li>
                  </ul>
                  <p>
                    Al atender solicitudes desde su navegador, estos proveedores reciben
                    necesariamente su dirección IP.
                  </p>
                </Section>

                <Section title="6. Transferencias internacionales">
                  <p>
                    Sus datos pueden ser procesados en servidores ubicados en Brasil (Supabase) y
                    Estados Unidos u otros países donde operen los proveedores listados arriba.
                  </p>
                </Section>

                <Section title="7. Retención de datos">
                  <p>
                    Conservamos sus datos mientras su cuenta esté activa o sea necesario para
                    prestar el servicio y cumplir obligaciones legales. Los registros de actividad
                    técnica (activity_logs) se eliminan automáticamente a los{' '}
                    {ACTIVITY_LOGS_RETENTION_DAYS} días. El registro de visitas (site_visits)
                    actualmente no tiene un plazo de eliminación automático. Puede solicitar la
                    eliminación de su cuenta a través de <LegalContact es />.
                  </p>
                </Section>

                <Section title="8. Sus derechos">
                  <p>
                    Dependiendo de su lugar de residencia, puede tener derecho a acceder,
                    rectificar, eliminar o portar sus datos, así como a oponerse a ciertos
                    tratamientos. Para ejercer estos derechos, utilice <LegalContact es />.
                    Residentes de California (EE.UU.) pueden tener derechos adicionales bajo la
                    CCPA, en la medida en que esta ley sea aplicable.
                  </p>
                </Section>

                <Section title="9. Seguridad">
                  <p>
                    Aplicamos medidas técnicas y organizativas para proteger sus datos, incluyendo
                    cifrado AES-256-GCM de los datos bancarios de destinatarios, control de acceso
                    por roles y políticas de seguridad a nivel de base de datos. Ningún sistema es
                    100% seguro; en caso de brecha, le notificaremos según lo requiera la ley
                    aplicable.
                  </p>
                </Section>

                <Section title="10. Contacto">
                  <p>
                    Para cualquier consulta sobre esta política, utilice <LegalContact es />.
                  </p>
                </Section>
              </>
            ) : (
              <>
                <Section title="1. Data Controller">
                  <p>
                    PapuEnvios operates the remittance and product delivery platform at{' '}
                    <strong>www.papuenvios.com</strong>. For any questions about your personal
                    data, use <LegalContact es={false} />.
                  </p>
                </Section>

                <Section title="2. Data We Collect">
                  <p>We collect the following data when you use our service:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li><strong>Account data:</strong> name, email address and profile picture that Google provides to us when you sign in.</li>
                    <li><strong>Payer data:</strong> the name of the person making the payment and a contact phone number, provided when you register the payment.</li>
                    <li><strong>Recipient data:</strong> name, contact details, delivery address in Cuba and bank account details (the latter stored encrypted).</li>
                    <li><strong>Transaction data:</strong> amounts, dates, remittance and order status, and purchased products.</li>
                    <li><strong>Proofs:</strong> images of Zelle payment proofs and delivery evidence, stored in Supabase Storage.</li>
                    <li>
                      <strong>Visit log (only if you accept analytics):</strong> only if you accept
                      analytics in the cookie notice, for each page you visit we store the page
                      path (page_url), the referring page (referrer), your browser (user_agent), a
                      session identifier (session_id) and, if you are signed in, your user
                      identifier (user_id). The session identifier is kept in your browser's local
                      storage. If you do not accept, or if you withdraw your consent, no visit is
                      logged and that identifier is not created. Your browser may send the Global
                      Privacy Control signal; we treat it as a rejection of analytics, unless you
                      expressly accept from "Cookie preferences". Your decision is stored in your
                      browser (key papuenvios_consent). You can change it at any time with the
                      "Cookie preferences" link on pages with a footer. Withdrawing consent
                      does not delete visits already stored.
                    </li>
                  </ul>
                </Section>

                <Section title="3. Purpose of Processing">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Processing and managing your remittances and product orders.</li>
                    <li>Verifying payments and preventing fraud.</li>
                    <li>Communicating with you about your delivery status by email and through manually initiated WhatsApp links (see section 5).</li>
                    <li>Complying with applicable legal and regulatory obligations.</li>
                    <li>Understanding platform usage and improving it based on the visit log described above.</li>
                  </ul>
                </Section>

                <Section title="4. Legal Basis">
                  <p>
                    Processing is based on (a) performance of the service you request, (b)
                    compliance with legal obligations, and (c) our legitimate interest in fraud
                    prevention and service improvement. The visit log (analytics) is only
                    performed with your prior consent.
                  </p>
                </Section>

                <Section title="5. Third Parties and External Services">
                  <p>We do not sell your personal data. We use the following providers and services:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li><strong>Google:</strong> sign-in is done with Google (OAuth, through Supabase Auth); Google provides us with your name, email and profile picture.</li>
                    <li><strong>Typography:</strong> the site's typography is served from our own site, so your browser makes no third-party requests to load it.</li>
                    <li><strong>api.exchangerate-api.com:</strong> your browser queries this service to obtain official reference exchange rates.</li>
                    <li><strong>Supabase:</strong> infrastructure, authentication, database and file storage (São Paulo, Brazil region).</li>
                    <li><strong>Resend:</strong> transactional email delivery.</li>
                    <li><strong>Vercel:</strong> website hosting.</li>
                    <li>
                      <strong>WhatsApp:</strong> PapuEnvios does not use the WhatsApp Business API
                      and does not send automated or marketing messages through WhatsApp. We only
                      use wa.me links that open a conversation with a pre-filled message, which is
                      sent only when the user or operator decides to send it. Messages sent are
                      subject to WhatsApp's terms.
                    </li>
                    <li><strong>Regulatory authorities:</strong> when required by law.</li>
                  </ul>
                  <p>
                    When serving requests from your browser, these providers necessarily receive
                    your IP address.
                  </p>
                </Section>

                <Section title="6. International Transfers">
                  <p>
                    Your data may be processed on servers in Brazil (Supabase) and in the United
                    States or other countries where the providers listed above operate.
                  </p>
                </Section>

                <Section title="7. Data Retention">
                  <p>
                    We retain your data while your account is active or as needed to provide the
                    service and comply with legal obligations. Technical activity logs
                    (activity_logs) are deleted automatically after {ACTIVITY_LOGS_RETENTION_DAYS}{' '}
                    days. The visit log (site_visits) currently has no automatic deletion period.
                    You may request account deletion through <LegalContact es={false} />.
                  </p>
                </Section>

                <Section title="8. Your Rights">
                  <p>
                    Depending on your location, you may have the right to access, rectify, delete,
                    or port your data, and to object to certain processing. To exercise these
                    rights, use <LegalContact es={false} />. California residents may have
                    additional rights under the CCPA, to the extent that law applies.
                  </p>
                </Section>

                <Section title="9. Security">
                  <p>
                    We apply technical and organizational measures to protect your data, including
                    AES-256-GCM encryption of recipients' bank details, role-based access control,
                    and database-level security policies. No system is 100% secure; in the event of
                    a breach, we will notify you as required by applicable law.
                  </p>
                </Section>

                <Section title="10. Contact">
                  <p>
                    For any questions about this policy, use <LegalContact es={false} />.
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
