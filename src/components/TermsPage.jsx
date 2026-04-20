import { motion } from 'framer-motion';
import { FileText } from 'lucide-react';
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

const TermsPage = ({ onNavigate }) => {
  const { language } = useLanguage();
  const es = language === 'es';

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex justify-center mb-4">
              <FileText className="w-12 h-12 text-blue-500" />
            </div>
            <h1 className={`${getHeadingStyle()} text-4xl mb-3`}>
              {es ? 'Términos de Servicio' : 'Terms of Service'}
            </h1>
            <p className="text-sm text-gray-500">
              {es ? `Última actualización: ${LAST_UPDATED}` : `Last updated: ${LAST_UPDATED}`}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            {es ? (
              <>
                <Section title="1. Aceptación de los términos">
                  <p>
                    Al acceder o utilizar PapuEnvios (<strong>www.papuenvios.com</strong>), usted
                    acepta quedar vinculado por estos Términos de Servicio. Si no está de acuerdo,
                    no utilice el servicio.
                  </p>
                </Section>

                <Section title="2. Descripción del servicio">
                  <p>
                    PapuEnvios es una plataforma que permite a personas en el exterior —
                    principalmente en Estados Unidos — enviar remesas en efectivo y realizar compras
                    de productos para entrega a destinatarios en Cuba.
                  </p>
                </Section>

                <Section title="3. Elegibilidad">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Debe tener al menos 18 años de edad.</li>
                    <li>Debe ser residente legal en el país desde el que realiza el envío.</li>
                    <li>No debe estar en ninguna lista de sanciones de OFAC u organismos equivalentes.</li>
                    <li>Acepta proporcionar información veraz y actualizada.</li>
                  </ul>
                </Section>

                <Section title="4. Proceso de pago y verificación">
                  <p>
                    Los pagos se realizan a través de Zelle. Una vez que cargue su comprobante de
                    pago, nuestro equipo lo verificará manualmente. La validación puede tardar hasta
                    24 horas hábiles. PapuEnvios se reserva el derecho de rechazar pagos si el
                    comprobante no es verificable o si existe sospecha de fraude.
                  </p>
                  <p className="mt-2 font-medium text-amber-700">
                    ⚠ Los pagos Zelle son irreversibles. Asegúrese de revisar todos los datos antes
                    de confirmar su transacción.
                  </p>
                </Section>

                <Section title="5. Tasas de cambio y comisiones">
                  <p>
                    Las tasas de cambio y comisiones se muestran claramente antes de confirmar cada
                    transacción. PapuEnvios se reserva el derecho de actualizar las tasas en
                    cualquier momento. La tasa aplicada será la vigente en el momento en que su pago
                    sea validado.
                  </p>
                </Section>

                <Section title="6. Restricciones de uso">
                  <p>Queda prohibido utilizar PapuEnvios para:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li>Actividades ilegales o que violen regulaciones de sanciones internacionales.</li>
                    <li>Enviar fondos a personas o entidades en listas de sanciones.</li>
                    <li>Cargar comprobantes de pago falsos o alterados.</li>
                    <li>Abusar del sistema de ofertas o descuentos.</li>
                    <li>Intentar acceder sin autorización a sistemas o datos de otros usuarios.</li>
                  </ul>
                </Section>

                <Section title="7. Regulación OFAC y cumplimiento">
                  <p>
                    Las remesas a Cuba están sujetas a las regulaciones de la Oficina de Control de
                    Activos Extranjeros (OFAC) de EE.UU., incluyendo las Cuban Assets Control
                    Regulations (31 CFR Part 515). El usuario es responsable de asegurarse de que
                    sus transacciones cumplan con todas las leyes aplicables, incluyendo los límites
                    vigentes de envío autorizados por OFAC.
                  </p>
                </Section>

                <Section title="8. Limitación de responsabilidad">
                  <p>
                    PapuEnvios no será responsable por retrasos causados por circunstancias fuera
                    de nuestro control (interrupciones bancarias, situaciones en Cuba, eventos de
                    fuerza mayor). Nuestra responsabilidad máxima se limita al monto de la
                    transacción específica en disputa.
                  </p>
                </Section>

                <Section title="9. Cancelaciones y reembolsos">
                  <p>
                    Una vez validado el pago, la transacción no puede cancelarse si ya fue procesada.
                    En caso de error por parte de PapuEnvios, gestionaremos el reembolso o reenvío
                    correspondiente. Contáctenos a{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>{' '}
                    dentro de las 48 horas siguientes a la transacción.
                  </p>
                </Section>

                <Section title="10. Modificaciones">
                  <p>
                    Nos reservamos el derecho de modificar estos términos en cualquier momento.
                    Los cambios serán notificados por correo electrónico con al menos 7 días de
                    anticipación. El uso continuado del servicio después de los cambios constituye
                    aceptación de los nuevos términos.
                  </p>
                </Section>

                <Section title="11. Ley aplicable">
                  <p>
                    Estos términos se rigen por las leyes aplicables en el estado de Florida,
                    EE.UU., sin perjuicio de las regulaciones federales de OFAC y FinCEN que
                    también aplican a las transacciones.
                  </p>
                </Section>

                <Section title="12. Contacto">
                  <p>
                    Para consultas sobre estos términos:{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>
                  </p>
                </Section>
              </>
            ) : (
              <>
                <Section title="1. Acceptance of Terms">
                  <p>
                    By accessing or using PapuEnvios (<strong>www.papuenvios.com</strong>), you
                    agree to be bound by these Terms of Service. If you disagree, do not use the
                    service.
                  </p>
                </Section>

                <Section title="2. Service Description">
                  <p>
                    PapuEnvios is a platform that enables people abroad — primarily in the United
                    States — to send cash remittances and purchase products for delivery to
                    recipients in Cuba.
                  </p>
                </Section>

                <Section title="3. Eligibility">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>You must be at least 18 years old.</li>
                    <li>You must be a legal resident in the country from which you send.</li>
                    <li>You must not appear on any OFAC sanctions list or equivalent.</li>
                    <li>You agree to provide truthful and up-to-date information.</li>
                  </ul>
                </Section>

                <Section title="4. Payment and Verification Process">
                  <p>
                    Payments are made via Zelle. Once you upload your payment proof, our team
                    will manually verify it. Verification may take up to 24 business hours.
                    PapuEnvios reserves the right to reject payments if the proof cannot be
                    verified or if fraud is suspected.
                  </p>
                  <p className="mt-2 font-medium text-amber-700">
                    ⚠ Zelle payments are irreversible. Review all details before confirming your
                    transaction.
                  </p>
                </Section>

                <Section title="5. Exchange Rates and Fees">
                  <p>
                    Exchange rates and fees are clearly displayed before confirming each
                    transaction. PapuEnvios reserves the right to update rates at any time. The
                    rate applied will be the one in effect when your payment is validated.
                  </p>
                </Section>

                <Section title="6. Prohibited Uses">
                  <p>You may not use PapuEnvios for:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li>Illegal activities or violations of international sanctions regulations.</li>
                    <li>Sending funds to sanctioned persons or entities.</li>
                    <li>Uploading false or altered payment proofs.</li>
                    <li>Abusing offers or discount systems.</li>
                    <li>Attempting unauthorized access to systems or other users' data.</li>
                  </ul>
                </Section>

                <Section title="7. OFAC Compliance">
                  <p>
                    Remittances to Cuba are subject to U.S. OFAC regulations, including the Cuban
                    Assets Control Regulations (31 CFR Part 515). Users are responsible for
                    ensuring their transactions comply with all applicable laws, including current
                    OFAC-authorized sending limits.
                  </p>
                </Section>

                <Section title="8. Limitation of Liability">
                  <p>
                    PapuEnvios is not liable for delays caused by circumstances beyond our control
                    (banking outages, situations in Cuba, force majeure). Our maximum liability is
                    limited to the amount of the specific transaction in dispute.
                  </p>
                </Section>

                <Section title="9. Cancellations and Refunds">
                  <p>
                    Once a payment is validated, the transaction cannot be cancelled if already
                    processed. In case of error on PapuEnvios's part, we will arrange a refund or
                    resend. Contact us at{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>{' '}
                    within 48 hours of the transaction.
                  </p>
                </Section>

                <Section title="10. Modifications">
                  <p>
                    We reserve the right to modify these terms at any time. Changes will be
                    notified by email with at least 7 days' notice. Continued use of the service
                    after changes constitutes acceptance of the new terms.
                  </p>
                </Section>

                <Section title="11. Governing Law">
                  <p>
                    These terms are governed by the laws of the State of Florida, U.S.A., without
                    prejudice to applicable federal OFAC and FinCEN regulations.
                  </p>
                </Section>

                <Section title="12. Contact">
                  <p>
                    For questions about these terms:{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
                      {CONTACT_EMAIL}
                    </a>
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

export default TermsPage;
