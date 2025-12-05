import React from 'react';
import { Crown, Zap, Star } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * CategoryBadge - Displays user category with color and icon
 * @param {string} categoryName - Category name (regular, pro, vip)
 * @param {boolean} readOnly - If true, don't show as clickable
 */
const CategoryBadge = ({ categoryName = 'regular', readOnly = true }) => {
  const { t } = useLanguage();

  const categoryConfig = {
    regular: {
      color: 'bg-gray-100 text-gray-800 border-gray-300',
      label: t('users.categories.statusRegular'),
      icon: <Star size={14} className="inline mr-1" />,
      description: t('users.categories.regularDesc')
    },
    pro: {
      color: 'bg-blue-100 text-blue-800 border-blue-300',
      label: t('users.categories.statusPro'),
      icon: <Zap size={14} className="inline mr-1" />,
      description: t('users.categories.proDesc')
    },
    vip: {
      color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      label: t('users.categories.statusVip'),
      icon: <Crown size={14} className="inline mr-1" />,
      description: t('users.categories.vipDesc')
    }
  };

  const config = categoryConfig[categoryName] || categoryConfig.regular;

  return (
    <div className="flex items-center gap-2" title={config.description}>
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${config.color}`}>
        {config.icon}
        {config.label}
      </span>
    </div>
  );
};

export default CategoryBadge;
