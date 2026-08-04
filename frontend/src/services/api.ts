import axios from 'axios';
import { Modal } from 'antd';
import { showRetryableErrorNotification } from './apiErrorNotification';

// Create axios instance with base configuration
// For production: use backend URL directly (Vercel env vars not working)
// For development: use proxy (empty string)
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const baseURL = isLocalDev
  ? '' // Development: use proxy
  : 'https://mjestimate-backend.onrender.com'; // Production: direct backend URL

console.log('API Base URL:', baseURL || 'Using proxy mode');

const api = axios.create({
  baseURL: baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for auth token
api.interceptors.request.use(
  (config) => {
    // Add auth token if available
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log('[API] Request:', config.method?.toUpperCase(), config.url, 'with auth token');
    } else {
      console.warn('[API] Request:', config.method?.toUpperCase(), config.url, 'WITHOUT auth token');
    }
    return config;
  },
  (error) => {
    console.error('[API] Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    console.log('[API] Response:', response.status, response.config.method?.toUpperCase(), response.config.url);
    return response;
  },
  (error) => {
    console.error('[API] Response error:', error.response?.status, error.config?.method?.toUpperCase(), error.config?.url, error.response?.data);
    if (error.response?.status === 401) {
      console.warn('[API] Unauthorized - session expired');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      Modal.warning({
        title: 'Session Expired',
        content: 'Your session has expired. Please log in again.',
        okText: 'Log In',
        onOk: () => {
          window.location.href = '/login';
        },
      });
      return Promise.reject(error);
    }

    // Server crashed or never responded - let the user retry instead of
    // being stuck. 4xx errors are left untouched: pages already show a
    // specific message for those via their own catch blocks.
    const isServerOrNetworkError = !error.response || error.response.status >= 500;
    if (isServerOrNetworkError) {
      showRetryableErrorNotification(error, api);
    }

    return Promise.reject(error);
  }
);

// Public API instance - NO auth token, NO 401 redirect.
// Used by public-facing pages (field-sign, contract signing) that must
// work independently of user sessions and server auth state.
export const publicApi = axios.create({
  baseURL: baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

publicApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const isServerOrNetworkError = !error.response || error.response.status >= 500;
    if (isServerOrNetworkError) {
      showRetryableErrorNotification(error, publicApi);
    }
    return Promise.reject(error);
  }
);

export default api;