import React, { useState, memo, useRef, useEffect, useMemo, useCallback } from 'react';
import { Card, Image, Typography, Modal, Checkbox, Tag, message } from 'antd';
import {
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FileOutlined
} from '@ant-design/icons';
import { FileItem, FileCategory } from './types';
import { fileService } from '../../../services/fileService';
import dayjs from 'dayjs';

const { Text } = Typography;

// Optimized lazy loading image component with Intersection Observer
interface LazyImageProps {
  src: string;
  fallbackSrc: string;
  alt: string;
  enableLazyLoading: boolean;
}

const LazyImage: React.FC<LazyImageProps> = memo(({ src, fallbackSrc, alt, enableLazyLoading }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(enableLazyLoading ? null : src);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!enableLazyLoading || !imgRef.current) {
      setImageSrc(src);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setImageSrc(src);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '50px', // Start loading 50px before image enters viewport
        threshold: 0.01
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [src, enableLazyLoading]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      backgroundColor: '#f0f0f0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {/* Loading placeholder - shows skeleton while image loads */}
      {!isLoaded && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s infinite'
        }} />
      )}
      <img
        ref={imgRef}
        src={imageSrc || undefined}
        alt={alt}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          opacity: isLoaded ? 1 : 0,
          transition: 'opacity 0.15s ease'
        }}
        loading={enableLazyLoading ? "lazy" : "eager"}
        decoding="async"
        // @ts-ignore - fetchpriority is a valid HTML attribute
        fetchpriority={enableLazyLoading ? "low" : "high"}
        onLoad={() => setIsLoaded(true)}
        onError={(e) => {
          // Fallback to full image if thumbnail fails
          const img = e.target as HTMLImageElement;
          if (img.src !== fallbackSrc && imageSrc !== fallbackSrc) {
            setImageSrc(fallbackSrc);
          }
        }}
      />
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
});

LazyImage.displayName = 'LazyImage';

// Image quality levels based on display size
type ImageQuality = 'original' | 'web' | 'thumbnail';

// Memoized individual file card component to prevent unnecessary re-renders
interface FileCardItemProps {
  file: FileItem;
  isSelected: boolean;
  allowMultiSelect: boolean;
  fileCategory?: FileCategory;
  showImagePreview: boolean;
  showImageInfo: boolean;
  enableLazyLoading: boolean;
  imageQuality: ImageQuality; // Changed from useHighQualityThumbnails
  onSelect: (fileId: string, selected: boolean) => void;
  onPreview: (file: FileItem) => void;
  onDownload: (file: FileItem) => void;
  onDelete?: (file: FileItem, e: React.MouseEvent) => void;
  onCardClick: (file: FileItem, e: React.MouseEvent) => void;
  renderCardExtraAction?: (file: FileItem) => React.ReactNode;
}

