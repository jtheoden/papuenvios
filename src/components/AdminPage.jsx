import React from 'react';
import { motion } from 'framer-motion';
import { Package, List, Percent, Truck, BarChart2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import VendorPage from '@/components/VendorPage';

const AdminPage = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { user, isAdmin, isSuperAdmin, userRole } = useAuth();
  
  console.log('AdminPage Access Check:', {
    user: user?.email,
    isAdmin,
    isSuperAdmin,
    userRole
  });

  if (!user || (!isAdmin && !isSuperAdmin)) {
    return (
      <div className="min-h-screen flex items-center justify-center py-8 px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-effect p-8 rounded-2xl max-w-md w-full text-center"
        >
          <h2 className="text-2xl font-bold gradient-text mb-2">{t('dashboard.privateAccess')}</h2>
          <p className="text-gray-600">{t('dashboard.adminOnly')}</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div>
      <VendorPage onNavigate={onNavigate} />
    </div>
  );
};

export default AdminPage;