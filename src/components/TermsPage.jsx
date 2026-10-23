import { motion } from 'framer-motion';
import { FileText } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getHeadingStyle } from '@/lib/styleUtils';
import {
  LEGAL_LAST_UPDATED,
  CLAIM_WINDOW_HOURS,
  REFUND_BUSINESS_DAYS,
  PAYMENT_VERIFICATION_BUSINESS_HOURS,
  TERMS_CHANGE_NOTICE_DAYS,
} from '@/lib/legalConfig';
import LegalContact from '@/components/LegalContact';
import { useAnchorScroll } from '@/hooks/useAnchorScroll';

const Section = ({ id, title, children }) => (
  <section id={id} className="mb-8 scroll-mt-24" aria-labelledby={id ? `${id}-title` : undefined}>
    <h2 id={id ? `${id}-title` : undefined} className="text-xl font-semibold text-gray-800 mb-3">
      {title}
    </h2>
    <div className="text-gray-600 space-y-2 leading-relaxed">{children}</div>
  </section>
);

const TermsPage = ({ onNavigate }) => {
  const { language } = useLanguage();
  const es = language === 'es';

  // Deep links such as /terms#refunds scroll to the section; otherwise start at the top.
  useAnchorScroll();

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
              {es ? `Última actualización: ${LEGAL_LAST_UPDATED}` : `Last updated: ${LEGAL_LAST_UPDATED}`}
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

                <Section title="2. Descripción del servicio y límites">
                  <p>
                    PapuEnvios es una plataforma que permite a personas en el exterior —
                    principalmente en Estados Unidos — enviar remesas y realizar compras de
                    productos para entrega a destinatarios en Cuba.
                  </p>
                  <p>
                    PapuEnvios no es un banco ni una institución financiera: no ofrece cuentas,
                    depósitos ni créditos. Los pagos se realizan por Zelle y se
                    verifican manualmente.
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
                    pago, nuestro equipo lo verificará manualmente. La validación puede tardar hasta{' '}
                    {PAYMENT_VERIFICATION_BUSINESS_HOURS} horas hábiles. PapuEnvios se reserva el
                    derecho de rechazar pagos si el comprobante no es verificable o si existe
                    sospecha de fraude.
                  </p>
                  <p className="mt-2 font-medium text-amber-700">
                    ⚠ Los pagos Zelle son irreversibles. Asegúrese de revisar todos los datos antes
                    de confirmar su transacción.
                  </p>
                </Section>

                <Section title="5. Tasas de cambio y comisiones">
                  <p>
                    Las tasas de cambio y comisiones se muestran antes de confirmar cada
                    transacción. PapuEnvios se reserva el derecho de actualizar las tasas en
                    cualquier momento. La tasa aplicada será la vigente en el momento en que su pago
                    sea validado.
                  </p>
                </Section>

                <Section id="delivery" title="6. Entrega">
                  <p>
                    La entrega en Cuba es realizada por un agente de entrega local independiente.
                    PapuEnvios no publica los datos personales de dicho agente.
                  </p>
                  <p>
                    Los tiempos de entrega son estimados y no constituyen una garantía. Pueden
                    variar por disponibilidad, logística local u otras circunstancias fuera de
                    nuestro control.
                  </p>
                </Section>

                <Section title="7. Restricciones de uso">
                  <p>Queda prohibido utilizar PapuEnvios para:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li>Actividades ilegales o que violen regulaciones de sanciones internacionales.</li>
                    <li>Enviar fondos a personas o entidades en listas de sanciones.</li>
                    <li>Cargar comprobantes de pago falsos o alterados.</li>
                    <li>Abusar del sistema de ofertas o descuentos.</li>
                    <li>Intentar acceder sin autorización a sistemas o datos de otros usuarios.</li>
                  </ul>
                </Section>

                <Section title="8. Regulación OFAC y cumplimiento">
                  <p>
                    Los envíos a Cuba están sujetos a las regulaciones de EE.UU. administradas por
                    la Oficina de Control de Activos Extranjeros (OFAC), incluyendo las Cuban Assets
                    Control Regulations (31 CFR Part 515). El usuario es responsable de asegurarse
                    de que sus transacciones cumplan con todas las leyes aplicables, incluyendo los
                    límites de envío vigentes. PapuEnvios no ofrece asesoría legal.
                  </p>
                </Section>

                <Section id="refunds" title="9. Cancelaciones y reembolsos">
                  <ul className="list-disc pl-5 space-y-2">
                    <li>
                      <strong>Antes del despacho:</strong> mientras un pedido o remesa aún no haya
                      sido despachado, puede solicitar su cancelación. Las remesas y los pedidos de
                      productos se cancelan directamente desde Mis Remesas y Mis Pedidos hasta que
                      nuestro equipo valide el pago. Una vez validado el pago y antes del despacho,
                      la cancelación se solicita por soporte (<LegalContact es />). Si hubo un
                      pago, se reembolsa el monto total pagado, de forma manual y al mismo método
                      Zelle utilizado, dentro de {REFUND_BUSINESS_DAYS} días hábiles.
                    </li>
                    <li>
                      <strong>Pedidos sin pago verificado:</strong> los pedidos cuyo pago no se
                      verifica vencen automáticamente y el inventario reservado se libera. PapuEnvios
                      no cobra nada por ellos.
                    </li>
                    <li>
                      <strong>Pago rechazado o producto no disponible:</strong> se reembolsa el monto
                      total pagado dentro de {REFUND_BUSINESS_DAYS} días hábiles.
                    </li>
                    <li>
                      <strong>Después del despacho:</strong> el pedido o la remesa ya no puede
                      cancelarse. Solo procede un reembolso o reenvío por falta de entrega o por
                      productos materialmente distintos a lo ordenado o dañados, siempre que el
                      reclamo se presente dentro de las {CLAIM_WINDOW_HOURS} horas siguientes a la
                      entrega (o a la fecha estimada de entrega, si esta no se produjo).
                    </li>
                    <li>
                      <strong>Errores del pagador en Zelle:</strong> PapuEnvios no puede revertir un
                      pago Zelle realizado con un monto o destinatario incorrecto por parte del
                      pagador; estos casos deben gestionarse con su banco.
                    </li>
                    <li>
                      <strong>Remesas:</strong> se aplica la tasa vigente cuando su pago es
                      validado (sección 5). Los reembolsos se realizan en USD por el monto pagado.
                    </li>
                  </ul>
                  <p>
                    Para solicitar una cancelación o presentar un reclamo, contáctenos a través de{' '}
                    <LegalContact es />.
                  </p>
                </Section>

                <Section title="10. Limitación de responsabilidad">
                  <p>
                    PapuEnvios no será responsable por retrasos causados por circunstancias fuera
                    de nuestro control (interrupciones bancarias, situaciones en Cuba, eventos de
                    fuerza mayor). Nuestra responsabilidad máxima se limita al monto de la
                    transacción específica en disputa.
                  </p>
                </Section>

                <Section title="11. Modificaciones">
                  <p>
                    Nos reservamos el derecho de modificar estos términos. Los cambios se publicarán
                    en esta página junto con su fecha de actualización y, para cambios sustanciales,
                    con al menos {TERMS_CHANGE_NOTICE_DAYS} días de anticipación. El uso continuado
                    del servicio después de los cambios constituye aceptación de los nuevos
                    términos.
                  </p>
                </Section>

                <Section title="12. Contacto">
                  <p>
                    Para consultas sobre estos términos, utilice <LegalContact es />.
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

                <Section title="2. Service Description and Limits">
                  <p>
                    PapuEnvios is a platform that enables people abroad — primarily in the United
                    States — to send remittances and purchase products for delivery to recipients
                    in Cuba.
                  </p>
                  <p>
                    PapuEnvios is not a bank and is not a financial institution: it does not offer
                    accounts, deposits or credit. Payments are made via Zelle and
                    are verified manually.
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
                    will manually verify it. Verification may take up to{' '}
                    {PAYMENT_VERIFICATION_BUSINESS_HOURS} business hours. PapuEnvios reserves the
                    right to reject payments if the proof cannot be verified or if fraud is
                    suspected.
                  </p>
                  <p className="mt-2 font-medium text-amber-700">
                    ⚠ Zelle payments are irreversible. Review all details before confirming your
                    transaction.
                  </p>
                </Section>

                <Section title="5. Exchange Rates and Fees">
                  <p>
                    Exchange rates and fees are displayed before confirming each transaction.
                    PapuEnvios reserves the right to update rates at any time. The rate applied
                    will be the one in effect when your payment is validated.
                  </p>
                </Section>

                <Section id="delivery" title="6. Delivery">
                  <p>
                    Delivery in Cuba is carried out by an independent local delivery agent.
                    PapuEnvios does not publish the personal data of that agent.
                  </p>
                  <p>
                    Delivery times are estimates and are not guaranteed. They may vary due to
                    availability, local logistics or other circumstances beyond our control.
                  </p>
                </Section>

                <Section title="7. Prohibited Uses">
                  <p>You may not use PapuEnvios for:</p>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    <li>Illegal activities or violations of international sanctions regulations.</li>
                    <li>Sending funds to sanctioned persons or entities.</li>
                    <li>Uploading false or altered payment proofs.</li>
                    <li>Abusing offers or discount systems.</li>
                    <li>Attempting unauthorized access to systems or other users' data.</li>
                  </ul>
                </Section>

                <Section title="8. OFAC Compliance">
                  <p>
                    Shipments to Cuba are subject to U.S. regulations administered by the Office of
                    Foreign Assets Control (OFAC), including the Cuban Assets Control Regulations
                    (31 CFR Part 515). Users are responsible for ensuring their transactions comply
                    with all applicable laws, including current sending limits. PapuEnvios does not
                    provide legal advice.
                  </p>
                </Section>

                <Section id="refunds" title="9. Cancellations and Refunds">
                  <ul className="list-disc pl-5 space-y-2">
                    <li>
                      <strong>Before dispatch:</strong> while an order or remittance has not been
                      dispatched, you may request its cancellation. Remittances and product orders
                      can be cancelled directly from My Remittances and My Orders until our team
                      validates the payment. Once the payment is validated and before dispatch,
                      cancellation is requested through support (<LegalContact es={false} />). If a
                      payment was made, the full amount paid is refunded manually to the same Zelle
                      method used, within {REFUND_BUSINESS_DAYS} business days.
                    </li>
                    <li>
                      <strong>Orders without verified payment:</strong> orders whose payment is not
                      verified expire automatically and the reserved stock is released. PapuEnvios
                      charges nothing for them.
                    </li>
                    <li>
                      <strong>Rejected payment or unavailable item:</strong> the full amount paid is
                      refunded within {REFUND_BUSINESS_DAYS} business days.
                    </li>
                    <li>
                      <strong>After dispatch:</strong> the order or remittance can no longer be
                      cancelled. A refund or redelivery applies only for non-delivery or for items
                      that are materially different from what was ordered or damaged, provided the
                      claim is made within {CLAIM_WINDOW_HOURS} hours after delivery (or after the
                      estimated delivery date, if delivery did not occur).
                    </li>
                    <li>
                      <strong>Payer errors on Zelle:</strong> PapuEnvios cannot reverse a Zelle
                      payment sent with a wrong amount or to a wrong recipient on the payer's side;
                      such cases must be handled with your bank.
                    </li>
                    <li>
                      <strong>Remittances:</strong> the rate in effect when your payment is
                      validated applies (section 5). Refunds are made in USD for the amount paid.
                    </li>
                  </ul>
                  <p>
                    To request a cancellation or submit a claim, contact us through{' '}
                    <LegalContact es={false} />.
                  </p>
                </Section>

                <Section title="10. Limitation of Liability">
                  <p>
                    PapuEnvios is not liable for delays caused by circumstances beyond our control
                    (banking outages, situations in Cuba, force majeure). Our maximum liability is
                    limited to the amount of the specific transaction in dispute.
                  </p>
                </Section>

                <Section title="11. Modifications">
                  <p>
                    We reserve the right to modify these terms. Changes will be published on this
                    page together with their update date and, for substantial changes, with at
                    least {TERMS_CHANGE_NOTICE_DAYS} days' notice. Continued use of the service
                    after changes constitutes acceptance of the new terms.
                  </p>
                </Section>

                <Section title="12. Contact">
                  <p>
                    For questions about these terms, use <LegalContact es={false} />.
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
