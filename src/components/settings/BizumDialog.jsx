import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';

/**
 * Modal used by the Bizum settings (account form, activation confirmation, large FX change).
 * Radix gives focus trapping, Escape, focus return and aria-modal; title and description are
 * mandatory so the dialog always has an accessible name and description.
 */
const BizumDialog = ({ open, onOpenChange, title, description, children, body, footer }) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl focus:outline-none">
        <Dialog.Title className="text-lg font-semibold text-gray-900">{title}</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-gray-700">{description}</Dialog.Description>
        {(body || children) && (
          <div className="mt-4 space-y-3">
            {body}
            {children}
          </div>
        )}
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

export default BizumDialog;
