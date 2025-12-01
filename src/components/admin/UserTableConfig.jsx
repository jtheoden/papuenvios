import React from 'react';
import { Shield, UserCheck, UserX, Trash2 } from 'lucide-react';
import CategoryBadge from '@/components/CategoryBadge';
import UserAvatar from '@/components/avatars/UserAvatar';

/**
 * User Table Column Configuration
 * Shared configuration for responsive user management table display
 */

const SUPER_ADMIN_EMAILS = ['jtheoden@googlemail.com', 'elpapuedition@gmail.com'];

/**
 * Get table columns for responsive user display
 * @param {function} t - Translation function
 * @param {boolean} isSuperAdmin - Whether current user is super admin
 * @param {string} currentUserEmail - Current user's email (for protection checks)
 * @returns {array} Column configuration array
 */
export const getUserTableColumns = (t, isSuperAdmin, currentUserEmail) => {
  const columns = [
    {
      key: 'email',
      label: t('users.table.email'),
      width: '25%',
      render: (value, row) => (
        <div className="flex items-center gap-2 sm:gap-3">
          <UserAvatar
            email={value}
            fullName={row.full_name}
            avatarUrl={row.avatar_url}
            size="md"
          />
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-medium text-gray-900 truncate">{value}</div>
            <div className="text-xs text-gray-500 truncate">{row.full_name || '-'}</div>
          </div>
        </div>
      )
    },
    {
      key: 'role',
      label: t('users.table.role'),
      width: '20%',
      render: (value, row) => {
        const isSuperAdminUser = SUPER_ADMIN_EMAILS.includes(row.email);
        if (isSuperAdminUser) {
          return (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
              <Shield className="w-3 h-3 mr-1" />
              {t('users.superAdmin')}
            </span>
          );
        }
        if (!isSuperAdmin) {
          return (
            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(value)}`}>
              {t(`users.roles.${value || 'user'}`)}
            </span>
          );
        }
        return (
          <select
            value={value || 'user'}
            onChange={() => {}} // Handler passed from parent
            className={`px-3 py-1 rounded-full text-xs font-medium border-0 focus:ring-2 focus:ring-blue-500 ${getRoleBadgeColor(value)}`}
          >
            <option value="user">{t('users.roles.user')}</option>
            <option value="admin">{t('users.roles.admin')}</option>
          </select>
        );
      }
    },
    {
      key: 'category_name',
      label: t('users.table.category'),
      width: '15%',
      render: (value, row) => {
        const isSuperAdminUser = SUPER_ADMIN_EMAILS.includes(row.email);
        if (isSuperAdminUser) {
          return (
            <span className="text-xs text-gray-400 italic">
              {t('users.protected')}
            </span>
          );
        }
        if (!isSuperAdmin) {
          return <CategoryBadge categoryName={value || 'regular'} readOnly />;
        }
        return (
          <select
            value={value || ''}
            onChange={() => {}} // Handler passed from parent
            className="px-2 py-1 rounded text-xs border border-gray-300 focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('users.categories.selectCategory')}</option>
          </select>
        );
      }
    },
    {
      key: 'is_enabled',
      label: t('users.table.status'),
      width: '12%',
      render: (value) => (
        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
          value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {value ? t('users.table.active') : t('users.table.inactive')}
        </span>
      )
    }
  ];

  // Add actions column only if super admin
  if (isSuperAdmin) {
    columns.push({
      key: 'id',
      label: t('users.table.actions'),
      width: '20%',
      render: (value, row) => {
        const isSuperAdminUser = SUPER_ADMIN_EMAILS.includes(row.email);
        if (isSuperAdminUser) {
          return (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 italic flex items-center gap-1">
                <Shield className="w-3 h-3" />
                {t('users.protected')}
              </span>
            </div>
          );
        }
        return (
          <div className="flex items-center justify-end gap-2">
            <button
              className="text-blue-600 hover:text-blue-900 inline-flex items-center gap-1"
              title={t('users.table.actions')}
            >
              {/* Actions will be handled by parent component */}
            </button>
          </div>
        );
      }
    });
  }

  return columns;
};

/**
 * Get modal columns for detailed user view
 * @param {function} t - Translation function
 * @returns {array} Column configuration for modal
 */
export const getUserModalColumns = (t) => [
  { key: 'email', label: t('users.table.email') },
  { key: 'full_name', label: t('users.table.name') },
  { key: 'role', label: t('users.table.role') },
  { key: 'category_name', label: t('users.table.category') },
  { key: 'is_enabled', label: t('users.table.status') },
  { key: 'created_at', label: t('common.createdAt') }
];

/**
 * Get role badge color
 */
function getRoleBadgeColor(role) {
  switch (role) {
    case 'super_admin':
      return 'bg-purple-100 text-purple-800';
    case 'admin':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export { getRoleBadgeColor };
