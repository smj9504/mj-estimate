import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { message } from 'antd';
import authService from '../services/authService';
import { getErrorMessage } from '../api/errorHandler';
import { opensScreen, screenForPath } from '../constants/screens';

export interface User {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  mobile_phone?: string;
  role: 'super_admin' | 'admin' | 'manager' | 'supervisor' | 'technician' | 'staff' | 'sales' | 'customer_service' | 'accountant' | 'viewer' | 'contractor';
  company_id?: string | null;
  staff_number?: string;
  is_active: boolean;
  is_verified?: boolean;
  can_login?: boolean;
  email_verified?: boolean;
  created_at: string;
  // The person's own screen list; null means they follow their role
  screen_access?: string[] | null;
  // Screens they may open (role defaults applied); sent with login and /me
  screens?: string[];
  // An admin reset the password; they choose their own before going on
  must_change_password?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: (showMessage?: boolean) => void;
  // After a password change: the server signs out every session and hands
  // this one a new token
  updateSession: (token: string, changes?: Partial<User>) => void;
  register: (data: RegisterData) => Promise<void>;
  isAdmin: () => boolean;
  isManager: () => boolean;
  hasPermission: (requiredRole: string) => boolean;
  canAccessPath: (pathname: string) => boolean;
}

interface RegisterData {
  username: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  staff_number: string;
  role?: string;
  hire_date?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load token and user from localStorage on mount
    const storedToken = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      authService.setAuthToken(storedToken);

      // Validate token by fetching current user
      authService.getCurrentUser()
        .then(userData => {
          setUser(userData);
          localStorage.setItem('auth_user', JSON.stringify(userData));
        })
        .catch((err) => {
          // Only logout on auth errors (401/403), not network errors
          const status = err?.response?.status;
          if (status === 401 || status === 403) {
            logout(false);
          }
          // Network errors (server down) → keep stored session
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      // No stored token/user, set loading to false immediately
      setLoading(false);
    }
  }, []);

  // Errors propagate: the sign-in page shows them beside the form
  const login = useCallback(async (username: string, password: string) => {
    const response = await authService.login(username, password);
    const { access_token, user: userData } = response;

    setToken(access_token);
    setUser(userData);

    localStorage.setItem('auth_token', access_token);
    localStorage.setItem('auth_user', JSON.stringify(userData));

    authService.setAuthToken(access_token);

    message.success('Login successful!');
  }, []);

  const logout = useCallback((showMessage: boolean = true) => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    authService.clearAuthToken();
    if (showMessage) {
      message.info('Logged out.');
    }
  }, []);

  const updateSession = useCallback((newToken: string, changes: Partial<User> = {}) => {
    setToken(newToken);
    localStorage.setItem('auth_token', newToken);
    authService.setAuthToken(newToken);
    setUser(current => {
      if (!current) return current;
      const next = { ...current, ...changes };
      localStorage.setItem('auth_user', JSON.stringify(next));
      return next;
    });
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    try {
      const response = await authService.register(data);
      message.success('Registration completed. Please login.');
      return response;
    } catch (error) {
      message.error(getErrorMessage(error) || 'Registration failed.');
      throw error;
    }
  }, []);

  // Memoized role check functions to prevent unnecessary re-renders
  const isAdmin = useCallback(() => {
    return user?.role === 'admin' || user?.role === 'super_admin';
  }, [user?.role]);

  const isManager = useCallback(() => {
    return user?.role === 'manager' || user?.role === 'supervisor' || user?.role === 'admin' || user?.role === 'super_admin';
  }, [user?.role]);

  const hasPermission = useCallback((requiredRole: string) => {
    if (!user) return false;

    const roleHierarchy: Record<string, number> = {
      super_admin: 10,
      admin: 9,
      manager: 8,
      supervisor: 7,
      sales: 6,
      technician: 5,
      staff: 4,
      customer_service: 3,
      accountant: 3,
      viewer: 1,
    };

    const userLevel = roleHierarchy[user.role] || 0;
    const requiredLevel = roleHierarchy[requiredRole] || 0;

    return userLevel >= requiredLevel;
  }, [user]);

  const canAccessPath = useCallback((pathname: string) => {
    const screen = screenForPath(pathname);
    if (!screen) return true;
    // A session stored before screen access existed has no list yet
    if (!user?.screens) return true;
    return opensScreen(user.screens, screen);
  }, [user?.screens]);

  // Memoize context value to prevent unnecessary re-renders of consumers
  const value = useMemo(() => ({
    user,
    token,
    loading,
    login,
    logout,
    updateSession,
    register,
    isAdmin,
    isManager,
    hasPermission,
    canAccessPath,
  }), [user, token, loading, login, logout, updateSession, register, isAdmin, isManager, hasPermission, canAccessPath]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;