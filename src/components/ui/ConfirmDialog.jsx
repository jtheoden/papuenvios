/**
 * Themed confirmation dialog replacing the browser-native window.confirm.
 * Usage: const confirm = useConfirm(); if (!(await confirm({ title, description, variant }))) return;
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

const ConfirmContext = createContext(null);

/** Resolves false when the user cancels, presses Escape or clicks the overlay. */
export const useConfirm = () => {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used within a ConfirmProvider');
  return confirm;
};

export const ConfirmProvider = ({ children }) => {
  const { t } = useLanguage();
  const [request, setRequest] = useState(null); // { options, resolve }
  const activeRef = useRef(false);
  const confirmRef = useRef(null);

  const confirm = useCallback((options = {}) => new Promise((resolve) => {
    // One dialog at a time: a concurrent call is refused (false) instead of queued behind the user's decision.
    if (activeRef.current) { resolve(false); return; }
    activeRef.current = true;
    setRequest({ options, resolve });
  }), []);

  const settle = useCallback((value) => {
    setRequest((current) => {
      current?.resolve(value);
      return null;
    });
    activeRef.current = false;
  }, []);

  const value = useMemo(() => confirm, [confirm]);
  const options = request?.options ?? {};
  const variant = options.variant ?? 'default';
  const isDanger = variant === 'destructive' || variant === 'warning';
  const iconTone = variant === 'warning' ? 'text-amber-600' : 'text-destructive';

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialog.Root open={Boolean(request)} onOpenChange={(open) => { if (!open) settle(false); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay
            data-confirm-overlay
            onClick={() => settle(false)}
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm motion-safe:animate-fade-in"
          />
          <AlertDialog.Content
            onOpenAutoFocus={(event) => {
              if (!isDanger && confirmRef.current) { event.preventDefault(); confirmRef.current.focus(); }
            }}
            className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 text-foreground shadow-2xl motion-safe:animate-fade-in"
          >
            <div className="flex items-start gap-4">
              {isDanger && (
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                  <AlertTriangle data-confirm-icon aria-hidden="true" className={`h-6 w-6 ${iconTone}`} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <AlertDialog.Title className="mb-2 text-lg font-bold">
                  {options.title ?? t('common.confirmDialog.title')}
                </AlertDialog.Title>
                <AlertDialog.Description className="text-sm text-muted-foreground">
                  {options.description ?? ''}
                </AlertDialog.Description>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => settle(false)}>
                  {options.cancelLabel ?? t('common.confirmDialog.cancel')}
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  ref={confirmRef}
                  variant={variant === 'destructive' ? 'destructive' : 'default'}
                  className="w-full sm:w-auto"
                  onClick={() => settle(true)}
                >
                  {options.confirmLabel ?? t('common.confirmDialog.confirm')}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
};
