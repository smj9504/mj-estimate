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
import { fileService } from '../../../services/fileService';

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

  const handleFileSelect = (fileId: string, selected: boolean, ctrlKey?: boolean) => {
    if (!onFileSelect) return;

    let newSelection: string[];

    if (allowMultiSelect) {
      if (ctrlKey) {
        // Ctrl+Click behavior: toggle selection
        if (selectedFiles.includes(fileId)) {
          newSelection = selectedFiles.filter(id => id !== fileId);
        } else {
          newSelection = [...selectedFiles, fileId];
        }
      } else if (selected) {
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
      setPreviewImage(fileService.getPreviewUrl(file.id));
      setPreviewTitle(file.originalName);
      setPreviewVisible(true);
    } else if (file.contentType === 'application/pdf') {
      // Open PDF in new tab
      window.open(fileService.getPreviewUrl(file.id), '_blank');
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

  const handleListItemClick = (file: FileItem, e: React.MouseEvent) => {
    console.log('List item clicked:', {
      fileId: file.id,
      ctrlKey: e.ctrlKey,
      allowMultiSelect,
      hasOnFileSelect: !!onFileSelect
    });

    // Handle Ctrl+Click for multi-select
    if (allowMultiSelect && e.ctrlKey && onFileSelect) {
      console.log('Ctrl+Click detected in list, toggling selection');
      e.preventDefault();
      e.stopPropagation();
      handleFileSelect(file.id, true, true);
    } else if (!e.ctrlKey) {
      // Normal click without Ctrl - preview
      handlePreview(file);
    }
  };

  const renderListItem = (file: FileItem) => {
    const isSelected = selectedFiles.includes(file.id);
    const isImage = file.contentType.startsWith('image/');

    const actions = [
      <Tooltip title="Preview">
        <Button
          type="text"
          icon={<EyeOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            handlePreview(file);
          }}
          size="small"
        />
      </Tooltip>,
      <Tooltip title="Download">
        <Button
          type="text"
          icon={<DownloadOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            handleDownload(file);
          }}
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
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(file);
            }}
            size="small"
          />
        </Tooltip>
      );
    }

    const avatar = isImage ? (
      <Avatar
        size={listLayout === 'detailed' ? 64 : 40}
        src={fileService.getPreviewUrl(file.id)}
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
        {allowMultiSelect && onFileSelect && (
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onChange={(e) => {
                console.log('FileList Checkbox clicked:', file.id, e.target.checked);
                handleFileSelect(file.id, e.target.checked);
              }}
            />
          </div>
        )}
        <Tooltip title={file.originalName}>
          <Text
            strong
            ellipsis
            style={{
              cursor: 'pointer',
              maxWidth: 300
            }}
            onClick={(e) => {
              e.stopPropagation();
              handlePreview(file);
            }}
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
        onClick={(e) => handleListItemClick(file, e as any)}
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