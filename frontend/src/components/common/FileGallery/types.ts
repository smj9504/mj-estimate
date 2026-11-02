import type { ReactNode } from 'react';

export type ViewMode = 'grid' | 'list' | 'card';
export type FileContext = 'work-order' | 'daily-log' | 'hauling-estimate' | 'water-mitigation' | 'claim' | 'general';
export type FileCategory = 'image' | 'document';

export interface FileItem {
  id: string;
  filename: string;
  originalName: string;
  url: string;
  fileUrl?: string;
  thumbnailUrl?: string;
  contentType?: string;
  mimeType?: string;
  size: number;
  uploadDate: string;
  category?: string;
  description?: string;
  uploadedBy?: string;
  context?: string;
  contextId?: string;
  isActive?: boolean;
  createdAt: string;
  updatedAt?: string;
  // Water-mitigation-specific location tag (undefined for other contexts)
  locationLevel?: string;
  locationRoom?: string;
  // Water-mitigation: its id where it came from (CompanyCam, MagicPlan)
  externalId?: string;
  // Water-mitigation "Similar" sort: photos sharing a group look alike
  similarGroup?: number;
  similarGroupSize?: number;
  similarIndex?: number;
  // Videos: url and thumbnailUrl are its poster, this is the video itself
  videoUrl?: string;
  videoDownloadUrl?: string;
  // How the server's poster and browser-playable copy are coming along
  videoStatus?: 'pending' | 'processing' | 'ready' | 'failed';
  durationSeconds?: number;
}

// Water-mitigation photo order: newest first, or similar-looking photos together
export type PhotoSortBy = 'captured_date' | 'similarity';

export interface FileGalleryProps {
  // Context & Mode
  context: FileContext;
  mode?: 'upload' | 'select' | 'view';
  contextId?: string;

  // File Type Configuration
  fileCategory?: FileCategory;
  allowedTypes?: string[];
  maxFileSize?: number;
  // A video's limit where it differs from a photo's (default: maxFileSize)
  maxVideoFileSize?: number;
  maxFiles?: number;

  // Selection
  allowMultiSelect?: boolean;
  selectedFiles?: string[];
  onFileSelect?: (fileIds: string[]) => void;

  // Categories
  categories?: string[];
  defaultCategory?: string;  // Default selected category (default: 'all')
  allowCategoryCreate?: boolean;
  onCategoryCreate?: (category: string) => void;
  showBulkCategoryUpdate?: boolean;  // Show/hide bulk category update action (default: true)
  showBulkActions?: boolean;  // Show/hide entire bulk actions bar (default: true)
  showSelectAll?: boolean;  // Show/hide select all button (default: true)

  // View Options
  defaultViewMode?: ViewMode;
  allowViewModeChange?: boolean;
  showCategories?: boolean;
  enableDateGrouping?: boolean;

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

  // Performance optimization
  enableInfiniteScroll?: boolean;
  pageSize?: number;

  // Source filter (for water-mitigation: 'companycam' | 'magicplan' | 'manual_upload')
  sourceFilter?: string;

  // Leave out videos, for choosing pictures to put in a document
  photosOnly?: boolean;

  // Photo order (water-mitigation only)
  sortBy?: PhotoSortBy;

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

  // Optional extra action rendered alongside Preview/Download/Delete in each
  // file card's action bar. Purely additive/opt-in - omitting it leaves
  // every existing consumer of FileGallery unchanged.
  renderCardExtraAction?: (file: FileItem) => ReactNode;

  // Optional extra control(s) rendered in the bulk-actions bar alongside
  // Set Category / Change Date / Delete, receiving the currently selected
  // files. Lets a consumer add its own bulk operation without FileGallery
  // needing to know anything domain-specific. Omitting it changes nothing.
  renderBulkExtraAction?: (
    selected: FileItem[],
    opts: { compact: boolean; clearSelection: () => void }
  ) => ReactNode;
}

export interface UploadProgress {
  fileId: string;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
}

export interface DateGroup {
  date: string; // ISO date string (YYYY-MM-DD)
  displayDate: string; // Formatted display string
  files: FileItem[];
  count: number;
}