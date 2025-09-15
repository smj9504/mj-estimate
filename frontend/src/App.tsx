import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import { AuthProvider } from './contexts/AuthContext';
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
import NotFound from './pages/NotFound';
import 'antd/dist/reset.css';

// Create a client with optimized cache strategy
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30 * 1000, // 30 seconds for lists (will be overridden per query)
      gcTime: 10 * 60 * 1000, // 10 minutes in memory (formerly cacheTime in v4)
      refetchOnMount: 'always', // Always check for fresh data on mount
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={enUS}>
        <AuthProvider>
          <Router>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              
              {/* Protected routes */}
              <Route path="/" element={
                <ProtectedRoute>
                  <Layout>
                    <Navigate to="/dashboard" replace />
                  </Layout>
                </ProtectedRoute>
              } />
              
              <Route path="/dashboard" element={
                <ProtectedRoute>
                  <Layout>
                    <RoleBasedDashboard />
                  </Layout>
                </ProtectedRoute>
              } />
              
              {/* Admin only routes */}
              <Route path="/admin/dashboard" element={
                <ProtectedRoute requiredRole="admin">
                  <Layout>
                    <AdminDashboard />
                  </Layout>
                </ProtectedRoute>
              } />
              
              
              
              <Route path="/admin/config" element={
                <ProtectedRoute requiredRole="admin">
                  <Layout>
                    <AdminConfig />
                  </Layout>
                </ProtectedRoute>
              } />
              
              {/* Manager and Admin routes */}
              <Route path="/companies" element={
                <ProtectedRoute requiredRole="manager">
                  <Layout>
                    <CompanyManagement />
                  </Layout>
                </ProtectedRoute>
              } />
              
              {/* Regular user routes */}
              <Route path="/documents" element={
                <ProtectedRoute>
                  <Layout>
                    <DocumentList />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/documents/:type" element={
                <ProtectedRoute>
                  <Layout>
                    <DocumentList />
                  </Layout>
                </ProtectedRoute>
              } />
              
              {/* Invoice Routes */}
              <Route path="/create/invoice" element={
                <ProtectedRoute>
                  <Layout>
                    <InvoiceCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/invoices/:id" element={
                <ProtectedRoute>
                  <Layout>
                    <InvoiceCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/invoices/:id/edit" element={
                <ProtectedRoute>
                  <Layout>
                    <InvoiceCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              
              {/* Estimate Routes */}
              <Route path="/create/estimate" element={
                <ProtectedRoute>
                  <Layout>
                    <EstimateCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/estimates/create" element={
                <ProtectedRoute>
                  <Layout>
                    <EstimateCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              
              {/* Insurance Estimate Routes */}
              <Route path="/create/insurance-estimate" element={
                <ProtectedRoute>
                  <Layout>
                    <InsuranceEstimateCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/estimates/new" element={
                <ProtectedRoute>
                  <Layout>
                    <InsuranceEstimateCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/estimates/:id" element={
                <ProtectedRoute>
                  <Layout>
                    <EstimateEditWrapper />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/estimates/:id/edit" element={
                <ProtectedRoute>
                  <Layout>
                    <EstimateEditWrapper />
                  </Layout>
                </ProtectedRoute>
              } />
              
              {/* Plumber Report Routes */}
              <Route path="/create/plumber" element={
                <ProtectedRoute>
                  <Layout>
                    <PlumberReportCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/plumber-reports" element={
                <ProtectedRoute>
                  <Layout>
                    <PlumberReportCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/plumber-reports/new" element={
                <ProtectedRoute>
                  <Layout>
                    <PlumberReportCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/plumber-reports/:id" element={
                <ProtectedRoute>
                  <Layout>
                    <PlumberReportCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/plumber-reports/:id/edit" element={
                <ProtectedRoute>
                  <Layout>
                    <PlumberReportCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              
              {/* Work Order Routes */}
              <Route path="/work-orders" element={
                <ProtectedRoute>
                  <Layout>
                    <WorkOrderList />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/work-orders/new" element={
                <ProtectedRoute>
                  <Layout>
                    <WorkOrderCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/work-orders/:id" element={
                <ProtectedRoute>
                  <Layout>
                    <WorkOrderDetail />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/work-orders/:id/edit" element={
                <ProtectedRoute>
                  <Layout>
                    <WorkOrderCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              <Route path="/create/work-order" element={
                <ProtectedRoute>
                  <Layout>
                    <WorkOrderCreation />
                  </Layout>
                </ProtectedRoute>
              } />
              
              {/* 404 Not Found - catch all undefined routes */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Router>
        </AuthProvider>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

export default App;
