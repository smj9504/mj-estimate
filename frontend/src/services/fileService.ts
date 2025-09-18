import api from './api';

export interface FileItem {
  id: string;
  filename: string;
  originalName: string;
  contentType: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  context: string;
  contextId: string;
  category: string;
  description?: string;
  uploadedBy?: string;
  uploadDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface FileUploadConfig {
  multiple?: boolean;
  showUploadList?: boolean;
  listType?: 'text' | 'picture' | 'picture-card';
  accept?: string;
}

export const fileService = {
  // Upload files
  async uploadFiles(
    files: File[],
    context: string,
    contextId: string,
    category: string = 'general',
    description?: string
  ): Promise<FileItem[]> {
    const formData = new FormData();

    // Append files
    files.forEach((file) => {
      formData.append('files', file);
    });

    // Append metadata
    formData.append('context', context);
    formData.append('context_id', contextId);
    formData.append('category', category);
    if (description) {
      formData.append('description', description);
    }

    const response = await api.post('/api/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data.data;
  },

  // Get files by context
  async getFiles(
    context: string,
    contextId: string,
    category?: string,
    fileType?: 'image' | 'document',
    search?: string,
    isActive: boolean = true
  ): Promise<FileItem[]> {
    const params: any = { is_active: isActive };
    if (category && category !== 'all') params.category = category;
    if (fileType) params.file_type = fileType;
    if (search) params.search = search;

    const response = await api.get(`/api/files/${context}/${contextId}`, { params });
    return response.data.data;
  },

  // Get file count
  async getFileCount(
    context: string,
    contextId: string,
    category?: string,
    fileType?: 'image' | 'document',
    isActive: boolean = true
  ): Promise<number> {
    const params: any = { is_active: isActive };
    if (category && category !== 'all') params.category = category;
    if (fileType) params.file_type = fileType;

    const response = await api.get(`/api/files/${context}/${contextId}/count`, { params });
    return response.data.count;
  },

  // Get available categories
  async getCategories(
    context: string,
    contextId: string,
    isActive: boolean = true
  ): Promise<string[]> {
    const response = await api.get(`/api/files/${context}/${contextId}/categories`, {
      params: { is_active: isActive }
    });
    return response.data.categories;
  },

  // Update file metadata
  async updateFile(
    fileId: string,
    updates: {
      category?: string;
      description?: string;
      isActive?: boolean;
    }
  ): Promise<FileItem> {
    const response = await api.put(`/api/files/${fileId}`, updates);
    return response.data;
  },

  // Delete file
  async deleteFile(fileId: string, hardDelete: boolean = false): Promise<void> {
    await api.delete(`/api/files/${fileId}`, {
      params: { hard_delete: hardDelete }
    });
  },

  // Download file
  getDownloadUrl(fileId: string): string {
    return `${api.defaults.baseURL}/api/files/download/${fileId}`;
  },

  // Get preview URL
  getPreviewUrl(fileId: string): string {
    return `${api.defaults.baseURL}/api/files/preview/${fileId}`;
  },

  // Search files
  async searchFiles(
    context: string,
    contextId: string,
    query: string,
    isActive: boolean = true
  ): Promise<FileItem[]> {
    const response = await api.get(`/api/files/${context}/${contextId}`, {
      params: { search: query, is_active: isActive }
    });
    return response.data.data;
  },

  // Utility functions
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  isImageFile(contentType: string): boolean {
    return contentType.startsWith('image/');
  },

  isDocumentFile(contentType: string): boolean {
    const documentTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv'
    ];
    return documentTypes.includes(contentType) || !this.isImageFile(contentType);
  },

  validateFileType(file: File, allowedTypes: string[]): boolean {
    return allowedTypes.some(type => {
      if (type.endsWith('/*')) {
        return file.type.startsWith(type.slice(0, -1));
      }
      return file.type === type || file.name.toLowerCase().endsWith(type.toLowerCase());
    });
  },

  validateFileSize(file: File, maxSize: number): boolean {
    return file.size <= maxSize;
  }
};

export default fileService;