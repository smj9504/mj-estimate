import React, { Suspense } from 'react';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import enUS from 'antd/locale/en_US';
import { antTheme } from './styles/antTheme';
import './styles/tokens.css';
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
// 새 페이지 추가 시: const NewPage = lazyWithRetry(() => import('./pages/NewPage'));
// 패턴만 따라하면 자동으로 코드 스플리팅 적용됩니다!

// Public Pages (로그인 관련)
const Login = lazyWithRetry(() => import('./pages/Login'));
const ForgotPassword = lazyWithRetry(() => import('./pages/ForgotPassword'));
const ResetPassword = lazyWithRetry(() => import('./pages/ResetPassword'));

// Admin Pages
const AdminDashboard = lazyWithRetry(() => import('./pages/AdminDashboard'));
const AdminApiUsage = lazyWithRetry(() => import('./pages/AdminApiUsage'));
const AdminConfig = lazyWithRetry(() => import('./pages/AdminConfig'));
const UserManagement = lazyWithRetry(() => import('./pages/UserManagement'));
const MaterialManagement = lazyWithRetry(() => import('./pages/MaterialManagement'));

// Manager Pages
const CompanyManagement = lazyWithRetry(() => import('./pages/CompanyManagement'));

// Client Pages
const ClientList = lazyWithRetry(() => import('./pages/ClientList'));
const ClientDetail = lazyWithRetry(() => import('./pages/ClientDetail'));

// Contract Pages
const ContractTemplateManagement = lazyWithRetry(() => import('./pages/ContractTemplateManagement'));
const ContractSigning = lazyWithRetry(() => import('./pages/ContractSigning'));
const FieldContractSigning = lazyWithRetry(() => import('./pages/FieldContractSigning'));

// Dashboard Pages
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const RoleBasedDashboard = lazyWithRetry(() => import('./pages/RoleBasedDashboard'));
const Profile = lazyWithRetry(() => import('./pages/Profile'));

// Document Pages
const DocumentList = lazyWithRetry(() => import('./pages/DocumentList'));

// Estimate Pages
const EstimateCreation = lazyWithRetry(() => import('./pages/EstimateCreation'));
const InsuranceEstimateCreation = lazyWithRetry(() => import('./pages/InsuranceEstimateCreation'));
const InsuranceExtraction = lazyWithRetry(() => import('./pages/InsuranceExtraction'));
const InsuranceExtractionList = lazyWithRetry(() => import('./pages/InsuranceExtractionList'));
const InsuranceExtractionDetail = lazyWithRetry(() => import('./pages/InsuranceExtractionDetail'));
const RepairTemplateList = lazyWithRetry(() => import('./pages/RepairTemplateList'));
const RepairTemplateEditor = lazyWithRetry(() => import('./pages/RepairTemplateEditor'));
const RepairEstimateWizard = lazyWithRetry(() => import('./pages/RepairEstimateWizard'));
const EstimateEditWrapper = lazyWithRetry(() => import('./pages/EstimateEditWrapper'));

// Invoice Pages
const InvoiceCreation = lazyWithRetry(() => import('./pages/InvoiceCreation'));

// Work Order Pages
const WorkOrderCreation = lazyWithRetry(() => import('./pages/WorkOrderCreation'));
const WorkOrderList = lazyWithRetry(() => import('./pages/WorkOrderList'));
const WorkOrderDetail = lazyWithRetry(() => import('./pages/WorkOrderDetail'));

// Plumber Report Pages
const PlumberReportCreation = lazyWithRetry(() => import('./pages/PlumberReportCreation'));
// Electrician Report Pages
const ElectricianReportCreation = lazyWithRetry(() => import('./pages/ElectricianReportCreation'));

// Line Item Pages
const LineItemManagement = lazyWithRetry(() => import('./pages/LineItemManagement'));

