import React, { useState, useMemo } from 'react';
import { Card, Typography, Space, Button, Empty, Spin, Alert, Modal, message } from 'antd';
import { AppstoreOutlined, UnorderedListOutlined, BorderOutlined, UploadOutlined, CheckSquareOutlined, DeleteOutlined } from '@ant-design/icons';
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
  const [internalSelectedFiles, setInternalSelectedFiles] = useState<string[]>([]);

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

  // Use controlled or internal selection state
  // If onFileSelect is provided, use controlled mode (external state via selectedFiles prop)
  // Otherwise, use uncontrolled mode (internal state)
  const currentSelectedFiles = onFileSelect ? selectedFiles : internalSelectedFiles;

  const handleFileSelectionChange = (fileIds: string[]) => {
    console.log('handleFileSelectionChange called with:', fileIds);
    if (onFileSelect) {
      console.log('Calling onFileSelect prop');
      onFileSelect(fileIds);
    } else {
      console.log('Using internal state, setting:', fileIds);
      setInternalSelectedFiles(fileIds);
    }
  };

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

  // Select All / Deselect All handler
  const handleSelectAll = () => {
    const filteredFileIds = filteredFiles.map(f => f.id);
    const allFilteredSelected = filteredFileIds.every(id => currentSelectedFiles.includes(id));

    console.log('Select All clicked:', {
      filteredFileIds,
      currentSelectedFiles,
      allFilteredSelected
    });

    if (allFilteredSelected && filteredFileIds.length > 0) {
      // Deselect all filtered files (keep selections from other filters)
      const remainingSelections = currentSelectedFiles.filter(id => !filteredFileIds.includes(id));
      console.log('Deselecting all, new selection:', remainingSelections);
      handleFileSelectionChange(remainingSelections);
    } else {
      // Select all filtered files (add to existing selections)
      const newSelection = Array.from(new Set([...currentSelectedFiles, ...filteredFileIds]));
      console.log('Selecting all, new selection:', newSelection);
      handleFileSelectionChange(newSelection);
    }
  };

  // Bulk delete handler
  const handleBulkDelete = async () => {
    if (currentSelectedFiles.length === 0) {
      message.warning('No files selected');
      return;
    }

    Modal.confirm({
      title: 'Delete Selected Files',
      content: `Are you sure you want to delete ${currentSelectedFiles.length} file(s)?`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          for (const fileId of currentSelectedFiles) {
            await deleteFile(fileId);
          }
          handleFileSelectionChange([]);
          message.success(`${currentSelectedFiles.length} file(s) deleted successfully`);
        } catch (error) {
          message.error('Failed to delete some files');
        }
      }
    });
  };

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
          {allowMultiSelect && filteredFiles.length > 0 && (
            <Space>
              <Button
                icon={<CheckSquareOutlined />}
                onClick={handleSelectAll}
              >
                {(() => {
                  const filteredFileIds = filteredFiles.map(f => f.id);
                  const allFilteredSelected = filteredFileIds.every(id => currentSelectedFiles.includes(id));
                  return allFilteredSelected ? 'Deselect All' : 'Select All';
                })()}
              </Button>
              {currentSelectedFiles.length > 0 && (
                <>
                  <span style={{ color: '#1890ff', fontWeight: 500 }}>
                    {currentSelectedFiles.length} selected
                  </span>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={handleBulkDelete}
                  >
                    Delete Selected
                  </Button>
                </>
              )}
            </Space>
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
    // Delay closing modal slightly to show completion state
    setTimeout(() => {
      setUploadModalVisible(false);
    }, 1000);
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
      selectedFiles: currentSelectedFiles,
      allowMultiSelect,
      onFileSelect: handleFileSelectionChange,
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