import React, { useState, useRef } from 'react';
import { Card, Typography, Space, Button, Tag, Tooltip, Checkbox, message } from 'antd';
import {
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FileOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileTextOutlined,
  CalendarOutlined,
  UserOutlined
} from '@ant-design/icons';
import { FileItem, FileCategory } from './types';
import MediaPreviewModal, { isVideoFile } from './MediaPreviewModal';
import { fileService } from '../../../services/fileService';
import api from '../../../services/api';

const { Text, Paragraph } = Typography;
const { Meta } = Card;

interface FileCardProps {
  files: FileItem[];
  context?: string;  // Context for context-aware download URLs
  selectedFiles?: string[];
  selectedFilesSet?: Set<string>; // O(1) lookup Set
  allowMultiSelect?: boolean;
  onFileSelect?: (fileIds: string[]) => void;
  onFileClick?: (file: FileItem) => void;
  onDelete?: (fileId: string) => Promise<void>;
  onCategoryChange?: (fileId: string, category: string) => Promise<void>;
  fileCategory?: FileCategory;
  showImagePreview?: boolean;
  showDocumentDetails?: boolean;
  renderCardExtraAction?: (file: FileItem) => React.ReactNode;
}

const FileCard: React.FC<FileCardProps> = ({
  files,
  context,
  selectedFiles = [],
  selectedFilesSet,
  allowMultiSelect = false,
  onFileSelect,
  onFileClick,
  onDelete,
  fileCategory,
  showImagePreview = true,
  showDocumentDetails = true,
  renderCardExtraAction
}) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  // Use Set if provided, otherwise fallback to array
  const currentSelectedSet = React.useMemo(
    () => selectedFilesSet || new Set(selectedFiles),
    [selectedFilesSet, selectedFiles]
  );

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
    const contentType = file.contentType || file.mimeType || '';
    if ((contentType.startsWith('image/') || isVideoFile(file)) && showImagePreview) {
      // Original high-resolution image, or the video playing
      setPreviewFile(file);
      setPreviewVisible(true);
    } else if (contentType === 'application/pdf') {
      // Open PDF in new tab
      window.open(file.url, '_blank');
    } else if (onFileClick) {
      onFileClick(file);
    }
  };

  const downloadingRef = useRef<Set<string>>(new Set());
  const handleDownload = async (file: FileItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloadingRef.current.has(file.id)) return;
    downloadingRef.current.add(file.id);
    const hide = message.loading('다운로드 중...', 0);
    try {
      // A bare /api path hits Vercel's index.html fallback in production, not the backend
      const url = context === 'water-mitigation'
        ? `${api.defaults.baseURL || ''}/api/water-mitigation/photos/${file.id}/download`
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
  };

  const handleDelete = async (file: FileItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      await onDelete(file.id);
    }
  };

  const getFileIcon = (file: FileItem) => {
    const contentType = file.contentType || file.mimeType || '';

    if (contentType.startsWith('video/')) {
      return <VideoCameraOutlined style={{ fontSize: 32, color: '#1f74c9' }} />;
    }

    if (contentType.startsWith('image/')) {
      return <PictureOutlined style={{ fontSize: 32, color: '#448361' }} />;
    }

    if (contentType === 'application/pdf') {
      return <FilePdfOutlined style={{ fontSize: 32, color: '#d44c47' }} />;
    }

    if (contentType.includes('word') || contentType.includes('document')) {
      return <FileWordOutlined style={{ fontSize: 32, color: '#1f74c9' }} />;
    }

    if (contentType.includes('excel') || contentType.includes('spreadsheet')) {
      return <FileExcelOutlined style={{ fontSize: 32, color: '#448361' }} />;
    }

    if (contentType.includes('powerpoint') || contentType.includes('presentation')) {
      return <FilePptOutlined style={{ fontSize: 32, color: '#d9730d' }} />;
    }

    if (contentType.startsWith('text/')) {
      return <FileTextOutlined style={{ fontSize: 32, color: '#9065b0' }} />;
    }

    return <FileOutlined style={{ fontSize: 32, color: '#73726e' }} />;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const renderFileCard = (file: FileItem) => {
    // Use Set for O(1) lookup instead of Array.includes() which is O(n)
    const isSelected = currentSelectedSet.has(file.id);
    const contentType = file.contentType || file.mimeType || '';
    const isImage = contentType.startsWith('image/');

    const actions = [
      <Tooltip title="Preview" key="preview">
        <EyeOutlined style={{}} onClick={() => handlePreview(file)} />
      </Tooltip>,
      <Tooltip title="Download" key="download">
        <DownloadOutlined style={{}} onClick={(e) => handleDownload(file, e)} />
      </Tooltip>
    ];

    if (onDelete) {
      actions.push(
        <Tooltip title="Delete" key="delete">
          <DeleteOutlined style={{}} onClick={(e) => handleDelete(file, e)} />
        </Tooltip>
      );
    }

    if (renderCardExtraAction) {
      actions.push(
        <span key="extra-action" onClick={(e) => e.stopPropagation()}>
          {renderCardExtraAction(file)}
        </span>
      );
    }

    const cover = isImage ? (
      <div style={{ position: 'relative', height: 200, overflow: 'hidden' }}>
        <img
          src={file.url}
          alt={file.originalName}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            cursor: 'pointer'
          }}
          onClick={() => handlePreview(file)}
        />
        {onFileSelect && (
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
    ) : (
      <div
        style={{
          height: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f7f7f5',
          cursor: 'pointer',
          position: 'relative'
        }}
        onClick={() => handlePreview(file)}
      >
        {getFileIcon(file)}
        {onFileSelect && (
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
    );

    return (
      <Card
        key={file.id}
        cover={cover}
        actions={actions}
        style={{
          width: 280,
          margin: 8,
          border: isSelected ? '2px solid #1f74c9' : '1px solid #e9e9e7',
          transition: 'all 0.2s ease'
        }}
        hoverable
      >
        <Meta
          title={
            <Tooltip title={file.originalName}>
              <Text ellipsis strong>
                {file.originalName}
              </Text>
            </Tooltip>
          }
          description={
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {/* File Info */}
              <Space wrap>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  {formatFileSize(file.size)}
                </Text>
                {file.category && (
                  <Tag color="blue" style={{ fontSize: '11px', padding: '2px 6px' }}>
                    {file.category}
                  </Tag>
                )}
              </Space>

              {/* Upload Info */}
              <Space direction="vertical" size={4}>
                <Space>
                  <CalendarOutlined style={{ fontSize: '12px' }} />
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    {formatDate(file.uploadDate)}
                  </Text>
                </Space>
                {file.uploadedBy && (
                  <Space>
                    <UserOutlined style={{ fontSize: '12px' }} />
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      {file.uploadedBy}
                    </Text>
                  </Space>
                )}
              </Space>

              {/* Description */}
              {file.description && showDocumentDetails && (
                <Paragraph
                  ellipsis={{ rows: 2, expandable: false }}
                  style={{
                    fontSize: '12px',
                    margin: 0,
                    color: '#666'
                  }}
                >
                  {file.description}
                </Paragraph>
              )}
            </Space>
          }
        />
      </Card>
    );
  };

  const gridStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    gap: 0
  };

  return (
    <>
      <div style={gridStyle}>
        {files.map(renderFileCard)}
      </div>

      {/* Image / Video Preview Modal */}
      <MediaPreviewModal
        open={previewVisible}
        file={previewFile}
        onClose={() => setPreviewVisible(false)}
      />
    </>
  );
};

export default FileCard;