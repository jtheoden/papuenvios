import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, Shield, UserCheck, UserX, RefreshCw, Search, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

  const filteredUsers = users.filter(u =>
    u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case 'super_admin': return 'bg-purple-100 text-purple-800';
      case 'admin': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container mx-auto max-w-7xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold mb-2" style={getHeadingStyle(visualSettings)}>
                {t('users.management')}
              </h1>
              <p className="text-gray-600">
                {t('users.managementDescription')}
              </p>
            </div>
            <Button
              onClick={fetchUsers}
              disabled={loading}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {t('users.refresh')}
            </Button>
          </div>

          {/* Search and Stats */}
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder={`${t('users.table.email')}, ${t('users.table.name')}...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

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
          </div>
        </motion.div>

        {/* Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-effect rounded-2xl overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {t('users.table.email')}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {t('users.table.name')}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {t('users.table.role')}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {t('users.table.status')}
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {t('users.table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-12 text-center">
                      <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400 mb-2" />
                      <p className="text-gray-500">{t('users.loadingUsers')}</p>
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-12 text-center">
                      <Users className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                      <p className="text-gray-500">
                        {searchTerm ? t('users.noUsersFound') : t('users.noUsers')}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((userItem, index) => {
                    const isSuperAdminUser = SUPER_ADMIN_EMAILS.includes(userItem.email);
                    return (
                      <motion.tr
                        key={userItem.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="hover:bg-gray-50"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10">
                              <div className="h-10 w-10 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center text-white font-semibold">
                                {userItem.email?.charAt(0).toUpperCase()}
                              </div>
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">
                                {userItem.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            {userItem.full_name || '-'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {isSuperAdminUser ? (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                              <Shield className="w-3 h-3 mr-1" />
                              {t('users.superAdmin')}
                            </span>
                          ) : isSuperAdmin ? (
                            <select
                              value={userItem.role || 'user'}
                              onChange={(e) => handleRoleChange(userItem.id, e.target.value)}
                              className={`px-3 py-1 rounded-full text-xs font-medium border-0 focus:ring-2 focus:ring-blue-500 ${getRoleBadgeColor(userItem.role)}`}
                            >
                              <option value="user">{t('users.roles.user')}</option>
                              <option value="admin">{t('users.roles.admin')}</option>
                            </select>
                          ) : (
                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(userItem.role)}`}>
                              {t(`users.roles.${userItem.role || 'user'}`)}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
                            userItem.is_enabled
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {userItem.is_enabled ? t('users.table.active') : t('users.table.inactive')}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {!isSuperAdminUser && isSuperAdmin && (
                              <>
                                {/* Toggle Status Button */}
                                <Button
                                  variant={userItem.is_enabled ? "outline" : "default"}
                                  size="sm"
                                  onClick={() => handleToggleUserStatus(userItem.id, !userItem.is_enabled)}
                                  className="flex items-center gap-2"
                                  title={userItem.is_enabled ? t('users.disableUser') : t('users.enableUser')}
                                >
                                  {userItem.is_enabled ? (
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

                                {/* Delete Button */}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteUser(userItem.id)}
                                  className="flex items-center gap-2"
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
                              </>
                            )}
                            {isSuperAdminUser && (
                              <span className="text-xs text-gray-400 italic flex items-center gap-1">
                                <Shield className="w-3 h-3" />
                                {t('users.protected')}
                              </span>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
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
