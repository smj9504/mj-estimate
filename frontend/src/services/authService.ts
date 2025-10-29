import api from './api';

const API_BASE_URL = '/api/auth';

class AuthService {
  private authToken: string | null = null;

  setAuthToken(token: string) {
    this.authToken = token;
    // Set default authorization header for all axios requests
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  clearAuthToken() {
    this.authToken = null;
    delete api.defaults.headers.common['Authorization'];
  }

  async login(username: string, password: string) {
    const response = await api.post(`${API_BASE_URL}/login`, {
      username,
      password,
    });
    return response.data;
  }

  async register(data: {
    username: string;
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    staff_number: string;
    role?: string;
    hire_date?: string;
  }) {
    const response = await api.post(`${API_BASE_URL}/register`, data);
    return response.data;
  }

  async getCurrentUser() {
    const response = await api.get(`${API_BASE_URL}/me`);
    return response.data;
  }

  async updateCurrentUser(data: {
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    mobile_phone?: string;
  }) {
    const response = await api.put(`${API_BASE_URL}/me`, data);
    return response.data;
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const response = await api.post(`${API_BASE_URL}/me/change-password`, {
      current_password: currentPassword,
      new_password: newPassword,
    });
    return response.data;
  }

  // Password reset endpoints
  async requestPasswordReset(email: string) {
    const response = await api.post(`${API_BASE_URL}/password-reset/request`, { email });
    return response.data;
  }

  async verifyResetToken(token: string) {
    const response = await api.post(`${API_BASE_URL}/password-reset/verify?token=${token}`);
    return response.data;
  }

  async confirmPasswordReset(data: { token: string; new_password: string }) {
    const response = await api.post(`${API_BASE_URL}/password-reset/confirm`, data);
    return response.data;
  }

  // Admin only endpoints
  async getUsers() {
    const response = await api.get(`${API_BASE_URL}/staff`);
    return response.data;
  }

  async getAllUsers() {
    return this.getUsers();
  }

  async updateUser(userId: string, data: {
    email?: string;
    first_name?: string;
    last_name?: string;
    role?: string;
    is_active?: boolean;
    can_login?: boolean;
  }) {
    const response = await api.put(`${API_BASE_URL}/staff/${userId}`, data);
    return response.data;
  }

  async initializeAdmin() {
    const response = await api.post(`${API_BASE_URL}/init-admin`);
    return response.data;
  }
}

export default new AuthService();