import React, { useState } from 'react';
import { Card, Typography, Space, Button, Modal, Image, Tag, Tooltip, Checkbox } from 'antd';
import {
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FileOutlined,
  PictureOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileTextOutlined,
  CalendarOutlined,
  UserOutlined
} from '@ant-design/icons';
import { FileItem, FileCategory } from './types';

const { Text, Paragraph } = Typography;
const { Meta } = Card;

interface FileCardProps {
  files: FileItem[];
  selectedFiles?: string[];
  allowMultiSelect?: boolean;
  onFileSelect?: (fileIds: string[]) => void;
  onFileClick?: (file: FileItem) => void;
  onDelete?: (fileId: string) => Promise<void>;
  onCategoryChange?: (fileId: string, category: string) => Promise<void>;
  fileCategory?: FileCategory;
  showImagePreview?: boolean;
  showDocumentDetails?: boolean;
}

const FileCard: React.FC<FileCardProps> = ({
  files,
  selectedFiles = [],
  allowMultiSelect = false,
  onFileSelect,
  onFileClick,
  onDelete,
  fileCategory,
  showImagePreview = true,
  showDocumentDetails = true
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
    if (file.contentType.startsWith('image/') && showImagePreview) {
      setPreviewImage(file.url);
      setPreviewTitle(file.originalName);
      setPreviewVisible(true);
    } else if (onFileClick) {
      onFileClick(file);
    }
  };

  const handleDownload = (file: FileItem, e: React.MouseEvent) => {
    e.stopPropagation();
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

  const getFileIcon = (file: FileItem) => {
    const { contentType } = file;

    if (contentType.startsWith('image/')) {
      return <PictureOutlined style={{ fontSize: 32, color: '#52c41a' }} />;
    }

    if (contentType === 'application/pdf') {
      return <FilePdfOutlined style={{ fontSize: 32, color: '#ff4d4f' }} />;
    }

    if (contentType.includes('word') || contentType.includes('document')) {
      return <FileWordOutlined style={{ fontSize: 32, color: '#1890ff' }} />;
    }

    if (contentType.includes('excel') || contentType.includes('spreadsheet')) {
      return <FileExcelOutlined style={{ fontSize: 32, color: '#52c41a' }} />;
    }

    if (contentType.includes('powerpoint') || contentType.includes('presentation')) {
      return <FilePptOutlined style={{ fontSize: 32, color: '#fa8c16' }} />;
    }

    if (contentType.startsWith('text/')) {
      return <FileTextOutlined style={{ fontSize: 32, color: '#722ed1' }} />;
    }

    return <FileOutlined style={{ fontSize: 32, color: '#8c8c8c' }} />;
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
    const isSelected = selectedFiles.includes(file.id);
    const isImage = file.contentType.startsWith('image/');

    const actions = [
      <Tooltip title="Preview">
        <EyeOutlined onClick={() => handlePreview(file)} />
      </Tooltip>,
      <Tooltip title="Download">
        <DownloadOutlined onClick={(e) => handleDownload(file, e)} />
      </Tooltip>
    ];

    if (onDelete) {
      actions.push(
        <Tooltip title="Delete">
          <DeleteOutlined onClick={(e) => handleDelete(file, e)} />
        </Tooltip>
      );
    }

    const cover = isImage ? (
      <div style={{ position: 'relative', height: 200, overflow: 'hidden' }}>
        <img
          src={file.thumbnailUrl || file.url}
          alt={file.originalName}
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
          backgroundColor: '#fafafa',
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
          border: isSelected ? '2px solid #1890ff' : '1px solid #f0f0f0',
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

export default FileCard;