// src/components/withProtectedRoute.jsx
import { useAuth } from '@/contexts/AuthContext';
import AuthLoadingScreen from '@/components/AuthLoadingScreen';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * withProtectedRoute(WrappedComponent, requiredRole)
 * - requiredRole: 'admin' | 'super_admin' | 'user' | undefined
 */
export const withProtectedRoute = (WrappedComponent, requiredRole) => {
  const ProtectedWrapper = (props) => {
    let user, authLoading, checkRole, userRole, roleStatus, roleRetryExhausted, roleFetchFailed, roleVerifyTimedOut, retryRoleResolution;
    const { t } = useLanguage();

    try {
      const auth = useAuth();
      user = auth.user;
      authLoading = auth.loading;
      checkRole = auth.checkRole;
      userRole = auth.userRole;
      roleStatus = auth.roleStatus;
      roleRetryExhausted = auth.roleRetryExhausted;
      roleFetchFailed = auth.roleFetchFailed;
      roleVerifyTimedOut = auth.roleVerifyTimedOut;
      retryRoleResolution = auth.retryRoleResolution;
    } catch (error) {
      // During hot module replacement, AuthContext might not be available yet
      if (import.meta.env.DEV) {
        return null;
      }
      throw error;
    }

    // Show loading while auth is initializing
    if (authLoading) {
      return <AuthLoadingScreen />;
    }

    // Check if user is authenticated
    if (!user) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="glass-effect p-8 rounded-2xl text-center max-w-lg">
            <h2 className="text-2xl font-bold mb-2">Autenticación requerida</h2>
            <p className="text-gray-600">Debes iniciar sesión para acceder a esta página.</p>
          </div>
        </div>
      );
    }

    // Check role permissions (synchronous now)
    // A provisional (cached) role is only a UI hint: it may open admin routes, but never
    // super_admin ones, so a super_admin page is not mounted on a hint and replaced later.
    const provisionalBlocks = roleStatus === 'provisional' && requiredRole === 'super_admin';
    const hasAccess = checkRole(requiredRole) && !provisionalBlocks;

    // Denying on a role that is not confirmed yet would lock an admin out on a slow link.
    // Spinner only while the first fetch is running and within the total budget
    // (TIMEOUTS.ROLE_VERIFY_MAX); then deny with a retry button (background retries keep
    // running and re-grant access when the profile arrives).
    const unconfirmed = Boolean(roleStatus) && roleStatus !== 'resolved';
    const giveUp = roleRetryExhausted || roleVerifyTimedOut || roleFetchFailed;
    if (!hasAccess && unconfirmed && !giveUp) {
      return <AuthLoadingScreen loadingMessage={t('auth.verifyingPermissions')} />;
    }

    if (!hasAccess) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="glass-effect p-8 rounded-2xl text-center max-w-lg">
            <h2 className="text-2xl font-bold mb-2">Acceso restringido</h2>
            <p className="text-gray-600">
              No tienes permisos para ver esta página. Rol requerido: {requiredRole}. Tu rol: {userRole || 'ninguno'}.
            </p>
            {unconfirmed && (
              <button
                type="button"
                onClick={retryRoleResolution}
                className="mt-4 rounded-md bg-gray-900 px-4 py-2 font-medium text-white"
              >
                {t('auth.roleRetry')}
              </button>
            )}
          </div>
        </div>
      );
    }

    // User has access - render the component
    return <WrappedComponent {...props} />;
  };

  return ProtectedWrapper;
};

export default withProtectedRoute;
