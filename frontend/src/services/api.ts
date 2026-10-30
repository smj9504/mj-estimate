import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { Modal } from 'antd';
import { showRetryableErrorNotification } from './apiErrorNotification';
import { acquirePdfUploadLock, bodyHasPdf } from '../utils/pdfUploadLock';
import type { PdfUploadHold } from '../utils/pdfUploadLock';
import { isEmptyFormData } from '../utils/emptyFormData';

// Lets specific call sites (e.g. status-polling loops that already retry
// silently on their own timer) opt out of the global "다시 시도" notification -
// otherwise every transient poll failure pops the same alert on repeat.
declare module 'axios' {
  export interface AxiosRequestConfig {
    suppressErrorNotification?: boolean;
    /** Set on requests that send a PDF; released once the request settles */
    pdfUploadHold?: PdfUploadHold;
  }
}

// Blocks the whole app (see utils/pdfUploadLock) while a request that sends a
// PDF is in flight. Attach before any other interceptor: request interceptors
// run last-attached first, so this one runs right before the request goes out
// and a throwing interceptor can't leave the lock held; response interceptors
// run first-attached first, so the overlay is gone before an error modal opens.
function attachPdfUploadLock(instance: AxiosInstance) {
  instance.interceptors.request.use((config) => {
    if (!bodyHasPdf(config.data)) return config;
    const hold = acquirePdfUploadLock();
    const onUploadProgress = config.onUploadProgress;
    config.pdfUploadHold = hold;
    config.onUploadProgress = (event) => {
      hold.progress(event.loaded, event.total);
      onUploadProgress?.(event);
    };
    return config;
  });
  instance.interceptors.response.use(
    (response) => {
      response.config.pdfUploadHold?.release();
      return response;
    },
    (error) => {
      error.config?.pdfUploadHold?.release();
      return Promise.reject(error);
    }
  );
}

// The backend can't parse a multipart form with no fields (see
// utils/emptyFormData), so send those requests with no body. axios then drops
// the Content-Type header too, including a per-call 'multipart/form-data'.
function sendEmptyFormDataAsNoBody(instance: AxiosInstance) {
  instance.interceptors.request.use((config) => {
    if (isEmptyFormData(config.data)) config.data = undefined;
    return config;
  });
}

// Create axios instance with base configuration
// For production: use backend URL directly (Vercel env vars not working)
// For development: use proxy (empty string)
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const baseURL = isLocalDev
  ? '' // Development: use proxy
  : 'https://mjestimate-backend.onrender.com'; // Production: direct backend URL

console.log('API Base URL:', baseURL || 'Using proxy mode');

// A hung mobile connection otherwise waits forever (axios default timeout is 0).
// Individual calls that need more (e.g. large file uploads) can override this per-request.
const DEFAULT_TIMEOUT_MS = 30000;

const api = axios.create({
  baseURL: baseURL,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

attachPdfUploadLock(api);
sendEmptyFormDataAsNoBody(api);

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
    // A wrong password on the sign-in form is a 401 too; the form shows its own error.
    const isSignInAttempt = error.config?.url?.endsWith('/api/auth/login');
    if (error.response?.status === 401 && !isSignInAttempt) {
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
    if (isServerOrNetworkError && !error.config?.suppressErrorNotification) {
      showRetryableErrorNotification(error, api);
    }

    return Promise.reject(error);
  }
);

// Public API instance - NO auth token, NO 401 redirect.
// Used by the public-facing contract signing page, which must work
// independently of user sessions and server auth state.
export const publicApi = axios.create({
  baseURL: baseURL,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

attachPdfUploadLock(publicApi);
sendEmptyFormDataAsNoBody(publicApi);

publicApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const isServerOrNetworkError = !error.response || error.response.status >= 500;
    if (isServerOrNetworkError && !error.config?.suppressErrorNotification) {
      showRetryableErrorNotification(error, publicApi);
    }
    return Promise.reject(error);
  }
);

export default api;