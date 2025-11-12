import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { UserAvatar } from '@/components/ui/user-avatar';

export function UserAvatarWithBadge({ user, showCategory = true, className = '' }) {
  const [category, setCategory] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!showCategory || !user?.id) return;

    const fetchCategory = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('user_categories')
          .select('category_name')
          .eq('user_id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('[UserAvatarWithBadge] Error fetching category:', error);
        } else if (data) {
          setCategory(data.category_name);
        }
      } catch (err) {
        console.error('[UserAvatarWithBadge] Error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCategory();
  }, [user?.id, showCategory]);

  const getCategoryColor = (categoryName) => {
    const colors = {
      regular: 'bg-gray-200 text-gray-800',
      pro: 'bg-blue-200 text-blue-800',
      vip: 'bg-yellow-200 text-yellow-800',
    };
    return colors[categoryName] || colors.regular;
  };

  const getCategoryLabel = (categoryName) => {
    const labels = {
      regular: 'Regular',
      pro: 'Pro',
      vip: 'VIP',
    };
    return labels[categoryName] || 'Regular';
  };

  return (
    <div className={`relative inline-flex ${className}`}>
      {/* Avatar */}
      <UserAvatar user={user} />

      {/* Category Badge */}
      {showCategory && (
        <div
          className={`absolute bottom-0 right-0 transform translate-x-1 translate-y-1 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${getCategoryColor(category || 'regular')} border border-white shadow-md`}
          title={`Categoría: ${getCategoryLabel(category || 'regular')}`}
        >
          {/* Category icon */}
          <span>
            {category === 'vip' ? '👑' : category === 'pro' ? '⭐' : '●'}
          </span>
          <span>{getCategoryLabel(category || 'regular')}</span>
        </div>
      )}
    </div>
  );
}

// Export separate function to just show the badge
export function CategoryBadge({ category, className = '' }) {
  const getCategoryColor = (categoryName) => {
    const colors = {
      regular: 'bg-gray-200 text-gray-800',
      pro: 'bg-blue-200 text-blue-800',
      vip: 'bg-yellow-200 text-yellow-800',
    };
    return colors[categoryName] || colors.regular;
  };

  const getCategoryLabel = (categoryName) => {
    const labels = {
      regular: 'Regular',
      pro: 'Pro',
      vip: 'VIP',
    };
    return labels[categoryName] || 'Regular';
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold ${getCategoryColor(category || 'regular')} ${className}`}
      title={`Categoría: ${getCategoryLabel(category || 'regular')}`}
    >
      <span>
        {category === 'vip' ? '👑' : category === 'pro' ? '⭐' : '●'}
      </span>
      <span>{getCategoryLabel(category || 'regular')}</span>
    </span>
  );
}

// Export tooltip with detailed info
export function CategoryTooltip({ category, interactions = 0, nextThreshold = 5 }) {
  const getCategoryInfo = (categoryName) => {
    const info = {
      regular: { label: 'Regular', icon: '●', nextThreshold: 5 },
      pro: { label: 'Pro', icon: '⭐', nextThreshold: 10 },
      vip: { label: 'VIP', icon: '👑', nextThreshold: null },
    };
    return info[categoryName] || info.regular;
  };

  const info = getCategoryInfo(category || 'regular');
  const remainingInteractions = Math.max(0, (info.nextThreshold || Infinity) - interactions);

  return (
    <div className="text-sm space-y-2">
      <p className="font-semibold">
        {info.icon} {info.label}
      </p>
      <p className="text-gray-600">
        Transacciones completadas: <strong>{interactions}</strong>
      </p>
      {info.nextThreshold && (
        <p className="text-gray-600">
          Próxima categoría: <strong>{remainingInteractions} más</strong>
        </p>
      )}
    </div>
  );
}
