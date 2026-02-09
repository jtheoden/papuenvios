import React from 'react';
import { Crown, Zap, Star, Shield, Award, Medal, Heart, Diamond, Gem, Trophy } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const ICON_MAP = { Star, Zap, Crown, Shield, Award, Medal, Heart, Diamond, Gem, Trophy };

/**
 * CategoryBadge - Displays user category with color and icon
 * @param {string} categoryName - Category name (regular, pro, vip)
 * @param {object} rule - Optional rule object with icon, display_name_es, display_name_en, color_code
 * @param {boolean} readOnly - If true, don't show as clickable
 */
const CategoryBadge = ({ categoryName = 'regular', rule = null, readOnly = true }) => {
  const { t, language } = useLanguage();

  const categoryConfig = {
    regular: {
      color: 'bg-gray-100 text-gray-800 border-gray-300',
      label: t('users.categories.statusRegular'),
      icon: Star,
      description: t('users.categories.regularDesc')
    },
    pro: {
      color: 'bg-blue-100 text-blue-800 border-blue-300',
      label: t('users.categories.statusPro'),
      icon: Zap,
      description: t('users.categories.proDesc')
    },
    vip: {
      color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      label: t('users.categories.statusVip'),
      icon: Crown,
      description: t('users.categories.vipDesc')
    }
  };

  const config = categoryConfig[categoryName] || categoryConfig.regular;

  // Override with rule data if provided
  const IconComponent = rule?.icon ? (ICON_MAP[rule.icon] || config.icon) : config.icon;
  const label = rule
    ? (language === 'es' ? rule.display_name_es : rule.display_name_en) || config.label
    : config.label;

  return (
    <div className="flex items-center gap-2" title={config.description}>
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${config.color}`}>
        <IconComponent size={14} className="inline mr-1" />
        {label}
      </span>
    </div>
  );
};

export { ICON_MAP };
export default CategoryBadge;
