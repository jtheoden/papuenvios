import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Optional: If you need to query Supabase inside the function, uncomment below
// import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Secrets configured via `supabase secrets set`
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const WHATSAPP_API_TOKEN = Deno.env.get('WHATSAPP_API_TOKEN'); // Meta Business API token (optional)
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'noreply@papuenvios.com';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { orderData, notificationSettings } = await req.json();

    if (!orderData || !notificationSettings) {
      return json({ error: 'Missing payload: orderData or notificationSettings' }, 400);
    }

    const tasks: Promise<unknown>[] = [];

    // 1) Send email via Resend if configured
    if (notificationSettings.adminEmail && RESEND_API_KEY) {
      const emailBody = {
        from: FROM_EMAIL,
        to: notificationSettings.adminEmail,
        subject: `Nuevo Pedido: ${orderData.orderNumber}`,
        html: `
          <h2>Nuevo Pedido Recibido</h2>
          <p><strong>Pedido:</strong> ${orderData.orderNumber}</p>
          <p><strong>Cliente:</strong> ${orderData.customerName || 'N/A'}</p>
          <p><strong>Total:</strong> $${orderData.total} ${orderData.currency || 'USD'}</p>
          ${orderData.paymentProofUrl ? `<p><strong>Comprobante:</strong> <a href="${orderData.paymentProofUrl}">Ver comprobante</a></p>` : ''}
        `
      };

      tasks.push(
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(emailBody)
        })
      );
    }

    // 2) Optional: Send WhatsApp via Meta Business API if configured
    if (notificationSettings.whatsapp && WHATSAPP_API_TOKEN) {
      const bodyText =
        `🔔 *Nuevo Pedido*\n\n` +
        `Pedido: ${orderData.orderNumber}\n` +
        `Cliente: ${orderData.customerName || 'N/A'}\n` +
        `Total: $${orderData.total} ${orderData.currency || 'USD'}\n` +
        (orderData.paymentProofUrl ? `\nComprobante: ${orderData.paymentProofUrl}\n` : '');

      // Replace {PHONE_NUMBER_ID} with your WhatsApp Business Phone Number ID
      const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '';

      if (PHONE_NUMBER_ID) {
        tasks.push(
          fetch(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: notificationSettings.whatsapp,
              type: 'text',
              text: { body: bodyText }
            })
          })
        );
      }
    }

    // Run tasks in parallel (non-blocking failures)
    await Promise.allSettled(tasks);

    return json({ success: true });
  } catch (err) {
    return json({ error: err?.message || String(err) }, 500);
  }
});

// Helpers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
