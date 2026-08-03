import React, { useCallback, useState, useRef } from 'react';
import { Upload, Button, message, Progress, Space } from 'antd';
import { InboxOutlined, CameraOutlined, PictureOutlined } from '@ant-design/icons';
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
  const processingBatchRef = useRef<boolean>(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Detect mobile device
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const validateFile = (file: File): boolean => {
    if (file.size > maxFileSize) {
      message.error(`File size must be less than ${Math.round(maxFileSize / 1024 / 1024)}MB`);
      return false;
    }

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

  // Accumulate files from beforeUpload calls, then process them all at once
  const pendingFilesRef = useRef<File[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUpload = useCallback(async (fileList: File[]) => {
    const validFiles = fileList.filter(validateFile);

    if (validFiles.length === 0) {
      processingBatchRef.current = false;
      return;
    }

    if (validFiles.length > maxFiles) {
      message.error(`Maximum ${maxFiles} files allowed`);
      processingBatchRef.current = false;
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const hideLoading = message.loading(`Uploading ${validFiles.length} file${validFiles.length > 1 ? 's' : ''}...`, 0);

      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 5, 90));
      }, 300);

      await onUpload(validFiles, selectedCategory);

      clearInterval(progressInterval);
      setUploadProgress(100);
      hideLoading();

      // Allow new uploads immediately; keep progress bar visible briefly
      processingBatchRef.current = false;
      setTimeout(() => {
        setUploadProgress(0);
      }, 1500);
    } catch (error: any) {
      message.error(`Upload failed: ${error.message || 'Unknown error'}`);
      setUploadProgress(0);
      processingBatchRef.current = false;
    } finally {
      setUploading(false);
    }
  }, [onUpload, selectedCategory, allowedTypes, maxFileSize, maxFiles]);

  // Flush accumulated files — called after a short debounce to ensure
  // all beforeUpload calls from a single file-picker selection are collected.
  const flushPendingFiles = useCallback(() => {
    const files = pendingFilesRef.current;
    pendingFilesRef.current = [];
    flushTimerRef.current = null;
    if (files.length > 0) {
      processingBatchRef.current = true;
      handleUpload(files);
    }
  }, [handleUpload]);

  const beforeUpload = (file: File, _fileList: File[]) => {
    // While a previous upload is still in progress, reject new files
    if (processingBatchRef.current) {
      return false;
    }

    // Accumulate every file the browser gives us
    pendingFilesRef.current.push(file);

    // Debounce: reset timer on each call so we flush only after
    // the browser has finished delivering all selected files (~50ms gap)
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = setTimeout(flushPendingFiles, 50);

    return false;
  };

  // Handle native file input change (gallery / camera)
  const handleNativeInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      processingBatchRef.current = false;
      handleUpload(files);
    }
    // Reset input so same files can be selected again
    e.target.value = '';
  }, [handleUpload]);

  const getAcceptTypes = () => {
    if (uploadConfig?.accept) return uploadConfig.accept;
    if (fileCategory === 'image') return 'image/*';
    if (fileCategory === 'document') return '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv';
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
    if (isMobile) {
      return 'Tap to select files';
    }
    if (fileCategory === 'image') return 'Click or drag images to this area to upload';
    if (fileCategory === 'document') return 'Click or drag documents to this area to upload';
    return 'Click or drag files to this area to upload';
  };

  return (
    <div className="file-upload-zone">
      {/* Mobile: gallery + camera buttons */}
      {isMobile && fileCategory === 'image' && (
        <>
          <Space style={{ width: '100%', marginBottom: 12 }} size={8}>
            <Button
              icon={<PictureOutlined />}
              size="large"
              disabled={uploading}
              onClick={() => galleryInputRef.current?.click()}
              style={{ flex: 1, height: 48 }}
              block
            >
              갤러리에서 선택
            </Button>
            <Button
              icon={<CameraOutlined />}
              size="large"
              disabled={uploading}
              onClick={() => cameraInputRef.current?.click()}
              style={{ flex: 1, height: 48 }}
              block
            >
              카메라로 촬영
            </Button>
          </Space>

          {/* Hidden gallery input (no capture = gallery picker) */}
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple={allowBulkUpload}
            style={{ display: 'none' }}
            onChange={handleNativeInputChange}
          />
          {/* Hidden camera input */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handleNativeInputChange}
          />
        </>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (uploading || processingBatchRef.current) return;
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) {
            processingBatchRef.current = true;
            handleUpload(files);
          }
        }}
      >
        <Dragger
          name="files"
          multiple={allowBulkUpload}
          fileList={[]}
          beforeUpload={beforeUpload}
          showUploadList={false}
          disabled={uploading}
          accept={getAcceptTypes()}
          style={{ marginBottom: 16 }}
          openFileDialogOnClick={true}
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
      </div>

      {/* Upload Progress */}
      {(uploading || uploadProgress > 0) && (
        <div style={{ marginTop: 16 }}>
          <Progress
            percent={uploadProgress}
            status={uploadProgress === 100 ? 'success' : 'active'}
            strokeColor={uploadProgress === 100 ? '#52c41a' : '#1890ff'}
            showInfo={true}
          />
          <div style={{ marginTop: 8, textAlign: 'center', color: '#666', fontSize: '12px' }}>
            {uploading ? 'Uploading files...' : uploadProgress === 100 ? 'Upload complete!' : ''}
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUploadZone;
