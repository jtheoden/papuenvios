/**
 * Decorative icon of a rate state. The state is always also spelled out as text next to it, so the icon is
 * aria-hidden: it exists so the state is not conveyed by colour alone.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import { RATE_STATES } from '@/lib/rateAge';

const ICONS = {
  [RATE_STATES.OK]: CheckCircle2,
  [RATE_STATES.WARN]: AlertTriangle,
  [RATE_STATES.BLOCKED]: XCircle,
  [RATE_STATES.NONE]: HelpCircle
};

const FxStateIcon = ({ state, className = '' }) => {
  const Icon = ICONS[state] || ICONS[RATE_STATES.NONE];
  return <Icon aria-hidden="true" focusable="false" className={`inline h-4 w-4 shrink-0 ${className}`} />;
};

export default FxStateIcon;
