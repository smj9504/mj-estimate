import axios from 'axios';

const API_BASE_URL = '/api/auth';

class AuthService {
  private authToken: string | null = null;

  setAuthToken(token: string) {
    this.authToken = token;
    // Set default authorization header for all axios requests
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  clearAuthToken() {
    this.authToken = null;
    delete axios.defaults.headers.common['Authorization'];
  }

  async login(username: string, password: string) {
    const response = await axios.post(`${API_BASE_URL}/login`, {
      username,
      password,
    });
    return response.data;
  }

  async register(data: {
    username: string;
    email: string;
    password: string;
    full_name?: string;
  }) {
    const response = await axios.post(`${API_BASE_URL}/register`, {
      ...data,
      role: 'user', // Default role for new registrations
    });
    return response.data;
  }

  async getCurrentUser() {
    const response = await axios.get(`${API_BASE_URL}/me`);
    return response.data;
  }

  async updateCurrentUser(data: {
    email?: string;
    full_name?: string;
  }) {
    const response = await axios.put(`${API_BASE_URL}/me`, data);
    return response.data;
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const response = await axios.post(`${API_BASE_URL}/me/change-password`, {
      current_password: currentPassword,
      new_password: newPassword,
    });
    return response.data;
  }

  // Admin only endpoints
  async getAllUsers() {
    const response = await axios.get(`${API_BASE_URL}/users`);
    return response.data;
  }

  async updateUser(userId: string, data: {
    email?: string;
    full_name?: string;
    role?: 'admin' | 'manager' | 'user';
    is_active?: boolean;
  }) {
    const response = await axios.put(`${API_BASE_URL}/users/${userId}`, data);
    return response.data;
  }

  async initializeAdmin() {
    const response = await axios.post(`${API_BASE_URL}/init-admin`);
    return response.data;
  }
}

export default new AuthService();