const FileCardItem = memo<FileCardItemProps>(({
  file,
  isSelected,
  allowMultiSelect,
  fileCategory,
  showImagePreview,
  showImageInfo,
  enableLazyLoading,
  imageQuality,
  onSelect,
  onPreview,
  onDownload,
  onDelete,
  onCardClick,
  renderCardExtraAction
}) => {
  // Critical: Guard against undefined file during virtual scroll remount
  if (!file || !file.id) {
    return null;
  }

  const contentType = file.contentType || file.mimeType || '';
  // Determine if file is an image: use contentType OR fileCategory prop
  const isImage = contentType.startsWith('image/') || fileCategory === 'image';

  // Ensure imageQuality has a default value
  const quality = imageQuality || 'web';

  return (
    <Card
      key={file.id}
      className="file-grid-item"
      styles={{ body: { padding: 0 } }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        // Ignore clicks on buttons and checkboxes
        if (!target.closest('button') && !target.closest('.ant-checkbox-wrapper')) {
          onCardClick(file, e);
        }
      }}
      cover={
        <div style={{ position: 'relative', width: '100%', aspectRatio: '3 / 4', overflow: 'hidden', background: '#f5f5f5' }}>
          {isImage ? (
            <>
              <LazyImage
                src={
                  quality === 'original'
                    ? (file.fileUrl || file.url || file.thumbnailUrl || '')
                    : quality === 'web'
                    ? (file.url || file.thumbnailUrl || '')
                    : (file.thumbnailUrl || file.url || '')
                }
                fallbackSrc={file.url || file.thumbnailUrl || ''}
                alt={file.originalName}
                enableLazyLoading={enableLazyLoading}
              />
              {/* Date and Category overlay - always visible at bottom */}
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                padding: '20px 8px 6px 8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '4px'
              }}>
                <Text style={{ color: '#fff', fontSize: '11px' }}>
                  {dayjs(file.uploadDate || file.createdAt).format('MMM D, YYYY')}
                </Text>
                {file.category && (
                  <Tag 
                    color="blue" 
                    style={{ 
                      margin: 0, 
                      fontSize: '10px',
                      padding: '0 4px',
                      lineHeight: '18px'
                    }}
                  >
                    {file.category}
                  </Tag>
                )}
              </div>
              {/* Action buttons overlay - visible on hover */}
              <div className="file-overlay">
                <div style={{ display: 'flex', gap: 8 }}>
                  <div
                    className="overlay-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (file) onPreview(file);
                    }}
                    title="Preview"
                  >
                    <EyeOutlined style={{ color: '#fff', fontSize: 16 }} />
                  </div>
                  <div
                    className="overlay-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (file) onDownload(file);
                    }}
                    title="Download"
                  >
                    <DownloadOutlined style={{ color: '#fff', fontSize: 16 }} />
                  </div>
                  {onDelete && (
                    <div
                      className="overlay-btn overlay-btn-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (file) onDelete(file, e);
                      }}
                      title="Delete"
                    >
                      <DeleteOutlined style={{ color: '#fff', fontSize: 16 }} />
                    </div>
                  )}
                  {renderCardExtraAction && (
                    <div
                      className="overlay-btn"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderCardExtraAction(file)}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="file-document-icon">
              <FileOutlined style={{ fontSize: 48, color: '#8c8c8c' }} />
            </div>
          )}

          {allowMultiSelect && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                zIndex: 10,
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                borderRadius: '4px',
                padding: '4px'
              }}
            >
              <Checkbox
                checked={isSelected}
                onChange={(e) => {
                  if (file && file.id) {
                    onSelect(file.id, e.target.checked);
                  }
                }}
              />
            </div>
          )}
        </div>
      }
      actions={!isImage && file ? [
        <span key="preview" onClick={() => onPreview(file)} title="Preview">
          <EyeOutlined style={{}} />
        </span>,
        <span key="download" onClick={() => onDownload(file)} title="Download">
          <DownloadOutlined style={{}} />
        </span>,
        ...(onDelete ? [
          <span key="delete" onClick={(e) => onDelete(file, e as any)} title="Delete">
            <DeleteOutlined style={{}} />
          </span>
        ] : []),
        ...(renderCardExtraAction ? [
          <span key="extra-action" onClick={(e) => e.stopPropagation()}>
            {renderCardExtraAction(file)}
          </span>
        ] : [])
      ] : undefined}
      size="small"
      style={{
        border: isSelected ? '2px solid #1890ff' : '1px solid #f0f0f0',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease' // Smooth visual feedback
      }}
    >
    </Card>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for memo
  // Only re-render if these props change

  // Guard against undefined during virtual scroll
  if (!prevProps.file || !nextProps.file) {
    return false; // Force re-render if either is undefined
  }

  return (
    prevProps.file.id === nextProps.file.id &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.allowMultiSelect === nextProps.allowMultiSelect
  );
});

FileCardItem.displayName = 'FileCardItem';