// Water Mitigation Pages
const WaterMitigationList = lazyWithRetry(() => import('./pages/WaterMitigationList'));
const WaterMitigationDetail = lazyWithRetry(() => import('./pages/WaterMitigationDetail'));
const WaterMitigationTemplateList = lazyWithRetry(() => import('./pages/WaterMitigationTemplateList'));
const StandardScopeItemsManagement = lazyWithRetry(() => import('./pages/StandardScopeItemsManagement'));
const ScopeItemCategoriesManagement = lazyWithRetry(() => import('./pages/ScopeItemCategoriesManagement'));

// Cabinet Estimate Pages
const CabinetEstimateList = lazyWithRetry(() => import('./pages/CabinetEstimateList'));
const CabinetEstimateDetail = lazyWithRetry(() => import('./pages/CabinetEstimateDetail'));

// Bathroom Estimate Pages
const BathroomEstimateList = lazyWithRetry(() => import('./pages/BathroomEstimateList'));
const BathroomEstimateDetail = lazyWithRetry(() => import('./pages/BathroomEstimateDetail'));

// Siding Estimate Pages
const SidingEstimateList = lazyWithRetry(() => import('./pages/SidingEstimateList'));
const SidingEstimateDetail = lazyWithRetry(() => import('./pages/SidingEstimateDetail'));

// Roofing Estimate Pages
const RoofingEstimateList = lazyWithRetry(() => import('./pages/RoofingEstimateList'));
const RoofingEstimateDetail = lazyWithRetry(() => import('./pages/RoofingEstimateDetail'));

// Material Order Pages
const MaterialOrderPage = lazyWithRetry(() => import('./pages/MaterialOrderPage'));
const MaterialOrderList = lazyWithRetry(() => import('./pages/MaterialOrderList'));

// Reconstruction Estimate Pages
const DebrisCalculator = lazyWithRetry(() => import('./pages/DebrisCalculator'));
const MaterialDetectionPage = lazyWithRetry(() => import('./pages/MaterialDetectionPage'));
const PackCalculatorNew = lazyWithRetry(() => import('./pages/PackCalculatorNew'));
const PackCalculatorNewList = lazyWithRetry(() => import('./pages/PackCalculatorNewList'));
const PackCalculatorNewDetail = lazyWithRetry(() => import('./pages/PackCalculatorNewDetail'));

// ML & Training Pages
const MLTraining = lazyWithRetry(() => import('./pages/MLTraining'));

// Test & Dev Pages
const SketchTest = lazyWithRetry(() => import('./pages/SketchTest'));

// PDF Editor Pages
const PDFEditor = lazyWithRetry(() => import('./pages/PDFEditor'));

// Reference Pages
const XactimateCheatSheet = lazyWithRetry(() => import('./pages/XactimateCheatSheet'));

// Xactimate Helper Tool
const XactimateHelper = lazyWithRetry(() => import('./pages/XactimateHelper'));

// Tools Pages
const PhotoMetadataEditor = lazyWithRetry(() => import('./pages/PhotoMetadataEditor'));

// Email Ingestion
const EmailIngestionDashboard = lazyWithRetry(() => import('./pages/EmailIngestionDashboard'));
const EmailAccountSettings = lazyWithRetry(() => import('./pages/EmailAccountSettings'));

// Claim Follow-up
const ClaimFollowUpDashboard = lazyWithRetry(() => import('./pages/ClaimFollowUpDashboard'));
const ClaimFollowUpDetail = lazyWithRetry(() => import('./pages/ClaimFollowUpDetail'));
const ClaimFollowUpEmail = lazyWithRetry(() => import('./pages/ClaimFollowUpEmail'));

// Estimates (Supplements + Estimate Requests)
const SupplementManagement = lazyWithRetry(() => import('./pages/SupplementManagement'));
const SupplementDetail = lazyWithRetry(() => import('./pages/SupplementDetail'));

// Rebuild Projects
const RebuildProjectList = lazyWithRetry(() => import('./pages/RebuildProjectList'));

