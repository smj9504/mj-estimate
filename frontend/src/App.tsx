import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import enUS from 'antd/locale/en_US';
import { QueryProvider } from './contexts/QueryProvider';
import { AuthProvider } from './contexts/AuthContext';
import { TemplateBuilderProvider } from './contexts/TemplateBuilderContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Layout from './components/common/Layout';
import ErrorBoundary from './components/common/ErrorBoundary';
import 'antd/dist/reset.css';

// =====================================================
// LAZY LOADED PAGES (Code Splitting)
// =====================================================
// 새 페이지 추가 시: const NewPage = lazy(() => import('./pages/NewPage'));
// 패턴만 따라하면 자동으로 코드 스플리팅 적용됩니다!

// Public Pages (로그인 관련)
const Login = lazy(() => import('./pages/Login'));
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

// Client Pages
const ClientList = lazy(() => import('./pages/ClientList'));
const ClientDetail = lazy(() => import('./pages/ClientDetail'));

// Contract Pages
const ContractTemplateManagement = lazy(() => import('./pages/ContractTemplateManagement'));
const ContractSigning = lazy(() => import('./pages/ContractSigning'));

// Dashboard Pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const RoleBasedDashboard = lazy(() => import('./pages/RoleBasedDashboard'));
const Profile = lazy(() => import('./pages/Profile'));

// Document Pages
const DocumentList = lazy(() => import('./pages/DocumentList'));

// Estimate Pages
const EstimateCreation = lazy(() => import('./pages/EstimateCreation'));
const InsuranceEstimateCreation = lazy(() => import('./pages/InsuranceEstimateCreation'));
const InsuranceExtraction = lazy(() => import('./pages/InsuranceExtraction'));
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
const WaterMitigationTemplateList = lazy(() => import('./pages/WaterMitigationTemplateList'));
const StandardScopeItemsManagement = lazy(() => import('./pages/StandardScopeItemsManagement'));
const ScopeItemCategoriesManagement = lazy(() => import('./pages/ScopeItemCategoriesManagement'));

// Cabinet Estimate Pages
const CabinetEstimateList = lazy(() => import('./pages/CabinetEstimateList'));
const CabinetEstimateDetail = lazy(() => import('./pages/CabinetEstimateDetail'));

// Reconstruction Estimate Pages
const DebrisCalculator = lazy(() => import('./pages/DebrisCalculator'));
const MaterialDetectionPage = lazy(() => import('./pages/MaterialDetectionPage'));
const PackCalculatorNew = lazy(() => import('./pages/PackCalculatorNew'));
const PackCalculatorNewList = lazy(() => import('./pages/PackCalculatorNewList'));
const PackCalculatorNewDetail = lazy(() => import('./pages/PackCalculatorNewDetail'));

// ML & Training Pages
const MLTraining = lazy(() => import('./pages/MLTraining'));

// Test & Dev Pages
const SketchTest = lazy(() => import('./pages/SketchTest'));

// PDF Editor Pages
const PDFEditor = lazy(() => import('./pages/PDFEditor'));

// Reference Pages
const XactimateCheatSheet = lazy(() => import('./pages/XactimateCheatSheet'));

// Xactimate Helper Tool
const XactimateHelper = lazy(() => import('./pages/XactimateHelper'));

// Tools Pages
const PhotoMetadataEditor = lazy(() => import('./pages/PhotoMetadataEditor'));

// Crew Upload (Public)
const CrewUploadPage = lazy(() => import('./pages/CrewUploadPage'));

// Error Pages
const NotFound = lazy(() => import('./pages/NotFound'));
const Unauthorized = lazy(() => import('./pages/Unauthorized'));

// OAuth Pages
const OAuthCallback = lazy(() => import('./pages/OAuthCallback'));

// =====================================================
// LOADING COMPONENT
// =====================================================
const PageLoader = () => (
  <div style={{ 
    display: 'flex', 
    flexDirection: 'column',
    justifyContent: 'center', 
    alignItems: 'center', 
    height: '100vh',
    width: '100%'
  }}>
    <Spin size="large" />
    <div style={{ marginTop: 16, color: '#999' }}>Loading...</div>
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
  // OAuth callback routes (인증 불필요 - popup에서 처리)
  {
    path: "/oauth/google/callback",
    element: (
      <Suspense fallback={<PageLoader />}>
        <OAuthCallback />
      </Suspense>
    )
  },
  // Crew Upload (공개 - 인증 불필요, 현장 crew용)
  {
    path: "/upload/:token",
    element: (
      <Suspense fallback={<PageLoader />}>
        <CrewUploadPage />
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
  // Client management routes
  {
    path: "/clients",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <ClientList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/clients/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <ClientDetail />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Contract template management (admin)
  {
    path: "/contract-templates",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <ContractTemplateManagement />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Public contract signing page (NO auth required)
  {
    path: "/sign/:token",
    element: (
      <Suspense fallback={<PageLoader />}>
        <ContractSigning />
      </Suspense>
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
    path: "/insurance-extractions",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <InsuranceExtraction />
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
    path: "/plumber-reports/:id",
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
  {
    path: "/water-mitigation/templates",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <WaterMitigationTemplateList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/water-mitigation/standard-scope-items",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <StandardScopeItemsManagement />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/water-mitigation/scope-item-categories",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <ScopeItemCategoriesManagement />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Cabinet Estimate routes
  {
    path: "/cabinet-estimates",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <CabinetEstimateList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/cabinet-estimates/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <CabinetEstimateDetail />
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
    path: "/reconstruction-estimate/pack-calculator-new",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <PackCalculatorNew />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/pack-calculator-new/list",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <PackCalculatorNewList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/reconstruction-estimate/pack-calculator-new/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <PackCalculatorNewDetail />
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
  // PDF Editor Route
  {
    path: "/pdf-editor",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <PDFEditor />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Reference Pages
  {
    path: "/cheat-sheet",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <XactimateCheatSheet />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Xactimate Helper Tool
  {
    path: "/xactimate-helper",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <XactimateHelper />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Tools Routes
  {
    path: "/tools/photo-metadata",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <PhotoMetadataEditor />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Unauthorized route - access denied page
  {
    path: "/unauthorized",
    element: (
      <Suspense fallback={<PageLoader />}>
        <Unauthorized />
      </Suspense>
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
    <ErrorBoundary>
      <QueryProvider>
        <ConfigProvider locale={enUS}>
          <AuthProvider>
            <TemplateBuilderProvider>
              <RouterProvider router={router} />
            </TemplateBuilderProvider>
          </AuthProvider>
        </ConfigProvider>
      </QueryProvider>
    </ErrorBoundary>
  );
}

export default App;