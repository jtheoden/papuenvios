/**
 * NotifyAdminWhatsAppButton
 * Explicit, user-gesture-triggered WhatsApp link to notify the administrator
 * about a remittance payment proof. The recipient and message are resolved
 * ahead of time so the click handler can call window.open synchronously
 * (async work before window.open gets the popup blocked by browsers).
 */

import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { getFreshGuidedWhatsappPhone } from '@/lib/notificationSettingsService';
import {
  ADMIN_NOTIFICATION_LANGUAGE,
  buildRemittanceProofMessage,
  generateWhatsAppURL,
  resolveRemittanceProofLink
} from '@/lib/whatsappService';

const STATUS = { LOADING: 'loading', READY: 'ready', UNAVAILABLE: 'unavailable' };

const NotifyAdminWhatsAppButton = ({ remittance, user = null, className = '' }) => {
  const { t } = useLanguage();
  const [target, setTarget] = useState({ status: STATUS.LOADING, url: '' });

  const remittanceId = remittance?.id;
  const proofUrl = remittance?.payment_proof_url;

  useEffect(() => {
    if (!remittance) {
      setTarget({ status: STATUS.UNAVAILABLE, url: '' });
      return undefined;
    }

    let cancelled = false;
    setTarget({ status: STATUS.LOADING, url: '' });

    const resolveTarget = async () => {
      try {
        const recipient = await getFreshGuidedWhatsappPhone();
        if (!recipient) return { status: STATUS.UNAVAILABLE, url: '' };

        const proofLink = await resolveRemittanceProofLink(remittance);
        const enriched = {
          ...remittance,
          user_email: remittance.user_email || user?.email,
          user_name:
            remittance.user_name ||
            user?.user_metadata?.full_name ||
            user?.user_metadata?.name ||
            user?.email?.split('@')[0]
        };
        const message = buildRemittanceProofMessage(enriched, { language: ADMIN_NOTIFICATION_LANGUAGE, proofLink });
        const url = generateWhatsAppURL(recipient, message);
        return url ? { status: STATUS.READY, url } : { status: STATUS.UNAVAILABLE, url: '' };
      } catch {
        return { status: STATUS.UNAVAILABLE, url: '' };
      }
    };

    resolveTarget().then((result) => {
      if (!cancelled) setTarget(result);
    });

    return () => {
      cancelled = true;
    };
    // remittance/user objects are intentionally tracked by the identifying fields below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remittanceId, proofUrl, user?.email]);

  const handleClick = () => {
    if (target.status === STATUS.READY && target.url) {
      window.open(target.url, '_blank', 'noopener,noreferrer');
      return;
    }
    toast({
      title: t('remittances.notifyAdmin.noRecipientTitle'),
      description: t('remittances.notifyAdmin.noRecipient'),
      variant: 'destructive'
    });
  };

  return (
    <div className={className}>
      <Button
        type="button"
        onClick={handleClick}
        disabled={target.status === STATUS.LOADING}
        className="w-full bg-green-600 hover:bg-green-700 text-white"
      >
        <MessageCircle className="mr-2 h-4 w-4" />
        {t('remittances.notifyAdmin.button')}
      </Button>
      <p className="mt-1 text-xs text-gray-500 text-center">{t('remittances.notifyAdmin.hint')}</p>
    </div>
  );
};

export default NotifyAdminWhatsAppButton;
