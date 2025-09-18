import React, { useState } from 'react';
import { List, Avatar, Button, Typography, Space, Modal, Image, Checkbox, Tag, Tooltip } from 'antd';
import {
  FileOutlined,
  PictureOutlined,
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { FileItem, FileCategory } from './types';

const { Text } = Typography;

interface FileListProps {
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
  listLayout?: 'simple' | 'detailed';
}

const FileList: React.FC<FileListProps> = ({
  files,
  selectedFiles = [],
  allowMultiSelect = false,
  onFileSelect,
  onFileClick,
  onDelete,
  fileCategory,
  showImagePreview = true,
  showDocumentDetails = true,
  listLayout = 'detailed'
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

  const handleDownload = (file: FileItem) => {
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.originalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = async (file: FileItem) => {
    if (onDelete) {
      await onDelete(file.id);
    }
  };

  const getFileIcon = (file: FileItem) => {
    const { contentType } = file;

    if (contentType.startsWith('image/')) {
      return <PictureOutlined style={{ fontSize: 24, color: '#52c41a' }} />;
    }

    if (contentType === 'application/pdf') {
      return <FilePdfOutlined style={{ fontSize: 24, color: '#ff4d4f' }} />;
    }

    if (contentType.includes('word') || contentType.includes('document')) {
      return <FileWordOutlined style={{ fontSize: 24, color: '#1890ff' }} />;
    }

    if (contentType.includes('excel') || contentType.includes('spreadsheet')) {
      return <FileExcelOutlined style={{ fontSize: 24, color: '#52c41a' }} />;
    }

    if (contentType.includes('powerpoint') || contentType.includes('presentation')) {
      return <FilePptOutlined style={{ fontSize: 24, color: '#fa8c16' }} />;
    }

    if (contentType.startsWith('text/')) {
      return <FileTextOutlined style={{ fontSize: 24, color: '#722ed1' }} />;
    }

    return <FileOutlined style={{ fontSize: 24, color: '#8c8c8c' }} />;
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
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderListItem = (file: FileItem) => {
    const isSelected = selectedFiles.includes(file.id);
    const isImage = file.contentType.startsWith('image/');

    const actions = [
      <Tooltip title="Preview">
        <Button
          type="text"
          icon={<EyeOutlined />}
          onClick={() => handlePreview(file)}
          size="small"
        />
      </Tooltip>,
      <Tooltip title="Download">
        <Button
          type="text"
          icon={<DownloadOutlined />}
          onClick={() => handleDownload(file)}
          size="small"
        />
      </Tooltip>
    ];

    if (onDelete) {
      actions.push(
        <Tooltip title="Delete">
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(file)}
            size="small"
          />
        </Tooltip>
      );
    }

    const avatar = isImage ? (
      <Avatar
        size={listLayout === 'detailed' ? 64 : 40}
        src={file.thumbnailUrl || file.url}
        shape="square"
      />
    ) : (
      <Avatar
        size={listLayout === 'detailed' ? 64 : 40}
        icon={getFileIcon(file)}
        shape="square"
        style={{ backgroundColor: '#f5f5f5' }}
      />
    );

    const title = (
      <Space>
        {onFileSelect && (
          <Checkbox
            checked={isSelected}
            onChange={(e) => handleFileSelect(file.id, e.target.checked)}
          />
        )}
        <Tooltip title={file.originalName}>
          <Text
            strong
            ellipsis
            style={{
              cursor: 'pointer',
              maxWidth: 300
            }}
            onClick={() => handlePreview(file)}
          >
            {file.originalName}
          </Text>
        </Tooltip>
        {file.category && (
          <Tag color="blue" style={{ fontSize: '11px', padding: '2px 6px' }}>
            {file.category}
          </Tag>
        )}
      </Space>
    );

    const description = listLayout === 'detailed' ? (
      <Space direction="vertical" size={4}>
        <Space>
          <Text type="secondary">Size: {formatFileSize(file.size)}</Text>
          <Text type="secondary">•</Text>
          <Text type="secondary">Uploaded: {formatDate(file.uploadDate)}</Text>
        </Space>
        {file.uploadedBy && (
          <Text type="secondary">By: {file.uploadedBy}</Text>
        )}
        {file.description && (
          <Text type="secondary" ellipsis>
            {file.description}
          </Text>
        )}
      </Space>
    ) : (
      <Space>
        <Text type="secondary">{formatFileSize(file.size)}</Text>
        <Text type="secondary">•</Text>
        <Text type="secondary">{formatDate(file.uploadDate)}</Text>
      </Space>
    );

    return (
      <List.Item
        key={file.id}
        actions={actions}
        style={{
          backgroundColor: isSelected ? '#e6f7ff' : 'transparent',
          borderLeft: isSelected ? '3px solid #1890ff' : 'none',
          padding: listLayout === 'detailed' ? '16px' : '12px',
          cursor: 'pointer'
        }}
        onClick={() => handlePreview(file)}
      >
        <List.Item.Meta
          avatar={avatar}
          title={title}
          description={description}
        />
      </List.Item>
    );
  };

  return (
    <>
      <List
        itemLayout="horizontal"
        dataSource={files}
        renderItem={renderListItem}
        style={{
          backgroundColor: 'white',
          borderRadius: 8,
          border: '1px solid #f0f0f0'
        }}
      />

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

export default FileList;