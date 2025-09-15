import axios from 'axios';

// API Base URL - will be replaced with environment variable
// Use empty string to use relative URLs (for proxy to work)
const API_BASE_URL = process.env.REACT_APP_API_URL || '';

console.log('API Base URL configured:', API_BASE_URL || 'Using relative URLs (proxy mode)'); // Debug log

// Create axios instance with default config
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 seconds timeout
});

// Request interceptor for auth token
apiClient.interceptors.request.use(
  (config) => {
    // Force relative URLs to use proxy
    if (config.url && !config.url.startsWith('http')) {
      console.log('Making request to:', config.url); // Debug log
      console.log('Using proxy for relative URL'); // Debug log
    }
    
    let token = localStorage.getItem('auth_token');
    
    // Development mode: Create a temporary token if none exists
    if (!token && process.env.NODE_ENV === 'development') {
      console.log('Development mode: No auth token found, creating temporary token');
      // This is a temporary solution for development
      // In production, user must be properly authenticated
      token = 'dev-temp-token-' + Date.now();
      localStorage.setItem('auth_token', token);
      console.log('Temporary token created:', token);
    }
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log('Added Authorization header with token'); // Debug log
    } else {
      console.log('No auth token available'); // Debug log
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized access
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);