import { motion } from 'framer-motion';
import { Send, Eye, TrendingUp, Clock, ArrowRight, CheckCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';

const RemittancesPage = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { visualSettings } = useBusiness();

  const features = [
    { icon: TrendingUp, key: 'rates' },
    { icon: Clock, key: 'delivery' },
    { icon: CheckCircle, key: 'tracking' }
  ].map(({ icon, key }) => ({
    icon,
    title: t(`remittances.features.${key}.title`),
    description: t(`remittances.features.${key}.description`)
  }));

  return (
    <div className="min-h-screen bg-gradient-to-b from-theme-accent-soft to-white">
      <div className="max-w-6xl mx-auto px-4 py-16">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <h1 style={getHeadingStyle(visualSettings)} className="font-bold text-4xl md:text-5xl mb-4">
            {t('remittances.title')}
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            {t('remittances.subtitle')}
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <motion.button
              onClick={() => onNavigate('send-remittance')}
              style={getPrimaryButtonStyle(visualSettings)} className="rounded-lg font-semibold flex items-center justify-center gap-2 px-8 py-4 text-lg shadow-lg shadow-theme-focus/30 ring-2 ring-blue-400/50"
              animate={{
                scale: [1, 1.02, 1],
                boxShadow: [
                  '0 10px 15px -3px rgb(var(--t-focus) / 0.3)',
                  '0 10px 25px -3px rgb(var(--t-focus) / 0.5)',
                  '0 10px 15px -3px rgb(var(--t-focus) / 0.3)'
                ]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut'
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
            >
              <Send className="h-6 w-6" />
              {t('remittances.send')}
            </motion.button>

            {user && (
              <button
                onClick={() => onNavigate('my-remittances')}
                className="flex items-center justify-center gap-2 px-8 py-4 text-lg border-2 border-theme-accent text-[rgb(var(--t-link))] rounded-lg hover:bg-theme-accent-soft transition-colors font-semibold"
              >
                <Eye className="h-6 w-6" />
                {t('remittances.myRemittances')}
              </button>
            )}
          </div>
        </motion.div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="glass-effect p-6 rounded-xl text-center hover:shadow-lg transition-shadow"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-theme-accent-soft-2 rounded-full mb-4">
                <feature.icon className="h-8 w-8 text-[rgb(var(--t-link))]" />
              </div>
              <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
              <p className="text-gray-600">{feature.description}</p>
            </motion.div>
          ))}
        </div>

        {/* How It Works */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-effect p-8 rounded-xl"
        >
          <h2 className="text-2xl font-bold text-center mb-8">
            {t('remittances.howItWorks')}
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '1', ...t('remittances.step1') },
              { step: '2', ...t('remittances.step2') },
              { step: '3', ...t('remittances.step3') }
            ].map((step, index) => (
              <div key={index} className="relative">
                <div className="flex items-center mb-4">
                  <div className="flex items-center justify-center w-12 h-12 bg-theme-accent text-theme-on-accent rounded-full font-bold text-xl">
                    {step.step}
                  </div>
                  {index < 2 && (
                    <ArrowRight className="h-6 w-6 text-blue-400 mx-4 hidden md:block" />
                  )}
                </div>
                <h3 className="text-lg font-bold mb-2">{step.title}</h3>
                <p className="text-gray-600">{step.description}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* CTA Section */}
        {!user && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-center mt-12"
          >
            <p className="text-gray-600 mb-4">
              ¿Listo para enviar tu primera remesa?
            </p>
            <motion.button
              onClick={() => onNavigate('send-remittance')}
              style={getPrimaryButtonStyle(visualSettings)} className="rounded-lg px-6 py-3 font-semibold inline-flex items-center gap-2 shadow-lg shadow-theme-focus/30"
              animate={{
                scale: [1, 1.02, 1],
                boxShadow: [
                  '0 10px 15px -3px rgb(var(--t-focus) / 0.3)',
                  '0 10px 25px -3px rgb(var(--t-focus) / 0.5)',
                  '0 10px 15px -3px rgb(var(--t-focus) / 0.3)'
                ]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut'
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
            >
              {t('remittances.send')}
              <ArrowRight className="h-5 w-5" />
            </motion.button>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default RemittancesPage;