interface FileGridProps {
  files: FileItem[];
  selectedFiles?: string[];
  selectedFilesSet?: Set<string>;  // O(1) lookup Set
  allowMultiSelect?: boolean;
  onFileSelect?: (fileIds: string[] | Set<string>) => void;
  onFileClick?: (file: FileItem) => void;
  onDelete?: (fileId: string) => Promise<void>;
  onCategoryChange?: (fileId: string, category: string) => Promise<void>;
  fileCategory?: FileCategory;
  showImagePreview?: boolean;
  enableImageZoom?: boolean;
  showImageInfo?: boolean;
  gridColumns?: Record<string, number>;
  enableLazyLoading?: boolean;
  imageQuality?: ImageQuality; // Image quality: 'original' (full res), 'web' (400px), 'thumbnail' (250px)
  context?: string; // Context for download URL routing
  renderCardExtraAction?: (file: FileItem) => React.ReactNode;
}

const FileGrid: React.FC<FileGridProps> = ({
  files,
  selectedFiles = [],
  selectedFilesSet,
  allowMultiSelect = false,
  onFileSelect,
  onFileClick,
  onDelete,
  fileCategory,
  showImagePreview = true,
  enableImageZoom = true,
  showImageInfo = true,
  gridColumns = { xs: 3, sm: 4, md: 5, lg: 6, xl: 8 },
  enableLazyLoading = true,
  imageQuality = 'thumbnail',
  context,
  renderCardExtraAction
}) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImage, setPreviewImage] = useState<string>('');
  const [previewTitle, setPreviewTitle] = useState<string>('');

  // Use Set if provided, otherwise fallback to array
  const currentSelectedSet = React.useMemo(
    () => selectedFilesSet || new Set(selectedFiles),
    [selectedFilesSet, selectedFiles]
  );

  // Use ref to avoid recreating callback on every selection change
  const currentSelectedSetRef = React.useRef(currentSelectedSet);
  React.useEffect(() => {
    currentSelectedSetRef.current = currentSelectedSet;
  }, [currentSelectedSet]);

  // Optimized file selection handler using Set operations (O(1))
  const handleFileSelect = React.useCallback((fileId: string, selected: boolean, ctrlKey?: boolean) => {
    if (!onFileSelect) return;

    // Use Set for O(1) operations - use ref for current value
    const newSelection = new Set(currentSelectedSetRef.current);

    if (!allowMultiSelect) {
      // Single selection mode
      newSelection.clear();
      if (selected) newSelection.add(fileId);
    } else if (ctrlKey || selected) {
      // Ctrl+Click or checkbox click: toggle
      if (newSelection.has(fileId)) {
        newSelection.delete(fileId);  // O(1) delete
      } else {
        newSelection.add(fileId);     // O(1) add
      }
    } else {
      // Uncheck: remove from selection
      newSelection.delete(fileId);    // O(1) delete
    }

    // Pass Set to parent (parent will convert to array if needed)
    onFileSelect(newSelection);
  }, [allowMultiSelect, onFileSelect]);

  const handlePreview = useCallback((file: FileItem) => {
    if (fileCategory === 'image' && showImagePreview) {
      // Use original high-resolution image for preview modal
      // fileUrl = original full resolution, url = optimized web preview
      const previewUrl = file.fileUrl || file.url;
      setPreviewImage(previewUrl);
      setPreviewTitle(file.originalName);
      setPreviewVisible(true);
    } else if (file.contentType === 'application/pdf') {
      // Open PDF in new tab
      window.open(file.url, '_blank');
    } else if (onFileClick) {
      onFileClick(file);
    }
  }, [fileCategory, showImagePreview, onFileClick]);

  const downloadingRef = useRef<Set<string>>(new Set());
  const handleDownload = useCallback(async (file: FileItem) => {
    if (downloadingRef.current.has(file.id)) return;
    downloadingRef.current.add(file.id);
    const hide = message.loading('다운로드 중...', 0);
    try {
      const url = context === 'water-mitigation'
        ? `/api/water-mitigation/photos/${file.id}/download`
        : fileService.getDownloadUrl(file.id);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = file.originalName || `photo_${file.id}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      message.success('다운로드 완료');
    } catch (err) {
      console.error('Download failed:', err);
      message.error('다운로드 실패');
    } finally {
      hide();
      downloadingRef.current.delete(file.id);
    }
  }, [context]);

  const handleDelete = useCallback(async (file: FileItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      await onDelete(file.id);
    }
  }, [onDelete]);

  // Get the appropriate column count based on screen size and gridColumns prop
  const getResponsiveColumnCount = useCallback(() => {
    // Guard against undefined gridColumns
    const cols = gridColumns || { xs: 2, sm: 3, md: 4, lg: 5, xl: 6 };
    const width = window.innerWidth;
    if (width < 576) return cols.xs || 2;
    if (width < 768) return cols.sm || 3;
    if (width < 992) return cols.md || 4;
    if (width < 1200) return cols.lg || 5;
    return cols.xl || 6;
  }, [gridColumns]);

  const [responsiveColumns, setResponsiveColumns] = useState(() => getResponsiveColumnCount());

  // Update columns on window resize
  useEffect(() => {
    const handleResize = () => {
      setResponsiveColumns(getResponsiveColumnCount());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [getResponsiveColumnCount]);

  // Update columns when gridColumns prop changes
  useEffect(() => {
    setResponsiveColumns(getResponsiveColumnCount());
  }, [gridColumns, getResponsiveColumnCount]);

  const getGridStyle = () => {
    return `
      .file-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(${responsiveColumns}, 1fr);
      }

      .file-grid-item {
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .file-grid-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .file-image {
        width: 100%;
        aspect-ratio: 3 / 4;
        object-fit: cover;
        cursor: pointer;
      }

      .file-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .file-grid-item:hover .file-overlay {
        opacity: 1;
      }

      .overlay-btn {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: #1890ff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.2s ease;
      }

      .overlay-btn:hover {
        background: #40a9ff;
      }

      .overlay-btn-danger {
        background: #ff4d4f;
      }

      .overlay-btn-danger:hover {
        background: #ff7875;
      }

      .file-document-icon {
        width: 100%;
        aspect-ratio: 3 / 4;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fafafa;
        border: 1px dashed #d9d9d9;
        cursor: pointer;
      }
    `;
  };

  const handleCardClick = useCallback((file: FileItem, e: React.MouseEvent) => {
    // Handle Ctrl+Click for multi-select
    if (allowMultiSelect && e.ctrlKey && onFileSelect) {
      e.preventDefault();
      e.stopPropagation();
      handleFileSelect(file.id, true, true);
    } else if (!e.ctrlKey) {
      // Normal click without Ctrl - preview
      handlePreview(file);
    }
  }, [allowMultiSelect, onFileSelect, handleFileSelect, handlePreview]);

  // Memoized handler to prevent recreation
  const handleFileSelectMemo = React.useCallback((fileId: string, selected: boolean) => {
    handleFileSelect(fileId, selected);
  }, [handleFileSelect]);

  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <style>{getGridStyle()}</style>
      <div
        ref={containerRef}
        className="file-grid"
      >
        {files.map((file, index) => (
          <FileCardItem
            key={file.id}
            file={file}
            isSelected={currentSelectedSet.has(file.id)}
            allowMultiSelect={allowMultiSelect}
            fileCategory={fileCategory}
            showImagePreview={showImagePreview}
            showImageInfo={showImageInfo}
            enableLazyLoading={index >= responsiveColumns * 3 ? enableLazyLoading : false}
            imageQuality={imageQuality}
            onSelect={handleFileSelectMemo}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onDelete={onDelete ? handleDelete : undefined}
            onCardClick={handleCardClick}
            renderCardExtraAction={renderCardExtraAction}
          />
        ))}
      </div>

      {/* Image Preview Modal */}
      <Modal
        open={previewVisible}
        title={previewTitle}
        footer={null}
        onCancel={() => setPreviewVisible(false)}
        width="80%"
        style={{ top: 20 }}
        styles={{ body: { textAlign: 'center' } }}
        destroyOnHidden
      >
        <Image
          src={previewImage}
          alt={previewTitle}
          style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 160px)', objectFit: 'contain' }}
          preview={false}
        />
      </Modal>
    </>
  );
};

export default FileGrid;