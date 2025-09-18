export { default as FileGallery } from './FileGallery';
export { default as FileGrid } from './FileGrid';
export { default as FileList } from './FileList';
export { default as FileCard } from './FileCard';
export { default as FileUploadZone } from './FileUploadZone';
export { default as ViewModeSelector } from './ViewModeSelector';
export { default as CategoryManager } from './CategoryManager';

export { useFileGallery } from './hooks/useFileGallery';

export type {
  FileItem,
  FileGalleryProps,
  ViewMode,
  FileContext,
  FileCategory,
  UploadProgress
} from './types';

// Re-export the main component as default
export { default } from './FileGallery';