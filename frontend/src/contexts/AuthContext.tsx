import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { message } from 'antd';
import authService from '../services/authService';
import { getErrorMessage } from '../api/errorHandler';

export interface User {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  role: 'super_admin' | 'admin' | 'manager' | 'supervisor' | 'technician' | 'staff' | 'sales' | 'customer_service' | 'accountant' | 'viewer';
  staff_number?: string;
  is_active: boolean;
  is_verified?: boolean;
  can_login?: boolean;
  email_verified?: boolean;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: (showMessage?: boolean) => void;
  register: (data: RegisterData) => Promise<void>;
  isAdmin: () => boolean;
  isManager: () => boolean;
  hasPermission: (requiredRole: string) => boolean;
}

interface RegisterData {
  username: string;
  email: string;
  password: string;
  full_name?: string;
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
        .catch(() => {
          // Token is invalid, clear auth
          logout(false);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      // No stored token/user, set loading to false immediately
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const response = await authService.login(username, password);
      const { access_token, user: userData } = response;
      
      setToken(access_token);
      setUser(userData);
      
      localStorage.setItem('auth_token', access_token);
      localStorage.setItem('auth_user', JSON.stringify(userData));
      
      authService.setAuthToken(access_token);
      
      message.success('Login successful!');
    } catch (error) {
      message.error(getErrorMessage(error) || 'Login failed.');
      throw error;
    }
  };

  const logout = (showMessage: boolean = true) => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    authService.clearAuthToken();
    if (showMessage) {
      message.info('Logged out.');
    }
  };

  const register = async (data: RegisterData) => {
    try {
      const response = await authService.register(data);
      message.success('Registration completed. Please login.');
      return response;
    } catch (error) {
      message.error(getErrorMessage(error) || 'Registration failed.');
      throw error;
    }
  };

  const isAdmin = () => {
    return user?.role === 'admin' || user?.role === 'super_admin';
  };

  const isManager = () => {
    return user?.role === 'manager' || user?.role === 'supervisor' || isAdmin();
  };

  const hasPermission = (requiredRole: string) => {
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
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    register,
    isAdmin,
    isManager,
    hasPermission,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;