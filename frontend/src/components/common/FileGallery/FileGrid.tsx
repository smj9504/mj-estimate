import React, { useState } from 'react';
import { Card, Image, Button, Typography, Space, Tooltip, Modal, Checkbox } from 'antd';
import {
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FileOutlined,
  PictureOutlined
} from '@ant-design/icons';
import { FileItem, FileCategory } from './types';

const { Text } = Typography;
const { Meta } = Card;

interface FileGridProps {
  files: FileItem[];
  selectedFiles?: string[];
  allowMultiSelect?: boolean;
  onFileSelect?: (fileIds: string[]) => void;
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
  allowMultiSelect = false,
  onFileSelect,
  onFileClick,
  onDelete,
  fileCategory,
  showImagePreview = true,
  enableImageZoom = true,
  showImageInfo = true,
  gridColumns = { xs: 2, sm: 3, md: 4, lg: 5, xl: 6 },
  enableLazyLoading = true
}) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImage, setPreviewImage] = useState<string>('');
  const [previewTitle, setPreviewTitle] = useState<string>('');

  const handleFileSelect = (fileId: string, selected: boolean) => {
    if (!onFileSelect) return;

    let newSelection: string[];

    if (allowMultiSelect) {
      if (selected) {
        newSelection = [...selectedFiles, fileId];
      } else {
        newSelection = selectedFiles.filter(id => id !== fileId);
      }
    } else {
      newSelection = selected ? [fileId] : [];
    }

    onFileSelect(newSelection);
  };

  const handlePreview = (file: FileItem) => {
    if (fileCategory === 'image' && showImagePreview) {
      setPreviewImage(file.url);
      setPreviewTitle(file.originalName);
      setPreviewVisible(true);
    } else if (onFileClick) {
      onFileClick(file);
    }
  };

  const handleDownload = (file: FileItem) => {
    const link = document.createElement('a');
    link.href = file.url;
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
    const breakpoints = Object.entries(gridColumns)
      .map(([breakpoint, columns]) => {
        const minWidth = breakpoint === 'xs' ? '0px' :
          breakpoint === 'sm' ? '576px' :
            breakpoint === 'md' ? '768px' :
              breakpoint === 'lg' ? '992px' :
                '1200px';

        return `@media (min-width: ${minWidth}) {
          .file-grid {
            grid-template-columns: repeat(${columns}, 1fr);
          }
        }`;
      })
      .join('\n');

    return `
      .file-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(2, 1fr);
      }
      ${breakpoints}

      .file-grid-item {
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .file-grid-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .file-image {
        width: 100%;
        height: 200px;
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
        height: 200px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fafafa;
        border: 1px dashed #d9d9d9;
        cursor: pointer;
      }
    `;
  };

  const renderFileCard = (file: FileItem) => {
    const isSelected = selectedFiles.includes(file.id);
    const isImage = file.contentType.startsWith('image/');

    return (
      <Card
        key={file.id}
        className="file-grid-item"
        cover={
          <div style={{ position: 'relative' }}>
            {isImage ? (
              <>
                {enableLazyLoading ? (
                  <Image
                    src={file.thumbnailUrl || file.url}
                    alt={file.originalName}
                    className="file-image"
                    preview={false}
                    onClick={() => handlePreview(file)}
                    loading="lazy"
                  />
                ) : (
                  <img
                    src={file.thumbnailUrl || file.url}
                    alt={file.originalName}
                    className="file-image"
                    onClick={() => handlePreview(file)}
                  />
                )}
                <div className="file-overlay">
                  <Space>
                    <Button
                      type="primary"
                      shape="circle"
                      icon={<EyeOutlined />}
                      size="small"
                      onClick={() => handlePreview(file)}
                    />
                    <Button
                      type="primary"
                      shape="circle"
                      icon={<DownloadOutlined />}
                      size="small"
                      onClick={() => handleDownload(file)}
                    />
                    {onDelete && (
                      <Button
                        danger
                        shape="circle"
                        icon={<DeleteOutlined />}
                        size="small"
                        onClick={(e) => handleDelete(file, e)}
                      />
                    )}
                  </Space>
                </div>
              </>
            ) : (
              <div className="file-document-icon" onClick={() => handlePreview(file)}>
                <FileOutlined style={{ fontSize: 48, color: '#8c8c8c' }} />
              </div>
            )}

            {(onFileSelect && allowMultiSelect) && (
              <Checkbox
                checked={isSelected}
                onChange={(e) => handleFileSelect(file.id, e.target.checked)}
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  zIndex: 1
                }}
              />
            )}
          </div>
        }
        actions={!isImage ? [
          <Tooltip title="Preview">
            <EyeOutlined onClick={() => handlePreview(file)} />
          </Tooltip>,
          <Tooltip title="Download">
            <DownloadOutlined onClick={() => handleDownload(file)} />
          </Tooltip>,
          ...(onDelete ? [
            <Tooltip title="Delete">
              <DeleteOutlined onClick={(e) => handleDelete(file, e as any)} />
            </Tooltip>
          ] : [])
        ] : undefined}
        size="small"
        style={{
          border: isSelected ? '2px solid #1890ff' : '1px solid #f0f0f0'
        }}
      >
        <Meta
          title={
            <Tooltip title={file.originalName}>
              <Text ellipsis style={{ fontSize: '12px' }}>
                {file.originalName}
              </Text>
            </Tooltip>
          }
          description={
            showImageInfo && (
              <Space direction="vertical" size={2}>
                <Text type="secondary" style={{ fontSize: '11px' }}>
                  {formatFileSize(file.size)}
                </Text>
                {file.category && (
                  <Text type="secondary" style={{ fontSize: '11px' }}>
                    {file.category}
                  </Text>
                )}
                <Text type="secondary" style={{ fontSize: '11px' }}>
                  {new Date(file.uploadDate).toLocaleDateString()}
                </Text>
              </Space>
            )
          }
        />
      </Card>
    );
  };

  return (
    <>
      <style>{getGridStyle()}</style>
      <div className="file-grid">
        {files.map(renderFileCard)}
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