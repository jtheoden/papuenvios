import React from 'react';
import { formatRecipientLocation } from '@/lib/recipientInfo';

/**
 * Renders "label municipality, province" for a remittance, or nothing when
 * neither value is present. Uses the real columns `recipient_municipality`
 * and `recipient_province` (there is no `recipient_city` column).
 *
 * @prop {string} label - Already-translated label
 * @prop {object} remittance - Row with recipient_municipality / recipient_province
 * @prop {string} className - Optional wrapper classes
 * @prop {string} labelClassName - Optional label classes
 */
const RecipientLocation = ({ label, remittance, className = '', labelClassName = 'font-medium' }) => {
  const location = formatRecipientLocation(
    remittance?.recipient_municipality,
    remittance?.recipient_province
  );
  if (!location) return null;

  return (
    <p className={className}>
      <span className={labelClassName}>{label}</span> {location}
    </p>
  );
};

export default RecipientLocation;
