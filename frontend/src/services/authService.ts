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

  // Admin only: Create new user
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

  // Email is left out: only an admin can change it
  async updateCurrentUser(data: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    mobile_phone?: string;
    home_screen?: string | null;
  }) {
    const response = await api.put(`${API_BASE_URL}/me`, data);
    return response.data;
  }

  // Emails a code to the signed-in person's own address. `code` comes back
  // only in development when the server has email turned off.
  async requestPasswordChangeCode(): Promise<{
    sent_to: string;
    expires_in_minutes: number;
    code?: string | null;
  }> {
    const response = await api.post(`${API_BASE_URL}/me/change-password/code`);
    return response.data;
  }

  // Signs out every session; the returned token keeps this one going
  async changePassword(code: string, newPassword: string): Promise<{ access_token: string }> {
    const response = await api.post(`${API_BASE_URL}/me/change-password`, {
      code,
      new_password: newPassword,
    });
    return response.data;
  }

  // Right after signing in with a password an admin reset
  async changeTemporaryPassword(currentPassword: string, newPassword: string): Promise<{ access_token: string }> {
    const response = await api.post(`${API_BASE_URL}/me/change-temporary-password`, {
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

  // Admin only: Update user (can update username, staff_number, role)
  async updateUser(userId: string, data: {
    home_screen?: string | null;
    email?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
    staff_number?: string;
    role?: string;
    is_active?: boolean;
    can_login?: boolean;
    // null puts the person back on their role's screens
    screen_access?: string[] | null;
    // The companies whose claims and cash jobs they see
    company_ids?: string[];
    // Every company, including ones added later
    all_companies?: boolean;
  }) {
    const response = await api.put(`${API_BASE_URL}/staff/${userId}`, data);
    return response.data;
  }

  // Admin only: leave newPassword out to have the server make one up
  async resetUserPassword(userId: string, newPassword?: string): Promise<{ password: string }> {
    const response = await api.post(
      `${API_BASE_URL}/staff/${userId}/reset-password`,
      newPassword ? { new_password: newPassword } : {}
    );
    return response.data;
  }

  // Admin only: screen keys and each role's default screens
  async getScreenAccessSettings(): Promise<{ screens: string[]; role_defaults: Record<string, string[]> }> {
    const response = await api.get(`${API_BASE_URL}/screen-access`);
    return response.data;
  }

  async updateRoleScreens(role: string, screens: string[]): Promise<{ screens: string[]; role_defaults: Record<string, string[]> }> {
    const response = await api.put(`${API_BASE_URL}/screen-access/roles/${role}`, { screens });
    return response.data;
  }

  async initializeAdmin() {
    const response = await api.post(`${API_BASE_URL}/init-admin`);
    return response.data;
  }

  // Google Drive Settings
  async getGoogleDriveSettings(staffId: string): Promise<{
    gdrive_enabled: boolean;
    gdrive_root_folder_id: string | null;
    gdrive_configured: boolean;
    message?: string;
  }> {
    const response = await api.get(`/api/staff/${staffId}/gdrive-settings`);
    return response.data;
  }

  async updateGoogleDriveSettings(staffId: string, data: {
    gdrive_service_account_json?: string;
    gdrive_root_folder_id?: string;
    gdrive_enabled?: boolean;
  }): Promise<{
    gdrive_enabled: boolean;
    gdrive_root_folder_id: string | null;
    gdrive_configured: boolean;
    message?: string;
  }> {
    const response = await api.put(`/api/staff/${staffId}/gdrive-settings`, data);
    return response.data;
  }

  async testGoogleDriveConnection(staffId: string): Promise<{
    success: boolean;
    message: string;
    folder_name?: string;
    folder_url?: string;
  }> {
    const response = await api.post(`/api/staff/${staffId}/gdrive-settings/test`);
    return response.data;
  }

  // Google OAuth 2.0 Methods
  async getGoogleOAuthStatus(staffId: string): Promise<{
    connected: boolean;
    auth_type: 'oauth' | 'service_account' | 'none';
    email: string | null;
    gdrive_enabled: boolean;
    gdrive_root_folder_id: string | null;
    message?: string;
  }> {
    const response = await api.get(`/api/staff/${staffId}/gdrive-oauth/status`);
    return response.data;
  }

  async initGoogleOAuth(staffId: string): Promise<{
    authorization_url: string;
    state: string;
  }> {
    const response = await api.post(`/api/staff/${staffId}/gdrive-oauth/init`);
    return response.data;
  }

  async completeGoogleOAuth(staffId: string, code: string, state?: string): Promise<{
    success: boolean;
    message: string;
    email?: string;
  }> {
    const response = await api.post(`/api/staff/${staffId}/gdrive-oauth/callback`, {
      code,
      state,
    });
    return response.data;
  }

  async disconnectGoogleOAuth(staffId: string): Promise<{
    message: string;
  }> {
    const response = await api.post(`/api/staff/${staffId}/gdrive-oauth/disconnect`);
    return response.data;
  }

  async listGoogleDriveFolders(staffId: string, parentId: string = 'root'): Promise<{
    folders: Array<{
      id: string;
      name: string;
      webViewLink?: string;
    }>;
    current_folder_id: string;
  }> {
    const response = await api.get(`/api/staff/${staffId}/gdrive-oauth/folders`, {
      params: { parent_id: parentId },
    });
    return response.data;
  }

  async createGoogleDriveFolder(staffId: string, name: string, parentId: string = 'root'): Promise<{
    id: string;
    name: string;
    webViewLink?: string;
  }> {
    const response = await api.post(`/api/staff/${staffId}/gdrive-oauth/folders`, {
      name,
      parent_id: parentId,
    });
    return response.data;
  }

  async selectGoogleDriveFolder(staffId: string, folderId: string): Promise<{
    message: string;
    folder_id: string;
    folder_name: string;
    folder_url?: string;
  }> {
    const response = await api.post(`/api/staff/${staffId}/gdrive-oauth/select-folder`, {
      folder_id: folderId,
    });
    return response.data;
  }
}

export default new AuthService();