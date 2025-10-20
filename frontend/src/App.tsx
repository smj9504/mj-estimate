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
import NotFound from './pages/NotFound';
import 'antd/dist/reset.css';

// Create router with future flags to eliminate warnings
const router = createBrowserRouter([
  // Public routes
  {
    path: "/login",
    element: <Login />
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
    path: "/admin/config",
    element: (
      <ProtectedRoute requiredRole="admin">
        <Layout>
          <AdminConfig />
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