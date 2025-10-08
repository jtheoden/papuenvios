// src/components/withProtectedRoute.jsx
import { useAuth } from '@/contexts/AuthContext';
import AuthLoadingScreen from '@/components/AuthLoadingScreen';

/**
 * withProtectedRoute(WrappedComponent, requiredRole)
 * - requiredRole: 'admin' | 'super_admin' | 'user' | undefined
 */
export const withProtectedRoute = (WrappedComponent, requiredRole) => {
  const ProtectedWrapper = (props) => {
    const { user, loading: authLoading, checkRole, userRole } = useAuth();

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
    const hasAccess = checkRole(requiredRole);

    if (!hasAccess) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="glass-effect p-8 rounded-2xl text-center max-w-lg">
            <h2 className="text-2xl font-bold mb-2">Acceso restringido</h2>
            <p className="text-gray-600">
              No tienes permisos para ver esta página. Rol requerido: {requiredRole}. Tu rol: {userRole || 'ninguno'}.
            </p>
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
