export type ViewMode = 'grid' | 'list' | 'card';
export type FileContext = 'work-order' | 'daily-log' | 'hauling-estimate' | 'general';
export type FileCategory = 'image' | 'document';

export interface FileItem {
  id: string;
  filename: string;
  originalName: string;
  url: string;
  thumbnailUrl?: string;
  contentType: string;
  size: number;
  uploadDate: string;
  category?: string;
  description?: string;
  uploadedBy?: string;
  context: string;
  contextId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface FileGalleryProps {
  // Context & Mode
  context: FileContext;
  mode?: 'upload' | 'select' | 'view';
  contextId?: string;

  // File Type Configuration
  fileCategory?: FileCategory;
  allowedTypes?: string[];
  maxFileSize?: number;
  maxFiles?: number;

  // Selection
  allowMultiSelect?: boolean;
  selectedFiles?: string[];
  onFileSelect?: (fileIds: string[]) => void;

  // Categories
  categories?: string[];
  allowCategoryCreate?: boolean;
  onCategoryCreate?: (category: string) => void;

  // View Options
  defaultViewMode?: ViewMode;
  allowViewModeChange?: boolean;
  showCategories?: boolean;

  // Upload Configuration
  allowUpload?: boolean;
  allowBulkUpload?: boolean;
  uploadConfig?: {
    multiple?: boolean;
    showUploadList?: boolean;
    listType?: 'text' | 'picture' | 'picture-card';
    accept?: string;
  };

  // Image-specific features
  showImagePreview?: boolean;
  enableImageZoom?: boolean;
  showImageInfo?: boolean;
  gridColumns?: Record<string, number>;
  showThumbnails?: boolean;
  enableLazyLoading?: boolean;

  // Document-specific features
  showDocumentPreview?: boolean;
  enableDocumentSearch?: boolean;
  showDocumentDetails?: boolean;
  listLayout?: 'simple' | 'detailed';
  showPreviewPanel?: boolean;
  enableFullTextSearch?: boolean;

  // Layout & Styling
  height?: string;
  className?: string;

  // Callbacks
  onUpload?: (files: File[], category?: string) => Promise<void>;
  onDelete?: (fileId: string) => Promise<void>;
  onFileClick?: (file: FileItem) => void;
}

export interface UploadProgress {
  fileId: string;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
}