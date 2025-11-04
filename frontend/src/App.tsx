import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import enUS from 'antd/locale/en_US';
import { QueryProvider } from './contexts/QueryProvider';
import { AuthProvider } from './contexts/AuthContext';
import { TemplateBuilderProvider } from './contexts/TemplateBuilderContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Layout from './components/common/Layout';
import 'antd/dist/reset.css';

// =====================================================
// LAZY LOADED PAGES (Code Splitting)
// =====================================================
// 새 페이지 추가 시: const NewPage = lazy(() => import('./pages/NewPage'));
// 패턴만 따라하면 자동으로 코드 스플리팅 적용됩니다!

// Public Pages (로그인 관련)
const Login = lazy(() => import('./pages/Login'));
const SignUp = lazy(() => import('./pages/SignUp'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

// Admin Pages
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminApiUsage = lazy(() => import('./pages/AdminApiUsage'));
const AdminConfig = lazy(() => import('./pages/AdminConfig'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const MaterialManagement = lazy(() => import('./pages/MaterialManagement'));

// Manager Pages
const CompanyManagement = lazy(() => import('./pages/CompanyManagement'));

// Dashboard Pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const RoleBasedDashboard = lazy(() => import('./pages/RoleBasedDashboard'));
const Profile = lazy(() => import('./pages/Profile'));

// Document Pages
const DocumentList = lazy(() => import('./pages/DocumentList'));

// Estimate Pages
const EstimateCreation = lazy(() => import('./pages/EstimateCreation'));
const InsuranceEstimateCreation = lazy(() => import('./pages/InsuranceEstimateCreation'));
const EstimateEditWrapper = lazy(() => import('./pages/EstimateEditWrapper'));

// Invoice Pages
const InvoiceCreation = lazy(() => import('./pages/InvoiceCreation'));

// Work Order Pages
const WorkOrderCreation = lazy(() => import('./pages/WorkOrderCreation'));
const WorkOrderList = lazy(() => import('./pages/WorkOrderList'));
const WorkOrderDetail = lazy(() => import('./pages/WorkOrderDetail'));

// Plumber Report Pages
const PlumberReportCreation = lazy(() => import('./pages/PlumberReportCreation'));

// Line Item Pages
const LineItemManagement = lazy(() => import('./pages/LineItemManagement'));

// Water Mitigation Pages
const WaterMitigationList = lazy(() => import('./pages/WaterMitigationList'));
const WaterMitigationDetail = lazy(() => import('./pages/WaterMitigationDetail'));

// Reconstruction Estimate Pages
const DebrisCalculator = lazy(() => import('./pages/DebrisCalculator'));
const MaterialDetectionPage = lazy(() => import('./pages/MaterialDetectionPage'));
const PackCalculator = lazy(() => import('./pages/PackCalculator'));
const PackCalculationList = lazy(() => import('./pages/PackCalculationList'));

// ML & Training Pages
const MLTraining = lazy(() => import('./pages/MLTraining'));

// Test & Dev Pages
const SketchTest = lazy(() => import('./pages/SketchTest'));

// Error Pages
const NotFound = lazy(() => import('./pages/NotFound'));

// =====================================================
// LOADING COMPONENT
// =====================================================
const PageLoader = () => (
  <div style={{ 
    display: 'flex', 
    justifyContent: 'center', 
    alignItems: 'center', 
    height: '100vh',
    width: '100%'
  }}>
    <Spin size="large" tip="Loading..." />
  </div>
);

// =====================================================
// ROUTER CONFIGURATION
// =====================================================
// 🔥 새 페이지 추가하는 방법:
// 
// 1. 위에서 lazy load 선언:
//    const NewPage = lazy(() => import('./pages/NewPage'));
//
// 2. 라우터에 추가:
//    {
//      path: "/new-page",
//      element: (
//        <ProtectedRoute>
//          <Layout>
//            <Suspense fallback={<PageLoader />}>
//              <NewPage />
//            </Suspense>
//          </Layout>
//        </ProtectedRoute>
//      )
//    }
//
// ✅ 이 패턴만 따라하면 자동으로 코드 스플리팅이 적용됩니다!
const router = createBrowserRouter([
  // Public routes (인증 불필요)
  {
    path: "/login",
    element: (
      <Suspense fallback={<PageLoader />}>
        <Login />
      </Suspense>
    )
  },
  {
    path: "/register",
    element: (
      <Suspense fallback={<PageLoader />}>
        <SignUp />
      </Suspense>
    )
  },
  {
    path: "/forgot-password",
    element: (
      <Suspense fallback={<PageLoader />}>
        <ForgotPassword />
      </Suspense>
    )
  },
  {
    path: "/reset-password",
    element: (
      <Suspense fallback={<PageLoader />}>
        <ResetPassword />
      </Suspense>
    )
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
          <Suspense fallback={<PageLoader />}>
            <RoleBasedDashboard />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/profile",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <Profile />
          </Suspense>
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
          <Suspense fallback={<PageLoader />}>
            <AdminDashboard />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/admin/api-usage",
    element: (
      <ProtectedRoute requiredRole="admin">
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <AdminApiUsage />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/admin/config",
    element: (
      <ProtectedRoute requiredRole="admin">
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <AdminConfig />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/admin/users",
    element: (
      <ProtectedRoute requiredRole="admin">
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <UserManagement />
          </Suspense>
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
          <Suspense fallback={<PageLoader />}>
            <CompanyManagement />
          </Suspense>
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
          <Suspense fallback={<PageLoader />}>
            <DocumentList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/documents/:type",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <DocumentList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/create/estimate",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <EstimateCreation />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/create/insurance-estimate",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <InsuranceEstimateCreation />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/edit/estimate/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <EstimateEditWrapper />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/insurance-estimate/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <InsuranceEstimateCreation />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/create/plumber-report",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <PlumberReportCreation />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/create/invoice",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <InvoiceCreation />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/invoices/:id/edit",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <InvoiceCreation />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/work-orders",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <WorkOrderList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/work-order/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <WorkOrderDetail />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/create/work-order",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <WorkOrderCreation />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/work-orders/new",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <WorkOrderCreation />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/work-orders/:id/edit",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <WorkOrderCreation />
          </Suspense>
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
          <Suspense fallback={<PageLoader />}>
            <LineItemManagement />
          </Suspense>
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
          <Suspense fallback={<PageLoader />}>
            <WaterMitigationList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/water-mitigation/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <WaterMitigationDetail />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/water-mitigation/:id/edit",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <WaterMitigationDetail />
          </Suspense>
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
          <Suspense fallback={<PageLoader />}>
            <DebrisCalculator />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/material-detection",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <MaterialDetectionPage />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/pack-calculations",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <PackCalculationList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/pack-calculator",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <PackCalculator />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/pack-calculator/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <PackCalculator />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/pack-calculator/:id/edit",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <PackCalculator />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/ml-training",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <MLTraining />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/admin/materials",
    element: (
      <ProtectedRoute requiredRole="admin">
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <MaterialManagement />
          </Suspense>
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
          <Suspense fallback={<PageLoader />}>
            <SketchTest />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // 404 Not Found - catch all undefined routes
  {
    path: "*",
    element: (
      <Suspense fallback={<PageLoader />}>
        <NotFound />
      </Suspense>
    )
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