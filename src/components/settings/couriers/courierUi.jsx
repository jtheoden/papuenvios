/**
 * Small shared primitives of the courier-management screens: 44 px touch targets, labelled fields, notices that never
 * rely on colour alone (icon + text) and a one-line error formatter that maps typed RPC refusals to i18n.
 */
import React, { useId } from 'react';
import { AlertTriangle, Info, CheckCircle2 } from 'lucide-react';

export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600';
export const inputCls = `w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 text-sm ${FOCUS}`;

const BTN_TONES = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  secondary: 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50',
  danger: 'bg-red-600 text-white hover:bg-red-700'
};

export const Btn = ({ tone = 'secondary', className = '', type = 'button', ...props }) => (
  <button
    type={type}
    {...props}
    className={`inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS} ${BTN_TONES[tone]} ${className}`}
  />
);

/** Label + control + optional error, wired with htmlFor / aria-describedby. `children(props)` renders the control. */
export const Field = ({ label, error, hint, children }) => {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && <p id={hintId} className="text-xs text-gray-600">{hint}</p>}
      {error && <p id={errId} className="text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
};

const NOTICE = {
  info: { cls: 'bg-blue-50 border-blue-300 text-blue-900', Icon: Info },
  warn: { cls: 'bg-amber-50 border-amber-400 text-amber-900', Icon: AlertTriangle },
  error: { cls: 'bg-red-50 border-red-400 text-red-900', Icon: AlertTriangle },
  ok: { cls: 'bg-green-50 border-green-400 text-green-900', Icon: CheckCircle2 }
};

export const Notice = ({ tone = 'info', children, live = false, testId }) => {
  const { cls, Icon } = NOTICE[tone];
  return (
    <div
      data-testid={testId}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={live || tone === 'error' ? 'polite' : undefined}
      className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
};

/** Message for a thrown service error: typed i18n key when it carries one, else the generic text. */
export const errorText = (t, error) => t(error?.i18nKey || 'couriers.errors.generic');

export const formatCup = (v) => (v === null || v === undefined ? null : `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CUP`);
export const formatUsd = (v) => (v === null || v === undefined ? null : `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`);