// Claims Lifecycle Dashboard
const ClaimsLifecycleDashboard = lazyWithRetry(() => import('./pages/ClaimsLifecycleDashboard'));

// Crew Upload (Public)
const CrewUploadPage = lazyWithRetry(() => import('./pages/CrewUploadPage'));

// Contractor Payment Portal (Public)
const ContractorPaymentPortal = lazyWithRetry(() => import('./pages/ContractorPaymentPortal'));

// Error Pages
const NotFound = lazyWithRetry(() => import('./pages/NotFound'));
const Unauthorized = lazyWithRetry(() => import('./pages/Unauthorized'));

// OAuth Pages
const OAuthCallback = lazyWithRetry(() => import('./pages/OAuthCallback'));

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
    <div style={{ marginTop: 16, color: '#8c8c8c' }}>Loading...</div>
  </div>
);

// =====================================================
// ROUTER CONFIGURATION
// =====================================================
// 🔥 새 페이지 추가하는 방법:
// 
// 1. 위에서 lazy load 선언:
//    const NewPage = lazyWithRetry(() => import('./pages/NewPage'));
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
  // Contractor Payment Portal (토큰 기반 - 인증 불필요)
  {
    path: "/contractor-portal/:token",
    element: (
      <Suspense fallback={<PageLoader />}>
        <ContractorPaymentPortal />
      </Suspense>
    )
  },
  // Contractor Payment Portal (로그인 기반 - contractor role)
  {
    path: "/contractor-portal",
    element: (
      <ProtectedRoute>
        <Suspense fallback={<PageLoader />}>
          <ContractorPaymentPortal />
        </Suspense>
      </ProtectedRoute>
    )
  },
  // Protected routes
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <Layout>
          <Navigate to="/claims-lifecycle" replace />
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
  // Public field contract signing page (NO auth required, iPad optimized)
  {
    path: "/field-sign",
    element: (
      <Suspense fallback={<PageLoader />}>
        <FieldContractSigning />
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
            <InsuranceExtractionList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/insurance-extractions/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <InsuranceExtractionDetail />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/repair-templates",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <RepairTemplateList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/repair-templates/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <RepairTemplateEditor />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/repair-estimate-wizard",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <RepairEstimateWizard />
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
    path: "/create/electrician-report",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <ElectricianReportCreation />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/electrician-reports/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <ElectricianReportCreation />
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
  // Bathroom Estimate routes
  {
    path: "/bathroom-estimates",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <BathroomEstimateList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/bathroom-estimates/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <BathroomEstimateDetail />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Siding Estimate routes
  {
    path: "/siding-estimates",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <SidingEstimateList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/siding-estimates/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <SidingEstimateDetail />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Roofing Estimate routes
  {
    path: "/roofing-estimates",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <RoofingEstimateList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/roofing-estimates/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <RoofingEstimateDetail />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Material Order routes
  {
    path: "/material-orders",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <MaterialOrderList />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/material-order/new",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <MaterialOrderPage />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/material-order/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <MaterialOrderPage />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Email Ingestion routes
  {
    path: "/email-ingestion",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <EmailIngestionDashboard />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/email-ingestion/accounts",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <EmailAccountSettings />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Claims Lifecycle Dashboard
  {
    path: "/claims-lifecycle",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <ClaimsLifecycleDashboard />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Claim Follow-up routes
  {
    path: "/claim-followup",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <ClaimFollowUpDashboard />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/claim-followup/claim/:claimId",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <ClaimFollowUpDetail />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/claim-followup/:taskId/email",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <ClaimFollowUpEmail />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Supplement Management route
  {
    path: "/supplements",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <SupplementManagement />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  {
    path: "/supplements/:id",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <SupplementDetail />
          </Suspense>
        </Layout>
      </ProtectedRoute>
    )
  },
  // Rebuild Projects route
  {
    path: "/rebuild-projects",
    element: (
      <ProtectedRoute>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <RebuildProjectList />
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
        <ConfigProvider theme={antTheme} locale={enUS}>
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