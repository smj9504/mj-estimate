import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

// "/" opens the Claims Dashboard, or the dashboard for people who can't see it
const HomeRedirect: React.FC = () => {
  const { canAccessPath } = useAuth();
  const target = canAccessPath('/claims-lifecycle') ? '/claims-lifecycle' : '/dashboard';
  return <Navigate to={target} replace />;
};

export default HomeRedirect;
