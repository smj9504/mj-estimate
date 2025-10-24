import React, { useState, useMemo } from 'react';
import { Card, Typography, Space, Button, Empty, Spin, Alert, Modal, message, Select, Checkbox, DatePicker } from 'antd';
import { AppstoreOutlined, UnorderedListOutlined, BorderOutlined, UploadOutlined, CheckSquareOutlined, DeleteOutlined, TagOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { FileGalleryProps, ViewMode, FileItem, DateGroup } from './types';
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
  enableDateGrouping = false,
  allowUpload = false,
  allowBulkUpload = true,
  uploadConfig,
  showImagePreview = true,
  enableImageZoom = true,
  showImageInfo = true,
  gridColumns = { xs: 2, sm: 3, md: 4, lg: 5, xl: 6 },
  showThumbnails = true,
  enableLazyLoading = true,
  enableInfiniteScroll = false,
  pageSize = 50,
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
  const [selectedCategory, setSelectedCategory] = useState<string | string[]>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [dateChangeModalVisible, setDateChangeModalVisible] = useState(false);
  const [newDate, setNewDate] = useState<Dayjs | null>(null);
  // Use Set for O(1) lookup performance
  const [internalSelectedFiles, setInternalSelectedFiles] = useState<Set<string>>(new Set());

  const {
    files,
    loading,
    error,
    uploadFiles,
    deleteFile,
    updateFileCategory,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage
  } = useFileGallery({
    context,
    contextId,
    fileCategory,
    onUpload,
    onDelete,
    enableInfiniteScroll,
    pageSize
  });

  // Intersection Observer for infinite scroll
  const observerRef = React.useRef<IntersectionObserver | null>(null);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const fetchNextPageRef = React.useRef(fetchNextPage);

  // Keep fetchNextPage ref up to date
  React.useEffect(() => {
    fetchNextPageRef.current = fetchNextPage;
  }, [fetchNextPage]);

  React.useEffect(() => {
    if (!enableInfiniteScroll || !hasNextPage || isFetchingNextPage) return;

    // Cleanup previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // Create new observer
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting && fetchNextPageRef.current) {
          fetchNextPageRef.current();
        }
      },
      { threshold: 0.1 }
    );

    // Observe sentinel element
    const currentSentinel = sentinelRef.current;
    if (currentSentinel) {
      observerRef.current.observe(currentSentinel);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [enableInfiniteScroll, hasNextPage, isFetchingNextPage]);

  // Convert selectedFiles prop to Set for O(1) lookup (only when controlled)
  const selectedFilesSet = useMemo(
    () => new Set(selectedFiles),
    [selectedFiles]
  );

  // Use controlled or internal selection state
  // If onFileSelect is provided, use controlled mode (external state via selectedFiles prop)
  // Otherwise, use uncontrolled mode (internal state)
  const currentSelectedSet = onFileSelect ? selectedFilesSet : internalSelectedFiles;
  const currentSelectedFiles = Array.from(currentSelectedSet);

  const handleFileSelectionChange = (fileIds: string[] | Set<string>) => {
    const idsSet = fileIds instanceof Set ? fileIds : new Set(fileIds);

    if (onFileSelect) {
      // External control: convert to array for compatibility
      onFileSelect(Array.from(idsSet));
    } else {
      // Internal control: use Set directly for O(1) operations
      // IMPORTANT: Don't use startTransition for checkbox selection - it causes delays
      // Checkbox state changes should be immediate for good UX
      setInternalSelectedFiles(idsSet);
    }
  };

  // Filter files based on category and search
  const filteredFiles = useMemo(() => {
    let filtered = files;

    // Category filter - handle both single and multi-select
    if (selectedCategory !== 'all') {
      const categoriesArray = Array.isArray(selectedCategory)
        ? selectedCategory
        : [selectedCategory];

      if (categoriesArray.length > 0 && !categoriesArray.includes('all')) {
        // Handle 'uncategorized' filter
        if (categoriesArray.includes('uncategorized') || categoriesArray.includes('')) {
          filtered = filtered.filter(file =>
            !file.category ||
            file.category === '' ||
            categoriesArray.includes(file.category)
          );
        } else {
          // Normal category filtering
          filtered = filtered.filter(file => categoriesArray.includes(file.category || ''));
        }
      }
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

  // Group files by date
  const dateGroups = useMemo<DateGroup[]>(() => {
    if (!enableDateGrouping) {
      return [];
    }

    // Create a map to group files by date
    const groupMap = new Map<string, FileItem[]>();

    filteredFiles.forEach(file => {
      // Use uploadDate or createdAt, whichever is available
      const dateStr = file.uploadDate || file.createdAt;
      if (!dateStr) return;

      // Extract just the date part (YYYY-MM-DD)
      const date = dateStr.split('T')[0];

      if (!groupMap.has(date)) {
        groupMap.set(date, []);
      }
      groupMap.get(date)!.push(file);
    });

    // Convert map to array and sort by date (newest first)
    const groups: DateGroup[] = Array.from(groupMap.entries())
      .map(([date, files]) => {
        // Format date as "Monday, October 20th, 2025"
        const dateObj = new Date(date + 'T00:00:00');
        const displayDate = dateObj.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        return {
          date,
          displayDate,
          files,
          count: files.length
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date)); // Sort newest first

    return groups;
  }, [filteredFiles, enableDateGrouping]);

  // Handle date group selection - optimized with Set operations
  const handleDateGroupSelect = (dateGroup: DateGroup, checked: boolean) => {
    // Use Set for O(1) add/delete operations
    const newSelection = new Set(currentSelectedSet);
    const groupFileIds = dateGroup.files.map(f => f.id);

    if (checked) {
      // Add all files from this group (O(m) where m = group size)
      groupFileIds.forEach(id => newSelection.add(id));
    } else {
      // Remove all files from this group (O(m) where m = group size)
      groupFileIds.forEach(id => newSelection.delete(id));
    }

    handleFileSelectionChange(newSelection);
  };

  // Check if all files in a date group are selected
  const isDateGroupSelected = (dateGroup: DateGroup): boolean => {
    const groupFileIds = dateGroup.files.map(f => f.id);
    return groupFileIds.every(id => currentSelectedSet.has(id));  // O(1) lookup
  };

  // Check if some (but not all) files in a date group are selected
  const isDateGroupIndeterminate = (dateGroup: DateGroup): boolean => {
    const groupFileIds = dateGroup.files.map(f => f.id);
    const selectedCount = groupFileIds.filter(id => currentSelectedSet.has(id)).length;  // O(1) lookup
    return selectedCount > 0 && selectedCount < groupFileIds.length;
  };

  // Select All / Deselect All handler - optimized with Set operations
  const handleSelectAll = () => {
    const filteredFileIds = filteredFiles.map(f => f.id);
    const allFilteredSelected = filteredFileIds.every(id => currentSelectedSet.has(id));  // O(1) lookup

    const newSelection = new Set(currentSelectedSet);

    if (allFilteredSelected && filteredFileIds.length > 0) {
      // Deselect all filtered files (O(m) where m = filtered count)
      filteredFileIds.forEach(id => newSelection.delete(id));
    } else {
      // Select all filtered files (O(m) where m = filtered count)
      filteredFileIds.forEach(id => newSelection.add(id));
    }

    handleFileSelectionChange(newSelection);
  };

  // Bulk delete handler - optimized with batch processing
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
        const totalFiles = currentSelectedFiles.length;
        const BATCH_SIZE = 5; // Process 5 files at a time
        let deletedCount = 0;

        // Create batches for parallel processing
        const batches: string[][] = [];
        for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
          batches.push(currentSelectedFiles.slice(i, i + BATCH_SIZE));
        }

        const hideProgress = message.loading(`Deleting files 0/${totalFiles}...`, 0);

        try {
          for (const batch of batches) {
            await Promise.all(batch.map(fileId => deleteFile(fileId)));
            deletedCount += batch.length;
            hideProgress();
            message.loading(`Deleting files ${deletedCount}/${totalFiles}...`, 0);
          }

          hideProgress();
          handleFileSelectionChange(new Set());
          message.success(`${totalFiles} file(s) deleted successfully`);
        } catch (error) {
          hideProgress();
          message.error(`Failed to delete some files (${deletedCount}/${totalFiles} completed)`);
        }
      }
    });
  };

  // Bulk category update handler
  const handleBulkCategoryUpdate = (category: string) => {
    if (currentSelectedFiles.length === 0) {
      message.warning('No files selected');
      return;
    }

    const displayCategory = category || 'Uncategorized';

    Modal.confirm({
      title: 'Update Category',
      content: `Set category "${displayCategory}" for ${currentSelectedFiles.length} file(s)?`,
      okText: 'Update',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          // Use bulk update if available, otherwise update individually
          if (context === 'water-mitigation') {
            const { default: waterMitigationService } = await import('../../../services/waterMitigationService');
            await waterMitigationService.photos.bulkUpdateCategory(currentSelectedFiles, category);
          } else {
            for (const fileId of currentSelectedFiles) {
              await updateFileCategory(fileId, category);
            }
          }

          // Force refetch to update UI
          await refetch();

          handleFileSelectionChange(new Set());
          message.success(`Category updated for ${currentSelectedFiles.length} file(s)`);
        } catch (error) {
          console.error('Failed to update categories:', error);
          message.error('Failed to update categories');
        }
      }
    });
  };

  // Bulk date update handler
  const handleBulkDateUpdate = async () => {
    if (!newDate) {
      message.warning('Please select a date');
      return;
    }

    try {
      const { default: waterMitigationService } = await import('../../../services/waterMitigationService');
      await waterMitigationService.photos.bulkUpdateDate(
        currentSelectedFiles,
        newDate.format('YYYY-MM-DD')
      );

      // Force refetch to update UI
      await refetch();

      handleFileSelectionChange(new Set());
      setDateChangeModalVisible(false);
      setNewDate(null);
      message.success(`Date updated for ${currentSelectedFiles.length} photo(s)`);
    } catch (error) {
      console.error('Failed to update dates:', error);
      message.error('Failed to update dates');
    }
  };

  // Get example date change preview
  const getDateChangePreview = () => {
    if (!newDate || currentSelectedFiles.length === 0) return null;

    // Find first selected file to use as example
    const exampleFile = files.find(f => currentSelectedFiles.includes(f.id));
    if (!exampleFile || !exampleFile.uploadDate) return null;

    const currentDateTime = dayjs(exampleFile.uploadDate);
    const newDateTime = newDate
      .hour(currentDateTime.hour())
      .minute(currentDateTime.minute())
      .second(currentDateTime.second());

    return {
      before: currentDateTime.format('YYYY-MM-DD HH:mm:ss'),
      after: newDateTime.format('YYYY-MM-DD HH:mm:ss')
    };
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
                  <Select
                    placeholder="Set Category"
                    style={{ width: 180 }}
                    onChange={handleBulkCategoryUpdate}
                    value={undefined}
                    suffixIcon={<TagOutlined />}
                  >
                    <Select.Option key="uncategorized" value="">
                      Clear Category
                    </Select.Option>
                    {categories.filter(cat => cat !== 'uncategorized').map(cat => (
                      <Select.Option key={cat} value={cat}>
                        {cat}
                      </Select.Option>
                    ))}
                  </Select>
                  {context === 'water-mitigation' && (
                    <Button
                      icon={<CalendarOutlined />}
                      onClick={() => setDateChangeModalVisible(true)}
                    >
                      Change Date ({currentSelectedFiles.length})
                    </Button>
                  )}
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
          categories={['all', 'uncategorized', ...categories.filter(c => c !== 'uncategorized')]}
          selectedCategory={selectedCategory}
          onCategorySelect={setSelectedCategory}
          allowCreate={allowCategoryCreate}
          onCategoryCreate={onCategoryCreate}
          multiSelect={context === 'water-mitigation'}  // Enable multi-select for water mitigation
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

  const renderDateGroupedView = () => {
    if (dateGroups.length === 0) {
      return (
        <Empty
          description={allowUpload ? "No files found. Upload files to get started." : "No files found"}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      );
    }

    const commonProps = {
      selectedFiles: currentSelectedFiles,  // Still pass array for compatibility
      selectedFilesSet: currentSelectedSet,  // Also pass Set for O(1) lookup
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
      showPreviewPanel,
      gridColumns,
      enableLazyLoading
    };

    return (
      <>
        <div className="date-grouped-files">
          {dateGroups.map((group) => (
            <div key={group.date} className="date-group" style={{ marginBottom: 32 }}>
              <div className="date-group-header" style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 16,
                paddingBottom: 8,
                borderBottom: '2px solid #f0f0f0'
              }}>
                {allowMultiSelect && (
                  <Checkbox
                    checked={isDateGroupSelected(group)}
                    indeterminate={isDateGroupIndeterminate(group)}
                    onChange={(e) => handleDateGroupSelect(group, e.target.checked)}
                    style={{ marginRight: 12 }}
                  />
                )}
                <Typography.Title level={5} style={{ margin: 0, flex: 1 }}>
                  {group.displayDate}
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 14 }}>
                  {group.count} {group.count === 1 ? 'photo' : 'photos'}
                </Typography.Text>
              </div>
              <FileGrid {...commonProps} files={group.files} />
            </div>
          ))}
        </div>
        {/* Infinite scroll sentinel for date-grouped view */}
        {enableInfiniteScroll && (
          <div ref={sentinelRef} style={{ height: '20px', margin: '20px 0' }}>
            {isFetchingNextPage && (
              <div style={{ textAlign: 'center' }}>
                <Spin size="small" />
                <p style={{ marginTop: 8, color: '#999' }}>Loading more photos...</p>
              </div>
            )}
          </div>
        )}
      </>
    );
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

    // If date grouping is enabled, use the date grouped view
    if (enableDateGrouping) {
      return renderDateGroupedView();
    }

    const commonProps = {
      files: filteredFiles,
      selectedFiles: currentSelectedFiles,  // Still pass array for compatibility
      selectedFilesSet: currentSelectedSet,  // Also pass Set for O(1) lookup
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

    let content;
    switch (viewMode) {
      case 'list':
        content = <FileList {...commonProps} listLayout={listLayout} />;
        break;
      case 'card':
        content = <FileCard {...commonProps} />;
        break;
      default:
        content = <FileGrid {...commonProps} gridColumns={gridColumns} enableLazyLoading={enableLazyLoading} />;
        break;
    }

    return (
      <>
        {content}
        {/* Infinite scroll sentinel */}
        {enableInfiniteScroll && (
          <div ref={sentinelRef} style={{ height: '20px', margin: '20px 0' }}>
            {isFetchingNextPage && (
              <div style={{ textAlign: 'center' }}>
                <Spin size="small" />
              </div>
            )}
          </div>
        )}
      </>
    );
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
          selectedCategory={
            selectedCategory === 'all'
              ? undefined
              : Array.isArray(selectedCategory)
              ? selectedCategory[0]
              : selectedCategory
          }
          onUpload={async (files, category) => {
            await uploadFiles(files, category);
            handleUploadComplete();
          }}
          uploadConfig={uploadConfig}
          allowBulkUpload={allowBulkUpload}
        />
      </Modal>

      {/* Date Change Modal */}
      <Modal
        title="Change Photo Date"
        open={dateChangeModalVisible}
        onCancel={() => {
          setDateChangeModalVisible(false);
          setNewDate(null);
        }}
        onOk={handleBulkDateUpdate}
        okText="Update Date"
        cancelText="Cancel"
        width={500}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Alert
            message="Time will be preserved, only date will change"
            type="info"
            showIcon
          />

          <div>
            <Typography.Text strong>Select New Date:</Typography.Text>
            <DatePicker
              value={newDate}
              onChange={setNewDate}
              format="YYYY-MM-DD"
              style={{ width: '100%', marginTop: 8 }}
              placeholder="Select date"
            />
          </div>

          <div>
            <Typography.Text type="secondary">
              Changing date for {currentSelectedFiles.length} photo{currentSelectedFiles.length !== 1 ? 's' : ''}
            </Typography.Text>
          </div>

          {getDateChangePreview() && (
            <div style={{
              padding: 12,
              background: '#f5f5f5',
              borderRadius: 4,
              fontSize: 13
            }}>
              <Typography.Text strong>Preview Example:</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <Typography.Text>Before: {getDateChangePreview()!.before}</Typography.Text>
              </div>
              <div>
                <Typography.Text>After: {getDateChangePreview()!.after}</Typography.Text>
              </div>
            </div>
          )}
        </Space>
      </Modal>
    </div>
  );
};

export default FileGallery;