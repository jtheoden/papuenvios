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

  const logUserManagementAction = async (action, details = {}, tab = activeTab) => {
    const logPayload = {
      scope: 'UserManagement',
      action,
      tab,
      timestamp: new Date().toISOString(),
      userEmail: user?.email || 'unknown',
      ...details
    };

    console.info('[OBS]', logPayload);

    // Store activity in database
    const { logActivity } = await import('@/lib/activityLogger');
    await logActivity({
      action: `user_management_${action}`,
      entityType: 'user_management',
      entityId: details.userId || null,
      performedBy: user?.email || user?.id,
      description: `User Management: ${action} on ${tab} tab`,
      metadata: details
    });
  };

  const fetchUsers = async () => {
    console.log('[fetchUsers] START - Loading users from database');
    logUserManagementAction('fetch_users_start');
    setLoading(true);
    try {
      console.log('[fetchUsers] Fetching user profiles...');
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, email, role, is_enabled, full_name, avatar_url, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;

      console.log('[fetchUsers] User profiles fetched:', { count: data?.length || 0 });

      // Fetch categories for each user
      if (data && data.length > 0) {
        console.log('[fetchUsers] Fetching user categories...');
        const { data: categoriesData } = await supabase
          .from('user_categories')
          .select('user_id, category_name')
          .in('user_id', data.map(u => u.id));

        console.log('[fetchUsers] User categories fetched:', { count: categoriesData?.length || 0 });

        // Map categories to users
        const categoryMap = {};
        if (categoriesData) {
          categoriesData.forEach(cat => {
            categoryMap[cat.user_id] = cat.category_name;
          });
        }

        console.log('[fetchUsers] Mapping categories to users...');
        // Add category_name to each user
        const usersWithCategories = data.map(user => ({
          ...user,
          category_name: categoryMap[user.id] || null
        }));

        setUsers(usersWithCategories);
        console.log('[fetchUsers] Users with categories set:', { count: usersWithCategories.length });
      } else {
        setUsers(data || []);
        console.log('[fetchUsers] No users found or empty data');
      }

      console.log('[fetchUsers] SUCCESS - Users loaded successfully');
      logUserManagementAction('fetch_users_success', { userCount: data?.length || 0 });
    } catch (error) {
      console.error('[fetchUsers] ERROR:', error);
      console.error('[fetchUsers] Error details:', { message: error?.message, code: error?.code });
      logUserManagementAction('fetch_users_error', { message: error.message });
      toast({
        title: t('users.fetchError'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      console.log('[fetchUsers] Loading state set to false');
    }
  };

  const fetchCategoryData = async () => {
    console.log('[fetchCategoryData] START - Loading category data');
    try {
      console.log('[fetchCategoryData] Fetching rules and discounts in parallel...');
      const [rulesData, discountsData] = await Promise.all([
        getCategoryRules(),
        getCategoryDiscounts()
      ]);
      console.log('[fetchCategoryData] Data fetched:', {
        rulesCount: rulesData?.length || 0,
        discountsCount: discountsData?.length || 0
      });
      setCategoryRules(rulesData || []);
      setCategoryDiscounts(discountsData || []);
      console.log('[fetchCategoryData] SUCCESS - Category data loaded');
      logUserManagementAction('fetch_categories_success', {
        rulesCount: rulesData?.length || 0,
        discountsCount: discountsData?.length || 0
      }, 'categories');
    } catch (error) {
      console.error('[fetchCategoryData] ERROR:', error);
      console.error('[fetchCategoryData] Error details:', { message: error?.message, code: error?.code });
      logUserManagementAction('fetch_categories_error', { message: error.message }, 'categories');
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
    console.log('[handleRoleChange] START - Input:', { userId, newRole });
    try {
      console.log('[handleRoleChange] Finding target user...');
      const targetUser = users.find(u => u.id === userId);
      console.log('[handleRoleChange] Target user found:', {
        userId,
        email: targetUser?.email,
        currentRole: targetUser?.role
      });

      if (targetUser?.role === 'super_admin') {
        console.warn('[handleRoleChange] BLOCKED - Cannot modify super admin:', targetUser?.email);
        throw new Error(t('users.cannotModifySuperAdmin'));
      }

      logUserManagementAction('update_role_start', { userId, newRole });

      console.log('[handleRoleChange] Updating user role in database...');
      const { error } = await supabase
        .from('user_profiles')
        .update({ role: newRole })
        .eq('id', userId);

      if (error) throw error;

      console.log('[handleRoleChange] Database update successful, refreshing users...');
      await fetchUsers();
      console.log('[handleRoleChange] SUCCESS - Role updated from', targetUser?.role, 'to', newRole);
      logUserManagementAction('update_role_success', { userId, newRole });
      toast({
        title: t('users.roleUpdated'),
        description: t('users.roleUpdatedSuccess'),
      });
    } catch (error) {
      console.error('[handleRoleChange] ERROR:', error);
      console.error('[handleRoleChange] Error details:', { message: error?.message, code: error?.code, userId, newRole });
      logUserManagementAction('update_role_error', { userId, message: error.message });
      toast({
        title: t('users.roleUpdateError'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleToggleUserStatus = async (userId, isEnabled) => {
    console.log('[handleToggleUserStatus] START - Input:', { userId, isEnabled });
    try {
      console.log('[handleToggleUserStatus] Finding target user...');
      const targetUser = users.find(u => u.id === userId);
      console.log('[handleToggleUserStatus] Target user found:', {
        userId,
        email: targetUser?.email,
        currentStatus: targetUser?.is_enabled
      });

      if (targetUser?.role === 'super_admin') {
        console.warn('[handleToggleUserStatus] BLOCKED - Cannot modify super admin:', targetUser?.email);
        throw new Error(t('users.cannotModifySuperAdmin'));
      }

      logUserManagementAction('toggle_user_status_start', { userId, enable: isEnabled });

      console.log('[handleToggleUserStatus] Updating user status in database...');
      const { error } = await supabase
        .from('user_profiles')
        .update({ is_enabled: isEnabled })
        .eq('id', userId);

      if (error) throw error;

      console.log('[handleToggleUserStatus] Database update successful, refreshing users...');
      await fetchUsers();
      console.log('[handleToggleUserStatus] SUCCESS - Status updated from', targetUser?.is_enabled, 'to', isEnabled);
      logUserManagementAction('toggle_user_status_success', { userId, enable: isEnabled });
      toast({
        title: isEnabled ? t('users.userEnabled') : t('users.userDisabled'),
        description: t('users.statusUpdateSuccess'),
      });
    } catch (error) {
      console.error('[handleToggleUserStatus] ERROR:', error);
      console.error('[handleToggleUserStatus] Error details:', { message: error?.message, code: error?.code, userId, isEnabled });
      logUserManagementAction('toggle_user_status_error', { userId, message: error.message });
      toast({
        title: t('users.statusUpdateError'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteUser = async (userId) => {
    console.log('[handleDeleteUser] START - Input:', { userId });
    const targetUser = users.find(u => u.id === userId);
    console.log('[handleDeleteUser] Target user found:', {
      userId,
      email: targetUser?.email,
      role: targetUser?.role,
      isEnabled: targetUser?.is_enabled
    });

    // Prevent deletion of super admin
    if (targetUser?.role === 'super_admin') {
      console.warn('[handleDeleteUser] BLOCKED - Cannot delete super admin:', targetUser?.email);
      logUserManagementAction('delete_user_blocked_super_admin', { userId });
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
      console.log('[handleDeleteUser] User cancelled deletion');
      logUserManagementAction('delete_user_cancelled', { userId });
      return;
    }

    try {
      console.log('[handleDeleteUser] User confirmed deletion, proceeding...');
      logUserManagementAction('delete_user_start', { userId });

      // Delete from user_profiles
      console.log('[handleDeleteUser] Deleting from user_profiles table...');
      const { error: profileError } = await supabase
        .from('user_profiles')
        .delete()
        .eq('id', userId);

      if (profileError) throw profileError;
      console.log('[handleDeleteUser] User profile deleted successfully');

      // Delete from auth.users (admin API)
      console.log('[handleDeleteUser] Deleting from auth.users...');
      const { error: authError } = await supabase.auth.admin.deleteUser(userId);

      if (authError) {
        console.warn('[handleDeleteUser] Could not delete from auth.users:', authError);
        console.warn('[handleDeleteUser] Error details:', {
          message: authError?.message,
          code: authError?.code
        });
        // Continue anyway as profile was deleted
      } else {
        console.log('[handleDeleteUser] Auth user deleted successfully');
      }

      console.log('[handleDeleteUser] Refreshing users list...');
      await fetchUsers();
      console.log('[handleDeleteUser] SUCCESS - User deleted:', { userId, email: targetUser?.email });
      logUserManagementAction('delete_user_success', { userId });
      toast({
        title: t('users.userDeleted'),
        description: t('users.userDeletedSuccess'),
      });
    } catch (error) {
      console.error('[handleDeleteUser] ERROR:', error);
      console.error('[handleDeleteUser] Error details:', { message: error?.message, code: error?.code, userId });
      logUserManagementAction('delete_user_error', { userId, message: error.message });
      toast({
        title: t('users.deleteError'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleCategoryChange = async (userId, newCategoryName) => {
    console.log('[handleCategoryChange] START - Input:', { userId, newCategoryName });
    try {
      if (!newCategoryName) {
        console.warn('[handleCategoryChange] VALIDATION ERROR - No category name provided');
        throw new Error(t('users.categories.selectCategory'));
      }

      console.log('[handleCategoryChange] Validation passed, finding target user...');
      const targetUser = users.find(u => u.id === userId);
      console.log('[handleCategoryChange] Target user:', {
        userId,
        email: targetUser?.email,
        currentCategory: targetUser?.category_name
      });

      logUserManagementAction('update_category_start', { userId, category: newCategoryName }, 'categories');

      console.log('[handleCategoryChange] Upserting category assignment...');
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
      console.log('[handleCategoryChange] Category assignment successful');

      console.log('[handleCategoryChange] Refreshing users list...');
      await fetchUsers();
      console.log('[handleCategoryChange] SUCCESS - Category updated from', targetUser?.category_name, 'to', newCategoryName);
      logUserManagementAction('update_category_success', { userId, category: newCategoryName }, 'categories');
      toast({
        title: t('users.categories.categoryUpdated'),
        description: t('users.categories.categoryUpdateSuccess'),
      });
    } catch (error) {
      console.error('[handleCategoryChange] ERROR:', error);
      console.error('[handleCategoryChange] Error details:', { message: error?.message, code: error?.code, userId, newCategoryName });
      logUserManagementAction('update_category_error', { userId, message: error.message }, 'categories');
      toast({
        title: t('users.categories.categoryUpdateError'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleRecalculateAll = async () => {
    console.log('[handleRecalculateAll] START - User requested category recalculation');
    if (!window.confirm(t('users.categories.confirmRecalculateAll'))) {
      console.log('[handleRecalculateAll] User cancelled recalculation');
      logUserManagementAction('recalculate_all_cancelled', {}, 'categories');
      return;
    }

    console.log('[handleRecalculateAll] User confirmed, starting recalculation...');
    setRecalculatingAll(true);
    try {
      logUserManagementAction('recalculate_all_start', {}, 'categories');
      console.log('[handleRecalculateAll] Calling recalculateAllCategories service...');
      const result = await recalculateAllCategories();
      console.log('[handleRecalculateAll] Recalculation complete:', {
        processed: result.processed,
        total: result.total,
        successRate: `${Math.round((result.processed / result.total) * 100)}%`
      });
      setLastRecalculateTime(new Date());

      toast({
        title: t('users.categories.recalculateSuccess'),
        description: t('users.categories.recalculateSuccessDesc', {
          processed: result.processed,
          total: result.total
        }),
      });

      logUserManagementAction('recalculate_all_success', {
        processed: result.processed,
        total: result.total
      }, 'categories');

      console.log('[handleRecalculateAll] Refreshing users list...');
      await fetchUsers();
      console.log('[handleRecalculateAll] SUCCESS - Recalculation completed');
    } catch (error) {
      console.error('[handleRecalculateAll] ERROR:', error);
      console.error('[handleRecalculateAll] Error details:', { message: error?.message, code: error?.code });
      logUserManagementAction('recalculate_all_error', { message: error.message }, 'categories');
      toast({
        title: t('users.categories.recalculateError'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setRecalculatingAll(false);
      console.log('[handleRecalculateAll] Recalculation state reset');
    }
  };

  const handleEditDiscount = (discount) => {
    console.log('[handleEditDiscount] START - Input:', {
      discountId: discount.id,
      category: discount.category_name,
      currentPercentage: discount.discount_percentage
    });
    setEditingDiscountId(discount.id);
    setEditingDiscountData({
      discount_percentage: discount.discount_percentage,
      discount_description: discount.discount_description || '',
      enabled: discount.enabled
    });
    console.log('[handleEditDiscount] Edit mode activated for discount:', discount.id);
    logUserManagementAction('edit_discount_start', { category: discount.category_name }, 'categories');
  };

  const handleCancelEditDiscount = () => {
    console.log('[handleCancelEditDiscount] START - Cancelling discount edit');
    console.log('[handleCancelEditDiscount] Clearing editing state');
    setEditingDiscountId(null);
    setEditingDiscountData(null);
    console.log('[handleCancelEditDiscount] SUCCESS - Edit cancelled');
    logUserManagementAction('edit_discount_cancelled', {}, 'categories');
  };

  const handleSaveDiscount = async (categoryName) => {
    console.log('[handleSaveDiscount] START - Input:', { categoryName, editingDiscountData });
    if (!editingDiscountData) {
      console.warn('[handleSaveDiscount] No discount data to save, returning');
      return;
    }

    console.log('[handleSaveDiscount] Validating discount data...');
    console.log('[handleSaveDiscount] Data to save:', {
      category: categoryName,
      percentage: editingDiscountData.discount_percentage,
      description: editingDiscountData.discount_description,
      enabled: editingDiscountData.enabled
    });

    logUserManagementAction('save_discount_start', { category: categoryName }, 'categories');

    try {
      console.log('[handleSaveDiscount] Calling updateCategoryDiscount service...');
      await updateCategoryDiscount(categoryName, editingDiscountData);
      console.log('[handleSaveDiscount] Discount update successful');

      toast({
        title: t('common.success'),
        description: t('users.categories.discountUpdated') || 'Discount updated successfully'
      });

      logUserManagementAction('save_discount_success', { category: categoryName }, 'categories');

      // Reload discounts
      console.log('[handleSaveDiscount] Reloading category discounts...');
      const discountsData = await getCategoryDiscounts();
      console.log('[handleSaveDiscount] Discounts reloaded:', { count: discountsData?.length || 0 });
      setCategoryDiscounts(discountsData || []);

      // Clear editing state
      console.log('[handleSaveDiscount] Clearing editing state...');
      setEditingDiscountId(null);
      setEditingDiscountData(null);
      console.log('[handleSaveDiscount] SUCCESS - Discount saved and edit mode cleared');
    } catch (error) {
      console.error('[handleSaveDiscount] ERROR:', error);
      console.error('[handleSaveDiscount] Error details:', { message: error?.message, code: error?.code, categoryName });
      logUserManagementAction('save_discount_error', { category: categoryName, message: error.message }, 'categories');
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const isSuperAdmin = user?.role === 'super_admin';
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
          const isSuperAdminUser = row.role === 'super_admin';
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
              onChange={(e) => {
                console.log('[RoleSelect onChange] Role change requested:', {
                  userId: row.id,
                  oldRole: value,
                  newRole: e.target.value
                });
                handleRoleChange(row.id, e.target.value);
              }}
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
          const isSuperAdminUser = row.role === 'super_admin';
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
            const isSuperAdminUser = row.role === 'super_admin';
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
          <div className="text-lg sm:text-2xl font-bold text-purple-600">{users.filter(u => u.role === 'super_admin').length}</div>
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
            console.log('[onRowClick] User row clicked:', {
              userId: user.id,
              email: user.email,
              role: user.role
            });
            logUserManagementAction('open_user_modal', { userId: user.id });
            setSelectedUser(user);
            setShowUserModal(true);
            console.log('[onRowClick] User modal opened');
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
            console.log('[UserModal onClose] Closing user detail modal for user:', selectedUser.id);
            setShowUserModal(false);
            setTimeout(() => setSelectedUser(null), 300);
            console.log('[UserModal onClose] Modal closed');
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
            onTabChange={(tab) => {
              console.log('[onTabChange] Tab changed from', activeTab, 'to', tab);
              logUserManagementAction('tab_change', { to: tab }, tab);
              setActiveTab(tab);
            }}
          />
        </motion.div>
      </div>
    </div>
  );
};

export default UserManagement;
