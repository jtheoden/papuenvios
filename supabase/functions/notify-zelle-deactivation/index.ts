import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Edge Function: notify-zelle-deactivation
 * Sends email notification to users when their selected Zelle account is deactivated
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'noreply@papuenvios.com';
const APP_NAME = 'PapuEnvíos';
const APP_URL = Deno.env.get('APP_URL') || 'https://papuenvios.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Email templates by language
const templates = {
  es: {
    subject: '⚠️ Acción Requerida: Cuenta Zelle No Disponible',
    greeting: (name: string) => `Hola ${name},`,
    intro: (accountName: string) => `Te informamos que la cuenta Zelle "${accountName}" que seleccionaste para tu pago ya no está disponible.`,
    ordersSection: 'Pedidos afectados:',
    remittancesSection: 'Remesas afectadas:',
    orderItem: (amount: number) => `Pedido por $${amount.toFixed(2)} USD`,
    remittanceItem: (amount: number) => `Remesa por $${amount.toFixed(2)} USD`,
    action: 'Por favor ingresa a tu cuenta y selecciona una nueva cuenta Zelle para completar tu pago.',
    ctaButton: 'Ir a mi cuenta',
    footer: `Gracias por usar ${APP_NAME}. Si tienes alguna pregunta, contáctanos.`,
    noReply: 'Este es un mensaje automático, por favor no respondas a este correo.'
  },
  en: {
    subject: '⚠️ Action Required: Zelle Account Unavailable',
    greeting: (name: string) => `Hello ${name},`,
    intro: (accountName: string) => `We inform you that the Zelle account "${accountName}" you selected for your payment is no longer available.`,
    ordersSection: 'Affected orders:',
    remittancesSection: 'Affected remittances:',
    orderItem: (amount: number) => `Order for $${amount.toFixed(2)} USD`,
    remittanceItem: (amount: number) => `Remittance for $${amount.toFixed(2)} USD`,
    action: 'Please log in to your account and select a new Zelle account to complete your payment.',
    ctaButton: 'Go to my account',
    footer: `Thank you for using ${APP_NAME}. If you have any questions, contact us.`,
    noReply: 'This is an automated message, please do not reply to this email.'
  }
};

interface AffectedOperation {
  id: string;
  amount: number;
  createdAt: string;
}

interface RequestBody {
  userEmail: string;
  userName: string;
  language: 'es' | 'en';
  zelleAccountName: string;
  affectedOrders: AffectedOperation[];
  affectedRemittances: AffectedOperation[];
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) {
      console.warn('[notify-zelle-deactivation] RESEND_API_KEY not configured');
      return json({ success: false, error: 'Email service not configured' }, 200);
    }

    const body: RequestBody = await req.json();
    const { userEmail, userName, language, zelleAccountName, affectedOrders, affectedRemittances } = body;

    if (!userEmail) {
      return json({ error: 'Missing userEmail' }, 400);
    }

    const t = templates[language] || templates.es;

    // Build affected operations HTML
    let operationsHtml = '';

    if (affectedOrders.length > 0) {
      operationsHtml += `
        <p style="font-weight: 600; margin-top: 16px; margin-bottom: 8px;">${t.ordersSection}</p>
        <ul style="margin: 0; padding-left: 20px;">
          ${affectedOrders.map(o => `<li>${t.orderItem(o.amount)}</li>`).join('')}
        </ul>
      `;
    }

    if (affectedRemittances.length > 0) {
      operationsHtml += `
        <p style="font-weight: 600; margin-top: 16px; margin-bottom: 8px;">${t.remittancesSection}</p>
        <ul style="margin: 0; padding-left: 20px;">
          ${affectedRemittances.map(r => `<li>${t.remittanceItem(r.amount)}</li>`).join('')}
        </ul>
      `;
    }

    // Build full email HTML
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">⚠️ ${APP_NAME}</h1>
          </div>

          <!-- Content -->
          <div style="padding: 32px;">
            <p style="font-size: 16px; color: #374151; margin-bottom: 16px;">${t.greeting(userName)}</p>

            <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #92400e; font-size: 15px;">${t.intro(zelleAccountName)}</p>
            </div>

            ${operationsHtml}

            <p style="color: #374151; font-size: 15px; margin-top: 24px;">${t.action}</p>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
              <a href="${APP_URL}/cart" style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                ${t.ctaButton}
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

            <p style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">${t.footer}</p>
            <p style="color: #9ca3af; font-size: 12px; font-style: italic;">${t.noReply}</p>
          </div>

          <!-- Footer -->
          <div style="background-color: #f9fafb; padding: 16px; text-align: center;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} ${APP_NAME}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email via Resend
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: userEmail,
        subject: t.subject,
        html
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[notify-zelle-deactivation] Resend error:', errorData);
      return json({ success: false, error: 'Failed to send email' }, 200);
    }

    const result = await response.json();
    console.log(`[notify-zelle-deactivation] Email sent to ${userEmail}, id: ${result.id}`);

    return json({ success: true, emailId: result.id });
  } catch (err) {
    console.error('[notify-zelle-deactivation] Error:', err);
    return json({ error: err?.message || String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
