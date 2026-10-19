import { useEffect, useRef, useState } from 'react';
import { UserX, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import {
  setUserEnabled,
  classifyUserStatusError,
  USER_STATUS_ERROR,
  USER_DISABLE_REASON_MIN,
  USER_DISABLE_REASON_MAX
} from '@/lib/userStatusService';

const ERROR_KEYS = {
  [USER_STATUS_ERROR.FORBIDDEN]: 'forbidden',
  [USER_STATUS_ERROR.SELF]: 'self',
  [USER_STATUS_ERROR.LAST_SUPER_ADMIN]: 'lastSuperAdmin',
  [USER_STATUS_ERROR.REASON_REQUIRED]: 'reasonRequired',
  [USER_STATUS_ERROR.REASON_TOO_LONG]: 'reasonTooLong',
  [USER_STATUS_ERROR.NOT_FOUND]: 'notFound',
  [USER_STATUS_ERROR.UNKNOWN]: 'unknown'
};

/**
 * Enable / disable button for the user management screen. Visible only to a super_admin and never for
 * themselves or another super_admin (the database enforces the same rules; this only avoids dead buttons).
 * Disabling asks for a mandatory reason in an accessible dialog.
 */
const UserStatusAction = ({ targetUser, currentUserId, isSuperAdmin, onChanged, className = '', showLabel = false }) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  if (!isSuperAdmin || !targetUser || targetUser.id === currentUserId || targetUser.role === 'super_admin') {
    return null;
  }

  const email = targetUser.email || '';
  const isEnabled = targetUser.is_enabled !== false;
  const trimmedLength = reason.trim().length;
  const reasonValid = trimmedLength >= USER_DISABLE_REASON_MIN && reason.length <= USER_DISABLE_REASON_MAX;
  const messageFor = (err) => t(`users.statusErrors.${ERROR_KEYS[classifyUserStatusError(err)]}`);

  const closeDialog = () => {
    setOpen(false);
    setReason('');
    setError('');
    triggerRef.current?.focus();
  };

  const handleEnable = async () => {
    setBusy(true);
    try {
      await setUserEnabled(targetUser.id, true);
      toast({ title: t('users.userEnabled'), description: t('users.statusUpdateSuccess') });
      await onChanged?.();
    } catch (err) {
      toast({ title: t('users.statusUpdateError'), description: messageFor(err), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async (event) => {
    event.preventDefault();
    if (!reasonValid || busy) return;
    setBusy(true);
    setError('');
    try {
      await setUserEnabled(targetUser.id, false, reason.trim());
      toast({ title: t('users.userDisabled'), description: t('users.statusUpdateSuccess') });
      setOpen(false);
      setReason('');
      await onChanged?.();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const label = isEnabled ? t('users.disable') : t('users.enable');
  const ariaLabel = `${label} ${t('users.userNoun')} ${email}`;
  const Icon = isEnabled ? UserX : UserCheck;

  return (
    <>
      <Button
        ref={triggerRef}
        variant={isEnabled ? 'outline' : 'default'}
        size="sm"
        className={`h-8 px-2 sm:px-3 ${className}`}
        disabled={busy}
        aria-label={ariaLabel}
        title={isEnabled ? t('users.disableUser') : t('users.enableUser')}
        onClick={isEnabled ? () => setOpen(true) : handleEnable}
      >
        <Icon className={`w-4 h-4 ${showLabel ? 'mr-2' : 'sm:mr-1'}`} aria-hidden="true" />
        <span className={showLabel ? '' : 'hidden sm:inline'}>{label}</span>
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => e.target === e.currentTarget && !busy && closeDialog()}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby={`disable-user-title-${targetUser.id}`}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-2xl p-5 space-y-4"
            onSubmit={handleDisable}
            onKeyDown={(e) => e.key === 'Escape' && !busy && closeDialog()}
          >
            <div>
              <h2 id={`disable-user-title-${targetUser.id}`} className="text-lg font-semibold text-gray-900">
                {t('users.disableDialog.title')}
              </h2>
              <p className="mt-1 text-sm text-gray-600 break-words">
                {t('users.disableDialog.description', { email })}
              </p>
            </div>

            <div>
              <label htmlFor={`disable-user-reason-${targetUser.id}`} className="block text-sm font-medium text-gray-700 mb-1">
                {t('users.disableDialog.reasonLabel')}
              </label>
              <textarea
                id={`disable-user-reason-${targetUser.id}`}
                ref={textareaRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={USER_DISABLE_REASON_MAX}
                rows={4}
                required
                disabled={busy}
                placeholder={t('users.disableDialog.reasonPlaceholder')}
                aria-describedby={`disable-user-help-${targetUser.id}`}
                className="w-full rounded-md border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div id={`disable-user-help-${targetUser.id}`} className="mt-1 flex justify-between gap-2 text-xs text-gray-500">
                <span>{t('users.disableDialog.reasonHelp', { min: USER_DISABLE_REASON_MIN })}</span>
                <span>{`${reason.length}/${USER_DISABLE_REASON_MAX}`}</span>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-md p-2">
                {error}
              </p>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={closeDialog}>
                {t('users.disableDialog.cancel')}
              </Button>
              <Button type="submit" disabled={!reasonValid || busy} aria-busy={busy}>
                {t('users.disableDialog.confirm')}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};

export default UserStatusAction;
