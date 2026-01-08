import React from 'react';
import { motion } from 'framer-motion';
import { Bell, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { getPrimaryButtonStyle } from '@/lib/styleUtils';
import { toast } from '@/components/ui/use-toast';
import { saveNotificationSettings } from '@/lib/notificationSettingsService';

/**
 * Notification Settings component
 * Manages WhatsApp and email contact information for system notifications
 */
const SettingsPageContent = ({ localNotifications, setLocalNotifications }) => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();

  const handleNotificationSave = async () => {
    try {
      await saveNotificationSettings(localNotifications);
      toast({ title: t('settings.saveSuccess') });
    } catch (error) {
      console.error('Error saving notification settings:', error);
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
      <h2 className="text-2xl font-semibold mb-6 flex items-center">
        <Bell className="mr-3 text-green-600" />
        {t('settings.notifications.title')}
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            {t('settings.notifications.whatsapp')}
          </label>
          <input
            type="tel"
            value={localNotifications.whatsapp}
            onChange={(e) => setLocalNotifications({ ...localNotifications, whatsapp: e.target.value })}
            placeholder="+1234567890"
            className="w-full input-style"
          />
          <p className="text-xs text-gray-500 mt-1">
            {language === 'es'
              ? 'Número de WhatsApp para soporte individual'
              : 'WhatsApp number for individual support'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            {language === 'es' ? 'Grupo de WhatsApp' : 'WhatsApp Group'}
          </label>
          <input
            type="text"
            value={localNotifications.whatsappGroup}
            onChange={(e) => setLocalNotifications({ ...localNotifications, whatsappGroup: e.target.value })}
            placeholder="https://chat.whatsapp.com/xxxxx"
            className="w-full input-style"
          />
          <p className="text-xs text-gray-500 mt-1">
            {language === 'es'
              ? 'URL del grupo de WhatsApp para notificaciones de pedidos'
              : 'WhatsApp group URL for order notifications'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            {t('settings.notifications.adminEmail')}
          </label>
          <input
            type="email"
            value={localNotifications.adminEmail}
            onChange={(e) => setLocalNotifications({ ...localNotifications, adminEmail: e.target.value })}
            placeholder="admin@example.com"
            className="w-full input-style"
          />
          <p className="text-xs text-gray-500 mt-1">
            {language === 'es'
              ? 'Email para recibir notificaciones de nuevos pedidos'
              : 'Email to receive new order notifications'}
          </p>
        </div>
      </div>

      <div className="mt-6 text-right">
        <Button onClick={handleNotificationSave} style={getPrimaryButtonStyle(visualSettings)}>
          <Save className="mr-2 h-4 w-4" />
          {t('common.saveSettings')}
        </Button>
      </div>
    </motion.div>
  );
};

export default SettingsPageContent;
