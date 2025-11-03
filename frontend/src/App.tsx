import React from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import { QueryProvider } from './contexts/QueryProvider';
import { AuthProvider } from './contexts/AuthContext';
import { TemplateBuilderProvider } from './contexts/TemplateBuilderContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Layout from './components/common/Layout';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import UserManagement from './pages/UserManagement';
import Profile from './pages/Profile';
import Dashboard from './pages/Dashboard';
import RoleBasedDashboard from './pages/RoleBasedDashboard';
import AdminDashboard from './pages/AdminDashboard';
import DocumentList from './pages/DocumentList';
import CompanyManagement from './pages/CompanyManagement';
import InvoiceCreation from './pages/InvoiceCreation';
import EstimateCreation from './pages/EstimateCreation';
import InsuranceEstimateCreation from './pages/InsuranceEstimateCreation';
import EstimateEditWrapper from './pages/EstimateEditWrapper';
import PlumberReportCreation from './pages/PlumberReportCreation';
import WorkOrderCreation from './pages/WorkOrderCreation';
import WorkOrderList from './pages/WorkOrderList';
import WorkOrderDetail from './pages/WorkOrderDetail';
import AdminConfig from './pages/AdminConfig';
import SketchTest from './pages/SketchTest';
import LineItemManagement from './pages/LineItemManagement';
import WaterMitigationList from './pages/WaterMitigationList';
import WaterMitigationDetail from './pages/WaterMitigationDetail';
import DebrisCalculator from './pages/DebrisCalculator';
import MaterialManagement from './pages/MaterialManagement';
import MaterialDetectionPage from './pages/MaterialDetectionPage';
import MLTraining from './pages/MLTraining';
import PackCalculator from './pages/PackCalculator';
import PackCalculationList from './pages/PackCalculationList';
import AdminApiUsage from './pages/AdminApiUsage';
import NotFound from './pages/NotFound';
import 'antd/dist/reset.css';

// Create router with future flags to eliminate warnings
const router = createBrowserRouter([
  // Public routes
  {
    path: "/login",
    element: <Login />
  },
  {
    path: "/register",
    element: <SignUp />
  },
  {
    path: "/forgot-password",
    element: <ForgotPassword />
  },
  {
    path: "/reset-password",
    element: <ResetPassword />
  },
  // Protected routes
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <Layout>
          <Navigate to="/dashboard" replace />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/dashboard",
    element: (
      <ProtectedRoute>
        <Layout>
          <RoleBasedDashboard />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/profile",
    element: (
      <ProtectedRoute>
        <Layout>
          <Profile />
        </Layout>
      </ProtectedRoute>
    )
  },
  // Admin only routes
  {
    path: "/admin/dashboard",
    element: (
      <ProtectedRoute requiredRole="admin">
        <Layout>
          <AdminDashboard />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/admin/api-usage",
    element: (
      <ProtectedRoute requiredRole="admin">
        <Layout>
          <AdminApiUsage />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/admin/config",
    element: (
      <ProtectedRoute requiredRole="admin">
        <Layout>
          <AdminConfig />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/admin/users",
    element: (
      <ProtectedRoute requiredRole="admin">
        <Layout>
          <UserManagement />
        </Layout>
      </ProtectedRoute>
    )
  },
  // Manager and Admin routes
  {
    path: "/companies",
    element: (
      <ProtectedRoute requiredRole="manager">
        <Layout>
          <CompanyManagement />
        </Layout>
      </ProtectedRoute>
    )
  },
  // Regular user routes
  {
    path: "/documents",
    element: (
      <ProtectedRoute>
        <Layout>
          <DocumentList />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/documents/:type",
    element: (
      <ProtectedRoute>
        <Layout>
          <DocumentList />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/create/estimate",
    element: (
      <ProtectedRoute>
        <Layout>
          <EstimateCreation />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/create/insurance-estimate",
    element: (
      <ProtectedRoute>
        <Layout>
          <InsuranceEstimateCreation />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/edit/estimate/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <EstimateEditWrapper />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/insurance-estimate/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <InsuranceEstimateCreation />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/create/plumber-report",
    element: (
      <ProtectedRoute>
        <Layout>
          <PlumberReportCreation />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/create/invoice",
    element: (
      <ProtectedRoute>
        <Layout>
          <InvoiceCreation />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/invoices/:id/edit",
    element: (
      <ProtectedRoute>
        <Layout>
          <InvoiceCreation />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/work-orders",
    element: (
      <ProtectedRoute>
        <Layout>
          <WorkOrderList />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/work-order/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <WorkOrderDetail />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/create/work-order",
    element: (
      <ProtectedRoute>
        <Layout>
          <WorkOrderCreation />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/work-orders/new",
    element: (
      <ProtectedRoute>
        <Layout>
          <WorkOrderCreation />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/work-orders/:id/edit",
    element: (
      <ProtectedRoute>
        <Layout>
          <WorkOrderCreation />
        </Layout>
      </ProtectedRoute>
    )
  },
  // Line Item Management
  {
    path: "/line-items",
    element: (
      <ProtectedRoute>
        <Layout>
          <LineItemManagement />
        </Layout>
      </ProtectedRoute>
    )
  },
  // Water Mitigation routes
  {
    path: "/water-mitigation",
    element: (
      <ProtectedRoute>
        <Layout>
          <WaterMitigationList />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/water-mitigation/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <WaterMitigationDetail />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/water-mitigation/:id/edit",
    element: (
      <ProtectedRoute>
        <Layout>
          <WaterMitigationDetail />
        </Layout>
      </ProtectedRoute>
    )
  },
  // Reconstruction Estimate routes
  {
    path: "/reconstruction-estimate/debris",
    element: (
      <ProtectedRoute>
        <Layout>
          <DebrisCalculator />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/material-detection",
    element: (
      <ProtectedRoute>
        <Layout>
          <MaterialDetectionPage />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/pack-calculations",
    element: (
      <ProtectedRoute>
        <Layout>
          <PackCalculationList />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/pack-calculator",
    element: (
      <ProtectedRoute>
        <Layout>
          <PackCalculator />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/pack-calculator/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <PackCalculator />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/pack-calculator/:id/edit",
    element: (
      <ProtectedRoute>
        <Layout>
          <PackCalculator />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/ml-training",
    element: (
      <ProtectedRoute>
        <Layout>
          <MLTraining />
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/admin/materials",
    element: (
      <ProtectedRoute requiredRole="admin">
        <Layout>
          <MaterialManagement />
        </Layout>
      </ProtectedRoute>
    )
  },
  // Sketch Test Route
  {
    path: "/sketch-test",
    element: (
      <ProtectedRoute>
        <Layout>
          <SketchTest />
        </Layout>
      </ProtectedRoute>
    )
  },
  // 404 Not Found - catch all undefined routes
  {
    path: "*",
    element: <NotFound />
  }
]);

function App() {
  return (
    <QueryProvider>
      <ConfigProvider locale={enUS}>
        <AuthProvider>
          <TemplateBuilderProvider>
            <RouterProvider router={router} />
          </TemplateBuilderProvider>
        </AuthProvider>
      </ConfigProvider>
    </QueryProvider>
  );
}

export default App;