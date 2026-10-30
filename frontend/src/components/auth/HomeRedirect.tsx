import React from 'react';
import { Navigate } from 'react-router-dom';
import { homePath } from '../../constants/screens';
import { useAuth } from '../../contexts/AuthContext';

// "/" (and the home screen icon) opens what the person chose, or the todo board
const HomeRedirect: React.FC = () => {
  const { user, canAccessPath } = useAuth();
  return <Navigate to={homePath(user?.home_screen, canAccessPath)} replace />;
};

export default HomeRedirect;
