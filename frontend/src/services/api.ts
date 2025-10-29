import axios from 'axios';

// Create axios instance with base configuration
// For production: use backend URL directly (Vercel env vars not working)
// For development: use proxy (empty string)
const baseURL = window.location.hostname === 'localhost'
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
      // Handle unauthorized access
      console.warn('[API] Unauthorized - redirecting to login');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;