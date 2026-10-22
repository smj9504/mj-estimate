import React from 'react';
import { Navigate } from 'react-router-dom';

// "/" (and the home screen icon) opens your todo board
const HomeRedirect: React.FC = () => <Navigate to="/todos" replace />;

export default HomeRedirect;
