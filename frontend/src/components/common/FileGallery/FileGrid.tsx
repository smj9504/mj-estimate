import React, { useState, memo } from 'react';
import { Card, Image, Button, Typography, Space, Tooltip, Modal, Checkbox } from 'antd';
import {
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FileOutlined,
  PictureOutlined
} from '@ant-design/icons';
import { FileItem, FileCategory } from './types';
import { fileService } from '../../../services/fileService';

const { Text } = Typography;
const { Meta } = Card;

// Memoized individual file card component to prevent unnecessary re-renders
interface FileCardItemProps {
  file: FileItem;
  isSelected: boolean;
  allowMultiSelect: boolean;
  fileCategory?: FileCategory;
  showImagePreview: boolean;
  showImageInfo: boolean;
  enableLazyLoading: boolean;
  onSelect: (fileId: string, selected: boolean) => void;
  onPreview: (file: FileItem) => void;
  onDownload: (file: FileItem) => void;
  onDelete?: (file: FileItem, e: React.MouseEvent) => void;
  onCardClick: (file: FileItem, e: React.MouseEvent) => void;
}

const FileCardItem = memo<FileCardItemProps>(({
  file,
  isSelected,
  allowMultiSelect,
  fileCategory,
  showImagePreview,
  showImageInfo,
  enableLazyLoading,
  onSelect,
  onPreview,
  onDownload,
  onDelete,
  onCardClick
}) => {
  const contentType = file.contentType || file.mimeType || '';
  const isImage = contentType.startsWith('image/');

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Card
      key={file.id}
      className="file-grid-item"
      bodyStyle={{ padding: 0 }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        // Ignore clicks on buttons and checkboxes
        if (!target.closest('button') && !target.closest('.ant-checkbox-wrapper')) {
          onCardClick(file, e);
        }
      }}
      cover={
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1', overflow: 'hidden', background: '#f5f5f5' }}>
          {isImage ? (
            <>
              <img
                src={file.thumbnailUrl || file.url}
                alt={file.originalName}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                loading={enableLazyLoading ? "lazy" : undefined}
                onError={(e) => {
                  // Fallback to full image if thumbnail fails
                  const img = e.target as HTMLImageElement;
                  if (img.src !== file.url) {
                    img.src = file.url;
                  }
                }}
              />
              <div className="file-overlay">
                <Space direction="vertical" align="center" style={{ width: '100%' }}>
                  {showImageInfo && (
                    <div style={{
                      backgroundColor: 'rgba(0, 0, 0, 0.75)',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      textAlign: 'center',
                      marginBottom: '8px'
                    }}>
                      <Text style={{ color: '#fff', fontSize: '12px', display: 'block' }}>
                        {file.originalName}
                      </Text>
                      {file.size && (
                        <Text style={{ color: '#bbb', fontSize: '11px', display: 'block' }}>
                          {formatFileSize(file.size)}
                        </Text>
                      )}
                    </div>
                  )}
                  <Space>
                    <Button
                      type="primary"
                      shape="circle"
                      icon={<EyeOutlined />}
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreview(file);
                      }}
                    />
                    <Button
                      type="primary"
                      shape="circle"
                      icon={<DownloadOutlined />}
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload(file);
                      }}
                    />
                    {onDelete && (
                      <Button
                        danger
                        shape="circle"
                        icon={<DeleteOutlined />}
                        size="small"
                        onClick={(e) => onDelete(file, e)}
                      />
                    )}
                  </Space>
                </Space>
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
                  onSelect(file.id, e.target.checked);
                }}
              />
            </div>
          )}
        </div>
      }
      actions={!isImage ? [
        <Tooltip title="Preview">
          <EyeOutlined onClick={() => onPreview(file)} />
        </Tooltip>,
        <Tooltip title="Download">
          <DownloadOutlined onClick={() => onDownload(file)} />
        </Tooltip>,
        ...(onDelete ? [
          <Tooltip title="Delete">
            <DeleteOutlined onClick={(e) => onDelete(file, e as any)} />
          </Tooltip>
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
  enableLazyLoading = true
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

  const handlePreview = (file: FileItem) => {
    if (fileCategory === 'image' && showImagePreview) {
      setPreviewImage(file.url);
      setPreviewTitle(file.originalName);
      setPreviewVisible(true);
    } else if (file.contentType === 'application/pdf') {
      // Open PDF in new tab
      window.open(file.url, '_blank');
    } else if (onFileClick) {
      onFileClick(file);
    }
  };

  const handleDownload = (file: FileItem) => {
    const link = document.createElement('a');
    link.href = fileService.getDownloadUrl(file.id);
    link.download = file.originalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = async (file: FileItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      await onDelete(file.id);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getGridStyle = () => {
    return `
      .file-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
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
        aspect-ratio: 1;
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

      .file-document-icon {
        width: 100%;
        aspect-ratio: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fafafa;
        border: 1px dashed #d9d9d9;
        cursor: pointer;
      }
    `;
  };

  const handleCardClick = (file: FileItem, e: React.MouseEvent) => {
    // Handle Ctrl+Click for multi-select
    if (allowMultiSelect && e.ctrlKey && onFileSelect) {
      e.preventDefault();
      e.stopPropagation();
      handleFileSelect(file.id, true, true);
    } else if (!e.ctrlKey) {
      // Normal click without Ctrl - preview
      handlePreview(file);
    }
  };

  // Memoized handler to prevent recreation
  const handleFileSelectMemo = React.useCallback((fileId: string, selected: boolean) => {
    handleFileSelect(fileId, selected);
  }, [handleFileSelect]);

  return (
    <>
      <style>{getGridStyle()}</style>
      <div className="file-grid">
        {files.map((file) => (
          <FileCardItem
            key={file.id}
            file={file}
            isSelected={currentSelectedSet.has(file.id)}
            allowMultiSelect={allowMultiSelect}
            fileCategory={fileCategory}
            showImagePreview={showImagePreview}
            showImageInfo={showImageInfo}
            enableLazyLoading={enableLazyLoading}
            onSelect={handleFileSelectMemo}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onDelete={onDelete ? handleDelete : undefined}
            onCardClick={handleCardClick}
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
      >
        <Image
          src={previewImage}
          alt={previewTitle}
          style={{ width: '100%' }}
          preview={false}
        />
      </Modal>
    </>
  );
};

export default FileGrid;