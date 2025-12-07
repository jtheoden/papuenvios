import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Users, Shield, UserCheck, UserX, Trash2, AlertCircle, BarChart3, Settings, Edit, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle } from '@/lib/styleUtils';
import TabsResponsive from '@/components/TabsResponsive';
import CategoryBadge from '@/components/CategoryBadge';
import UserAvatar from '@/components/avatars/UserAvatar';
import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';
import TableDetailModal from '@/components/modals/TableDetailModal';
import { getUserTableColumns, getUserModalColumns } from '@/components/admin/UserTableConfig';
import { getCategoryRules, getCategoryDiscounts, recalculateAllCategories, updateCategoryDiscount } from '@/lib/userCategorizationService';

const SUPER_ADMIN_EMAILS = ['jtheoden@googlemail.com', 'elpapuedition@gmail.com'];

const UserManagement = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { visualSettings } = useBusiness();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('users');
  const [categoryRules, setCategoryRules] = useState([]);
  const [categoryDiscounts, setCategoryDiscounts] = useState([]);
  const [recalculatingAll, setRecalculatingAll] = useState(false);
  const [lastRecalculateTime, setLastRecalculateTime] = useState(null);
  const [editingDiscountId, setEditingDiscountId] = useState(null);
  const [editingDiscountData, setEditingDiscountData] = useState(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, email, role, is_enabled, full_name, avatar_url, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch categories for each user
      if (data && data.length > 0) {
        const { data: categoriesData } = await supabase
          .from('user_categories')
          .select('user_id, category_name')
          .in('user_id', data.map(u => u.id));

        // Map categories to users
        const categoryMap = {};
        if (categoriesData) {
          categoriesData.forEach(cat => {
            categoryMap[cat.user_id] = cat.category_name;
          });
        }

        // Add category_name to each user
        const usersWithCategories = data.map(user => ({
          ...user,
          category_name: categoryMap[user.id] || null
        }));

        setUsers(usersWithCategories);
      } else {
        setUsers(data || []);
      }
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

  const fetchCategoryData = async () => {
    try {
      const [rulesData, discountsData] = await Promise.all([
        getCategoryRules(),
        getCategoryDiscounts()
      ]);
      setCategoryRules(rulesData || []);
      setCategoryDiscounts(discountsData || []);
    } catch (error) {
      console.error('Error fetching categorization data:', error);
      // Set empty arrays to prevent UI errors
      setCategoryRules([]);
      setCategoryDiscounts([]);
      // Only show toast if it's not a permission denied error (which is expected without RLS setup)
      if (error.message && !error.message.includes('permission denied')) {
        toast({
          title: t('users.categories.loadError'),
          description: error.message,
          variant: "destructive",
        });
      }
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchCategoryData();
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

  const handleCategoryChange = async (userId, newCategoryName) => {
    try {
      if (!newCategoryName) {
        throw new Error(t('users.categories.selectCategory'));
      }

      const { error } = await supabase
        .from('user_categories')
        .upsert({
          user_id: userId,
          category_name: newCategoryName,
          assigned_at: new Date().toISOString(),
          assigned_by: user?.id,
          assignment_reason: 'manual',
          effective_from: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (error) throw error;

      await fetchUsers();
      toast({
        title: t('users.categories.categoryUpdated'),
        description: t('users.categories.categoryUpdateSuccess'),
      });
    } catch (error) {
      console.error('Error updating user category:', error);
      toast({
        title: t('users.categories.categoryUpdateError'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleRecalculateAll = async () => {
    if (!window.confirm(t('users.categories.confirmRecalculateAll'))) {
      return;
    }

    setRecalculatingAll(true);
    try {
      const result = await recalculateAllCategories();
      setLastRecalculateTime(new Date());

      toast({
        title: t('users.categories.recalculateSuccess'),
        description: t('users.categories.recalculateSuccessDesc', {
          processed: result.processed,
          total: result.total
        }),
      });

      await fetchUsers();
    } catch (error) {
      console.error('Error recalculating categories:', error);
      toast({
        title: t('users.categories.recalculateError'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setRecalculatingAll(false);
    }
  };

  const handleEditDiscount = (discount) => {
    setEditingDiscountId(discount.id);
    setEditingDiscountData({
      discount_percentage: discount.discount_percentage,
      discount_description: discount.discount_description || '',
      enabled: discount.enabled
    });
  };

  const handleCancelEditDiscount = () => {
    setEditingDiscountId(null);
    setEditingDiscountData(null);
  };

  const handleSaveDiscount = async (categoryName) => {
    if (!editingDiscountData) return;

    try {
      await updateCategoryDiscount(categoryName, editingDiscountData);

      toast({
        title: t('common.success'),
        description: t('users.categories.discountUpdated') || 'Discount updated successfully'
      });

      // Reload discounts
      const discountsData = await getCategoryDiscounts();
      setCategoryDiscounts(discountsData || []);

      // Clear editing state
      setEditingDiscountId(null);
      setEditingDiscountData(null);
    } catch (error) {
      console.error('Error updating discount:', error);
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(user?.email);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserModal, setShowUserModal] = useState(false);

  // Get table columns with action handlers
  const userTableColumns = useMemo(() => {
    const baseColumns = getUserTableColumns(t, isSuperAdmin, user?.email);

    // Add role change handler
    const roleColumnIndex = baseColumns.findIndex(col => col.key === 'role');
    if (roleColumnIndex !== -1 && isSuperAdmin) {
      baseColumns[roleColumnIndex] = {
        ...baseColumns[roleColumnIndex],
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
          return (
            <select
              value={value || 'user'}
              onChange={(e) => handleRoleChange(row.id, e.target.value)}
              className="px-3 py-1 rounded-full text-xs font-medium border-0 focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-800"
            >
              <option value="user">{t('users.roles.user')}</option>
              <option value="admin">{t('users.roles.admin')}</option>
            </select>
          );
        }
      };
    }

    // Add category change handler
    const categoryColumnIndex = baseColumns.findIndex(col => col.key === 'category_name');
    if (categoryColumnIndex !== -1 && isSuperAdmin) {
      baseColumns[categoryColumnIndex] = {
        ...baseColumns[categoryColumnIndex],
        render: (value, row) => {
          const isSuperAdminUser = SUPER_ADMIN_EMAILS.includes(row.email);
          if (isSuperAdminUser) {
            return (
              <span className="text-xs text-gray-400 italic">
                {t('users.protected')}
              </span>
            );
          }
          return (
            <select
              value={value || ''}
              onChange={(e) => handleCategoryChange(row.id, e.target.value)}
              className="px-2 py-1 rounded text-xs border border-gray-300 focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('users.categories.selectCategory')}</option>
              {categoryRules && categoryRules.map((rule) => (
                <option key={rule.category_name} value={rule.category_name}>
                  {t(`users.categories.${rule.category_name}`)}
                </option>
              ))}
            </select>
          );
        }
      };
    }

    // Add action handlers to the actions column
    if (isSuperAdmin) {
      const actionsColumnIndex = baseColumns.findIndex(col => col.key === 'id');
      if (actionsColumnIndex !== -1) {
        baseColumns[actionsColumnIndex] = {
          ...baseColumns[actionsColumnIndex],
          render: (_, row) => {
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
        };
      }
    } else {
      // If not super admin, remove actions column
      return baseColumns.filter(col => col.key !== 'id');
    }

    return baseColumns;
  }, [t, isSuperAdmin, user?.email, visualSettings, categoryRules, handleRoleChange, handleCategoryChange, handleToggleUserStatus, handleDeleteUser]);

  const renderUsersTab = () => (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-6">
        <div className="glass-effect p-3 sm:p-4 rounded-xl">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">{t('users.total')}</div>
          <div className="text-lg sm:text-2xl font-bold text-gray-900">{users.length}</div>
        </div>
        <div className="glass-effect p-3 sm:p-4 rounded-xl">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">{t('users.table.active')}</div>
          <div className="text-lg sm:text-2xl font-bold text-green-600">{users.filter(u => u.is_enabled).length}</div>
        </div>
        <div className="glass-effect p-3 sm:p-4 rounded-xl">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">{t('users.roles.admin')}</div>
          <div className="text-lg sm:text-2xl font-bold text-blue-600">{users.filter(u => u.role === 'admin').length}</div>
        </div>
        <div className="glass-effect p-3 sm:p-4 rounded-xl">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">{t('users.superAdmin')}</div>
          <div className="text-lg sm:text-2xl font-bold text-purple-600">{users.filter(u => SUPER_ADMIN_EMAILS.includes(u.email)).length}</div>
        </div>
      </div>

      {/* Responsive Users Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <ResponsiveTableWrapper
          data={users}
          columns={userTableColumns}
          onRowClick={(user) => {
            setSelectedUser(user);
            setShowUserModal(true);
          }}
          isLoading={loading}
          modalTitle={t('users.detail')}
          modalColumns={getUserModalColumns(t)}
          emptyMessage={loading ? undefined : t('users.noUsers')}
        />
      </motion.div>

      {/* User Detail Modal */}
      {showUserModal && selectedUser && (
        <TableDetailModal
          isOpen={showUserModal}
          onClose={() => {
            setShowUserModal(false);
            setTimeout(() => setSelectedUser(null), 300);
          }}
          title={t('users.detail') || 'User Details'}
          data={selectedUser}
          columns={getUserModalColumns(t)}
          maxHeight="80vh"
        />
      )}

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
    </>
  );

  const renderCategoriesTab = () => (
    <div className="space-y-6">
      {/* Recalculate All Button */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-blue-900 mb-1">
              {t('users.categories.recalculateTitle')}
            </h3>
            <p className="text-sm text-blue-800">
              {t('users.categories.recalculateDesc')}
            </p>
            {lastRecalculateTime && (
              <p className="text-xs text-blue-700 mt-2">
                {t('users.categories.lastRecalculate')}: {new Date(lastRecalculateTime).toLocaleString()}
              </p>
            )}
          </div>
          <Button
            onClick={handleRecalculateAll}
            disabled={recalculatingAll}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {recalculatingAll ? t('common.processing') : t('users.categories.recalculate')}
          </Button>
        </div>
      </motion.div>

      {/* Category Rules */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-xl border border-gray-200 overflow-hidden"
      >
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            {t('users.categories.rulesTitle')}
          </h3>
        </div>
        <div className="p-4">
          {categoryRules && categoryRules.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700">
                      {t('users.categories.threshold')}
                    </th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700">
                      {t('users.categories.categoryName')}
                    </th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700">
                      {t('users.categories.status')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {categoryRules.map((rule) => (
                    <tr key={rule.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">{rule.interaction_threshold}</td>
                      <td className="px-4 py-3">
                        <CategoryBadge categoryName={rule.category_name} readOnly />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          rule.enabled
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {rule.enabled ? t('common.active') : t('common.inactive')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">{t('users.categories.noRules')}</p>
          )}
        </div>
      </motion.div>

      {/* Category Discounts */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white rounded-xl border border-gray-200 overflow-hidden"
      >
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-purple-600" />
            {t('users.categories.discountsTitle')}
          </h3>
        </div>
        <div className="p-4">
          {categoryDiscounts && categoryDiscounts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700">
                      {t('users.categories.categoryName')}
                    </th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700">
                      {t('users.categories.discountPercent')}
                    </th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700">
                      {t('users.categories.description')}
                    </th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700">
                      {t('users.categories.status')}
                    </th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {categoryDiscounts.map((discount) => {
                    const isEditing = editingDiscountId === discount.id;

                    return (
                      <tr key={discount.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <CategoryBadge categoryName={discount.category_name} readOnly />
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={editingDiscountData?.discount_percentage || 0}
                              onChange={(e) => setEditingDiscountData({
                                ...editingDiscountData,
                                discount_percentage: parseFloat(e.target.value) || 0
                              })}
                              className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <span className="font-semibold text-green-600">
                              {discount.discount_percentage}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingDiscountData?.discount_description || ''}
                              onChange={(e) => setEditingDiscountData({
                                ...editingDiscountData,
                                discount_description: e.target.value
                              })}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                              placeholder={t('users.categories.description')}
                            />
                          ) : (
                            <span className="text-gray-600">{discount.discount_description || '-'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <label className="inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editingDiscountData?.enabled || false}
                                onChange={(e) => setEditingDiscountData({
                                  ...editingDiscountData,
                                  enabled: e.target.checked
                                })}
                                className="sr-only peer"
                              />
                              <div className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                              <span className="ms-3 text-sm font-medium text-gray-900">
                                {editingDiscountData?.enabled ? t('common.active') : t('common.inactive')}
                              </span>
                            </label>
                          ) : (
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                              discount.enabled
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}>
                              {discount.enabled ? t('common.active') : t('common.inactive')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleSaveDiscount(discount.category_name)}
                                className="bg-green-600 hover:bg-green-700 text-white"
                              >
                                <Save className="w-4 h-4 mr-1" />
                                {t('common.save')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleCancelEditDiscount}
                              >
                                <X className="w-4 h-4 mr-1" />
                                {t('common.cancel')}
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditDiscount(discount)}
                            >
                              <Edit className="w-4 h-4 mr-1" />
                              {t('common.edit')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">{t('users.categories.noDiscounts')}</p>
          )}
        </div>
      </motion.div>
    </div>
  );

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
        </motion.div>

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <TabsResponsive
            tabs={[
              {
                id: 'users',
                label: t('users.tabs.users'),
                icon: <Users className="w-5 h-5" />,
                content: renderUsersTab()
              },
              {
                id: 'categories',
                label: t('users.tabs.categories'),
                icon: <BarChart3 className="w-5 h-5" />,
                content: renderCategoriesTab()
              }
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </motion.div>
      </div>
    </div>
  );
};

export default UserManagement;
