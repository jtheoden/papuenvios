import React from 'react';
import { getSupportEmail } from '@/lib/legalConfig';
import { useBusiness } from '@/contexts/BusinessContext';
import { getGuidedWhatsappPhone } from '@/lib/notificationSettingsService';
import { generateWhatsAppURL } from '@/lib/whatsappService';

/**
 * Inline contact reference for legal copy. Resolution order:
 * 1. VITE_SUPPORT_EMAIL (mailto link)
 * 2. The WhatsApp number already configured in the business notification settings (wa.me link)
 * 3. A generic pointer to the support/WhatsApp channel inside the app
 * No email or phone number is ever hardcoded.
 */
const LegalContact = ({ es }) => {
  const { notificationSettings } = useBusiness();
  const email = getSupportEmail();

  if (email) {
    return (
      <a href={`mailto:${email}`} className="text-blue-600 underline">
        {email}
      </a>
    );
  }

  const phone = getGuidedWhatsappPhone(notificationSettings);
  const whatsappUrl = phone ? generateWhatsAppURL(phone, '') : '';

  if (whatsappUrl) {
    return (
      <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
        {es ? 'WhatsApp de soporte' : 'support WhatsApp'}
      </a>
    );
  }

  return (
    <span>
      {es
        ? 'el canal de soporte o WhatsApp disponible en la aplicación'
        : 'the support or WhatsApp channel available in the app'}
    </span>
  );
};

export default LegalContact;
