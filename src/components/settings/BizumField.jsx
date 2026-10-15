import React from 'react';

const INPUT_CLASS =
  'w-full min-h-11 rounded border px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

/**
 * Labelled text input / textarea with help, meta and error text wired through aria-describedby.
 * Receives already translated strings; owns no copy.
 */
const BizumField = ({ id, label, value, onChange, error, help, meta, multiline = false, inputMode, className = '' }) => {
  const describedBy = [help && `${id}-help`, meta && `${id}-meta`, error && `${id}-error`].filter(Boolean).join(' ');
  const shared = {
    id,
    value,
    onChange: (event) => onChange(event.target.value),
    'aria-invalid': error ? 'true' : 'false',
    'aria-describedby': describedBy || undefined,
    className: `${INPUT_CLASS} ${error ? 'border-red-600' : 'border-gray-400'}`
  };

  return (
    <div className={`space-y-1 ${className}`}>
      <label htmlFor={id} className="block text-sm font-medium text-gray-900">
        {label}
      </label>
      {multiline ? <textarea rows={3} {...shared} /> : <input type="text" inputMode={inputMode} {...shared} />}
      {help && (
        <p id={`${id}-help`} className="text-sm text-gray-700">
          {help}
        </p>
      )}
      {meta && (
        <p id={`${id}-meta`} className="text-xs text-gray-700">
          {meta}
        </p>
      )}
      {/* Persistent live region: it must exist before the text so assistive tech announces the change. */}
      <p id={`${id}-error`} aria-live="polite" className="text-xs font-medium text-red-700">
        {error || null}
      </p>
    </div>
  );
};

export default BizumField;
