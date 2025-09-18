import React, { useCallback, useState } from 'react';
import { Upload, Button, message, Progress } from 'antd';
import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { FileCategory } from './types';

const { Dragger } = Upload;

interface FileUploadZoneProps {
  allowedTypes: string[];
  maxFileSize: number;
  maxFiles: number;
  fileCategory?: FileCategory;
  selectedCategory?: string;
  allowBulkUpload?: boolean;
  uploadConfig?: {
    multiple?: boolean;
    showUploadList?: boolean;
    listType?: 'text' | 'picture' | 'picture-card';
    accept?: string;
  };
  onUpload: (files: File[], category?: string) => Promise<void>;
}

const FileUploadZone: React.FC<FileUploadZoneProps> = ({
  allowedTypes,
  maxFileSize,
  maxFiles,
  fileCategory,
  selectedCategory,
  allowBulkUpload = true,
  uploadConfig,
  onUpload
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const validateFile = (file: File): boolean => {
    // File size validation
    if (file.size > maxFileSize) {
      message.error(`File size must be less than ${Math.round(maxFileSize / 1024 / 1024)}MB`);
      return false;
    }

    // File type validation
    const isValidType = allowedTypes.some(type => {
      if (type.endsWith('/*')) {
        return file.type.startsWith(type.slice(0, -1));
      }
      return file.type === type || file.name.toLowerCase().endsWith(type.toLowerCase());
    });

    if (!isValidType) {
      message.error(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`);
      return false;
    }

    return true;
  };

  const handleUpload = useCallback(async (fileList: File[]) => {
    // Validate all files first
    const validFiles = fileList.filter(validateFile);

    if (validFiles.length === 0) {
      return;
    }

    if (validFiles.length > maxFiles) {
      message.error(`Maximum ${maxFiles} files allowed`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      await onUpload(validFiles, selectedCategory);

      clearInterval(progressInterval);
      setUploadProgress(100);

      message.success(`${validFiles.length} file${validFiles.length > 1 ? 's' : ''} uploaded successfully`);
    } catch (error: any) {
      message.error(`Upload failed: ${error.message || 'Unknown error'}`);
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  }, [onUpload, selectedCategory, allowedTypes, maxFileSize, maxFiles]);

  const beforeUpload = (file: File, fileList: File[]) => {
    // Handle multiple files at once
    if (allowBulkUpload && fileList.length > 1) {
      handleUpload(fileList);
    } else {
      handleUpload([file]);
    }
    return false; // Prevent default upload
  };

  const getAcceptTypes = () => {
    if (uploadConfig?.accept) return uploadConfig.accept;

    if (fileCategory === 'image') {
      return 'image/*';
    } else if (fileCategory === 'document') {
      return '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv';
    }

    return allowedTypes.join(',');
  };

  const getUploadHint = () => {
    const categoryText = fileCategory === 'image' ? 'images' : fileCategory === 'document' ? 'documents' : 'files';
    const maxSizeMB = Math.round(maxFileSize / 1024 / 1024);

    let hint = `Support for single or bulk upload. Max ${maxFiles} ${categoryText}, ${maxSizeMB}MB each.`;

    if (selectedCategory && selectedCategory !== 'all') {
      hint += ` Will be added to "${selectedCategory}" category.`;
    }

    return hint;
  };

  const getDragText = () => {
    if (fileCategory === 'image') {
      return 'Click or drag images to this area to upload';
    } else if (fileCategory === 'document') {
      return 'Click or drag documents to this area to upload';
    }
    return 'Click or drag files to this area to upload';
  };

  return (
    <div className="file-upload-zone">
      <Dragger
        name="files"
        multiple={allowBulkUpload}
        beforeUpload={beforeUpload}
        showUploadList={false}
        disabled={uploading}
        accept={getAcceptTypes()}
        style={{ marginBottom: 16 }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          {getDragText()}
        </p>
        <p className="ant-upload-hint">
          {getUploadHint()}
        </p>
      </Dragger>

      {/* Upload Progress */}
      {uploading && uploadProgress > 0 && (
        <div style={{ marginTop: 16 }}>
          <Progress
            percent={uploadProgress}
            status={uploadProgress === 100 ? 'success' : 'active'}
            size="small"
          />
        </div>
      )}
    </div>
  );
};

export default FileUploadZone;