import React, { useState, useMemo } from 'react';
import { Card, Typography, Space, Button, Empty, Spin, Alert, Modal } from 'antd';
import { AppstoreOutlined, UnorderedListOutlined, BorderOutlined, UploadOutlined } from '@ant-design/icons';
import { FileGalleryProps, ViewMode, FileItem } from './types';
import { useFileGallery } from './hooks/useFileGallery';
import FileUploadZone from './FileUploadZone';
import ViewModeSelector from './ViewModeSelector';
import CategoryManager from './CategoryManager';
import FileGrid from './FileGrid';
import FileList from './FileList';
import FileCard from './FileCard';
import './FileGallery.css';

const { Title } = Typography;

const FileGallery: React.FC<FileGalleryProps> = ({
  context,
  mode = 'view',
  contextId,
  fileCategory,
  allowedTypes = ['image/*', 'application/pdf'],
  maxFileSize = 10 * 1024 * 1024, // 10MB
  maxFiles = 100,
  allowMultiSelect = false,
  selectedFiles = [],
  onFileSelect,
  categories = ['general'],
  allowCategoryCreate = false,
  onCategoryCreate,
  defaultViewMode = 'grid',
  allowViewModeChange = true,
  showCategories = true,
  allowUpload = false,
  allowBulkUpload = true,
  uploadConfig,
  showImagePreview = true,
  enableImageZoom = true,
  showImageInfo = true,
  gridColumns = { xs: 2, sm: 3, md: 4, lg: 5, xl: 6 },
  showThumbnails = true,
  enableLazyLoading = true,
  showDocumentPreview = true,
  enableDocumentSearch = false,
  showDocumentDetails = true,
  listLayout = 'detailed',
  showPreviewPanel = true,
  enableFullTextSearch = false,
  height = '600px',
  className,
  onUpload,
  onDelete,
  onFileClick
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [uploadModalVisible, setUploadModalVisible] = useState(false);

  const {
    files,
    loading,
    error,
    uploadFiles,
    deleteFile,
    updateFileCategory
  } = useFileGallery({
    context,
    contextId,
    fileCategory,
    onUpload,
    onDelete
  });

  // Filter files based on category and search
  const filteredFiles = useMemo(() => {
    let filtered = files;

    // Category filter
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(file => file.category === selectedCategory);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(file =>
        file.filename.toLowerCase().includes(query) ||
        file.originalName.toLowerCase().includes(query) ||
        file.description?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [files, selectedCategory, searchQuery]);

  const renderHeader = () => (
    <div className="file-gallery-header" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {allowViewModeChange && (
            <ViewModeSelector
              value={viewMode}
              onChange={setViewMode}
            />
          )}
        </div>

        <div>
          {allowUpload && mode !== 'select' && (
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => setUploadModalVisible(true)}
            >
              Upload {fileCategory === 'image' ? 'Images' : fileCategory === 'document' ? 'Documents' : 'Files'}
            </Button>
          )}
        </div>

        {enableDocumentSearch && (
          <div style={{ width: 300 }}>
            {/* Search component will be added here */}
          </div>
        )}
      </div>

      {showCategories && (
        <CategoryManager
          categories={['all', ...categories]}
          selectedCategory={selectedCategory}
          onCategorySelect={setSelectedCategory}
          allowCreate={allowCategoryCreate}
          onCategoryCreate={onCategoryCreate}
        />
      )}
    </div>
  );

  const handleUploadComplete = () => {
    setUploadModalVisible(false);
  };

  const renderFileView = () => {
    if (loading) {
      return (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" />
        </div>
      );
    }

    if (error) {
      return (
        <Alert
          message="Error"
          description="Failed to load files."
          type="error"
          showIcon
        />
      );
    }

    if (filteredFiles.length === 0) {
      return (
        <Empty
          description={allowUpload ? "No files found. Upload files to get started." : "No files found"}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      );
    }

    const commonProps = {
      files: filteredFiles,
      selectedFiles,
      allowMultiSelect,
      onFileSelect,
      onFileClick,
      onDelete: deleteFile,
      onCategoryChange: updateFileCategory,
      fileCategory,
      showImagePreview,
      enableImageZoom,
      showImageInfo,
      showDocumentPreview,
      showDocumentDetails,
      showPreviewPanel
    };

    switch (viewMode) {
      case 'list':
        return <FileList {...commonProps} listLayout={listLayout} />;
      case 'card':
        return <FileCard {...commonProps} />;
      default:
        return <FileGrid {...commonProps} gridColumns={gridColumns} enableLazyLoading={enableLazyLoading} />;
    }
  };

  return (
    <div className={`file-gallery ${className || ''}`} style={{ height, display: 'flex', flexDirection: 'column' }}>
      {renderHeader()}

      <div style={{ flex: 1, overflow: 'auto', marginTop: 16 }}>
        {renderFileView()}
      </div>

      {/* Upload Modal */}
      <Modal
        title={`Upload ${fileCategory === 'image' ? 'Images' : fileCategory === 'document' ? 'Documents' : 'Files'}`}
        open={uploadModalVisible}
        onCancel={() => setUploadModalVisible(false)}
        footer={null}
        width={600}
        destroyOnHidden
      >
        <FileUploadZone
          allowedTypes={allowedTypes}
          maxFileSize={maxFileSize}
          maxFiles={maxFiles}
          fileCategory={fileCategory}
          selectedCategory={selectedCategory === 'all' ? undefined : selectedCategory}
          onUpload={async (files, category) => {
            await uploadFiles(files, category);
            handleUploadComplete();
          }}
          uploadConfig={uploadConfig}
          allowBulkUpload={allowBulkUpload}
        />
      </Modal>
    </div>
  );
};

export default FileGallery;