import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, Shield, UserCheck, UserX, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/DataTable';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle } from '@/lib/styleUtils';

const SUPER_ADMIN_EMAILS = ['jtheoden@gmail.com', 'jtheoden@googlemail.com'];

const UserManagement = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { visualSettings } = useBusiness();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, email, role, is_enabled, full_name, avatar_url, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast({
        title: t('users.fetchError'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (userId, newRole) => {
    try {
      const targetUser = users.find(u => u.id === userId);
      if (SUPER_ADMIN_EMAILS.includes(targetUser?.email)) {
        throw new Error(t('users.cannotModifySuperAdmin'));
      }

      const { error } = await supabase
        .from('user_profiles')
        .update({ role: newRole })
        .eq('id', userId);

      if (error) throw error;

      await fetchUsers();
      toast({
        title: t('users.roleUpdated'),
        description: t('users.roleUpdatedSuccess'),
      });
    } catch (error) {
      console.error('Error updating user role:', error);
      toast({
        title: t('users.roleUpdateError'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleToggleUserStatus = async (userId, isEnabled) => {
    try {
      const targetUser = users.find(u => u.id === userId);
      if (SUPER_ADMIN_EMAILS.includes(targetUser?.email)) {
        throw new Error(t('users.cannotModifySuperAdmin'));
      }

      const { error } = await supabase
        .from('user_profiles')
        .update({ is_enabled: isEnabled })
        .eq('id', userId);

      if (error) throw error;

      await fetchUsers();
      toast({
        title: isEnabled ? t('users.userEnabled') : t('users.userDisabled'),
        description: t('users.statusUpdateSuccess'),
      });
    } catch (error) {
      console.error('Error updating user status:', error);
      toast({
        title: t('users.statusUpdateError'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteUser = async (userId) => {
    const targetUser = users.find(u => u.id === userId);

    // Prevent deletion of super admin
    if (SUPER_ADMIN_EMAILS.includes(targetUser?.email)) {
      toast({
        title: t('users.deleteError'),
        description: t('users.cannotModifySuperAdmin'),
        variant: "destructive",
      });
      return;
    }

    // Confirm deletion
    const confirmMessage = t('users.confirmDelete', { email: targetUser?.email });
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      // Delete from user_profiles
      const { error: profileError } = await supabase
        .from('user_profiles')
        .delete()
        .eq('id', userId);

      if (profileError) throw profileError;

      // Delete from auth.users (admin API)
      const { error: authError } = await supabase.auth.admin.deleteUser(userId);

      if (authError) {
        console.warn('Could not delete from auth.users:', authError);
        // Continue anyway as profile was deleted
      }

      await fetchUsers();
      toast({
        title: t('users.userDeleted'),
        description: t('users.userDeletedSuccess'),
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      toast({
        title: t('users.deleteError'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(user?.email);

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case 'super_admin': return 'bg-purple-100 text-purple-800';
      case 'admin': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // DataTable columns configuration
  const columns = [
    {
      key: 'email',
      label: t('users.table.email'),
      width: '25%',
      render: (value, row) => (
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center text-white text-xs font-semibold">
            {value?.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm">{value}</span>
        </div>
      )
    },
    {
      key: 'full_name',
      label: t('users.table.name'),
      width: '20%',
      render: (value) => <span className="text-sm">{value || '-'}</span>
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
            onChange={(e) => handleRoleChange(row.id, e.target.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium border-0 focus:ring-2 focus:ring-blue-500 ${getRoleBadgeColor(value)}`}
          >
            <option value="user">{t('users.roles.user')}</option>
            <option value="admin">{t('users.roles.admin')}</option>
          </select>
        );
      }
    },
    {
      key: 'is_enabled',
      label: t('users.table.status'),
      width: '15%',
      render: (value) => (
        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
          value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {value ? t('users.table.active') : t('users.table.inactive')}
        </span>
      )
    },
    {
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
        if (!isSuperAdmin) return null;
        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant={row.is_enabled ? "outline" : "default"}
              size="sm"
              onClick={() => handleToggleUserStatus(row.id, !row.is_enabled)}
              title={row.is_enabled ? t('users.disableUser') : t('users.enableUser')}
            >
              {row.is_enabled ? (
                <>
                  <UserX className="w-4 h-4" />
                  {t('users.disable')}
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  {t('users.enable')}
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDeleteUser(row.id)}
              style={{
                backgroundColor: visualSettings.destructiveBgColor || '#dc2626',
                color: visualSettings.destructiveTextColor || '#ffffff',
                borderColor: visualSettings.destructiveBgColor || '#dc2626'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = visualSettings.destructiveHoverBgColor || '#b91c1c'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = visualSettings.destructiveBgColor || '#dc2626'}
              title={t('users.deleteUser')}
            >
              <Trash2 className="w-4 h-4" />
              {t('users.delete')}
            </Button>
          </div>
        );
      }
    }
  ];

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container mx-auto max-w-7xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-4xl font-bold mb-2" style={getHeadingStyle(visualSettings)}>
            {t('users.management')}
          </h1>
          <p className="text-gray-600 mb-4">
            {t('users.managementDescription')}
          </p>

          {/* Stats */}
          <div className="flex gap-4 text-sm">
            <div className="px-4 py-2 glass-effect rounded-xl">
              <span className="text-gray-600">{t('users.total')}:</span>
              <span className="ml-2 font-bold">{users.length}</span>
            </div>
            <div className="px-4 py-2 glass-effect rounded-xl">
              <span className="text-gray-600">{t('users.table.active')}:</span>
              <span className="ml-2 font-bold text-green-600">
                {users.filter(u => u.is_enabled).length}
              </span>
            </div>
          </div>
        </motion.div>

        {/* DataTable Component */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <DataTable
            columns={columns}
            data={users}
            loading={loading}
            emptyMessage={t('users.noUsers')}
            searchPlaceholder={`${t('users.table.email')}, ${t('users.table.name')}...`}
            searchFields={['email', 'full_name']}
            onRefresh={fetchUsers}
            pageSize={10}
            accentColor={visualSettings.primaryColor || 'blue'}
          />
        </motion.div>

        {/* Info Cards */}
        <div className="mt-6 grid md:grid-cols-2 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="p-4 bg-blue-50 border border-blue-200 rounded-xl"
          >
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">{t('users.rolesPermissions.title')}:</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li><strong>{t('users.roles.user')}:</strong> {t('users.rolesPermissions.userDesc')}</li>
                  <li><strong>{t('users.roles.admin')}:</strong> {t('users.rolesPermissions.adminDesc')}</li>
                  <li><strong>{t('users.roles.super_admin')}:</strong> {t('users.rolesPermissions.superAdminDesc')}</li>
                </ul>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="p-4 bg-amber-50 border border-amber-200 rounded-xl"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-semibold mb-1">{t('users.securityNote.title')}:</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>{t('users.securityNote.superAdminProtected')}</li>
                  <li>{t('users.securityNote.onlySuperAdminManage')}</li>
                  <li>{t('users.securityNote.deletionPermanent')}</li>
                </ul>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;
