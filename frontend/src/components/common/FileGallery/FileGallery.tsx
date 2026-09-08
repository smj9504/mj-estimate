import React, { useState, useMemo, useTransition, useCallback, useRef, useLayoutEffect } from 'react';
import { Card, Typography, Space, Button, Empty, Spin, Alert, Modal, message, Select, Checkbox, DatePicker, Slider, Tooltip } from 'antd';
import { AppstoreOutlined, UnorderedListOutlined, BorderOutlined, UploadOutlined, CheckSquareOutlined, DeleteOutlined, TagOutlined, CalendarOutlined, PlusOutlined, MinusOutlined, LoadingOutlined } from '@ant-design/icons';
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

// Measured against the real toolbar: view-mode selector (~173px) + Select All
// (~114px) + the selection group with its bulk actions (~504px) + the upload
// button (~148px) plus gaps needs roughly 975px of usable width. Below that the
// bulk actions dock to a bottom bar instead of wrapping the toolbar.
const INLINE_BULK_ACTIONS_WIDTH = 1000;

// Below this the grid-size slider (~165px of secondary chrome) is dropped so
// the primary controls keep their single row.
const GRID_SLIDER_WIDTH = 1180;

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
  defaultCategory = 'all',
  allowCategoryCreate = false,
  onCategoryCreate,
  showBulkCategoryUpdate = true,
  showBulkActions = true,
  showSelectAll = true,
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
  sourceFilter,
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
  onFileClick,
  renderCardExtraAction,
  renderBulkExtraAction
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [selectedCategory, setSelectedCategory] = useState<string | string[]>(defaultCategory);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [dateChangeModalVisible, setDateChangeModalVisible] = useState(false);
  const [newDate, setNewDate] = useState<Dayjs | null>(null);
  const [gridSize, setGridSize] = useState<number>(6); // Grid columns per row (2-8 range)

  // Layout awareness is measured on the gallery's own container, not the
  // viewport — this component often sits inside a narrow content pane, where
  // window width would report "desktop" for a toolbar that cannot fit one row.
  const galleryRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerLeft, setContainerLeft] = useState<number>(0);

  useLayoutEffect(() => {
    const el = galleryRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setContainerWidth(prev => (Math.abs(prev - rect.width) > 1 ? rect.width : prev));
      setContainerLeft(prev => (Math.abs(prev - rect.left) > 1 ? rect.left : prev));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // The gallery's left edge moves when the app sidebar collapses, which the
    // element's own resize may not report.
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Width 0 means the observer has not reported yet; assume roomy so the
  // toolbar does not flash the compact layout on first paint.
  const measured = containerWidth > 0;
  const isCompactToolbar = measured && containerWidth < INLINE_BULK_ACTIONS_WIDTH;
  const hasRoomForGridSlider = !measured || containerWidth >= GRID_SLIDER_WIDTH;
  // Use Set for O(1) lookup performance
  const [internalSelectedFiles, setInternalSelectedFiles] = useState<Set<string>>(new Set());

  // Use transition for non-urgent state updates (category filter changes)
  // This keeps the UI responsive during heavy filtering operations
  const [isPending, startTransition] = useTransition();

  // Optimized category selection handler with transition
  const handleCategorySelect = useCallback((category: string | string[]) => {
    startTransition(() => {
      setSelectedCategory(category);
    });
  }, []);

  const {
    files,
    loading,
    fetching,
    error,
    uploadFiles,
    deleteFile,
    deleteFileSilent,
    bulkDeleteInProgressRef,
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
    pageSize,
    categoryFilter: selectedCategory,  // Pass selected category to backend for server-side filtering
    sourceFilter,  // Pass source filter (companycam, magicplan, manual_upload)
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
        // Normalize selected categories (lowercase, trimmed)
        const normalizedCategories = categoriesArray.map(c => c.toLowerCase().trim());
        const includesUncategorized = normalizedCategories.includes('uncategorized') || normalizedCategories.includes('');

        filtered = filtered.filter(file => {
          // Normalize file category (handle null, undefined, empty string, whitespace)
          const fileCategory = (file.category || '').toLowerCase().trim();
          const isUncategorized = !fileCategory || fileCategory === '';

          if (includesUncategorized && isUncategorized) {
            // File has no category and 'uncategorized' is selected
            return true;
          }

          if (!isUncategorized) {
            // File has a category - check if it's in the selected categories
            return normalizedCategories.includes(fileCategory);
          }

          return false;
        });
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
        const msgKey = 'bulk-delete-progress';
        message.loading({ content: `Deleting ${totalFiles} files...`, key: msgKey, duration: 0 });
        bulkDeleteInProgressRef.current = true;

        try {
          // Use bulk trash endpoint for water-mitigation images (single request)
          if (context === 'water-mitigation' && fileCategory === 'image') {
            const { default: waterMitigationService } = await import('../../../services/waterMitigationService');
            await waterMitigationService.photos.bulkTrash(currentSelectedFiles);
          } else {
            // Fallback: sequential batch delete for other contexts
            const BATCH_SIZE = 5;
            let deletedCount = 0;
            const batches: string[][] = [];
            for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
              batches.push(currentSelectedFiles.slice(i, i + BATCH_SIZE));
            }
            for (const batch of batches) {
              await Promise.all(batch.map(fileId => deleteFileSilent(fileId)));
              deletedCount += batch.length;
              message.loading({ content: `Deleting files ${deletedCount}/${totalFiles}...`, key: msgKey, duration: 0 });
            }
          }

          handleFileSelectionChange(new Set());
          message.success({ content: `${totalFiles} file(s) deleted successfully`, key: msgKey, duration: 3 });
        } catch (error) {
          message.error({ content: `Failed to delete some files`, key: msgKey, duration: 5 });
        } finally {
          bulkDeleteInProgressRef.current = false;
          // Single invalidation after all deletes complete
          refetch();
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

          handleFileSelectionChange(new Set());
          message.success(`Category updated for ${currentSelectedFiles.length} file(s)`);
          // Background refetch (non-blocking)
          refetch();
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

  // Bulk action controls — rendered inline beside the selection badge on wide
  // screens, and inside the fixed bottom bar on compact ones. One definition,
  // two placements, so they can never drift apart.
  const renderBulkActionControls = (compact: boolean) => (
    <>
      {showBulkCategoryUpdate && (
        <Select
          placeholder={compact ? 'Category' : 'Set Category'}
          size={compact ? 'middle' : 'small'}
          style={compact ? { flex: '1 1 96px', minWidth: 0 } : { minWidth: 150 }}
          onChange={handleBulkCategoryUpdate}
          value={undefined}
          suffixIcon={<TagOutlined style={{ color: '#667eea' }} />}
        >
          <Select.Option key="uncategorized" value="">
            Clear Category
          </Select.Option>
          {categories.filter(cat => cat !== 'uncategorized').map(cat => (
            <Select.Option key={cat} value={cat}>
              {cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ')}
            </Select.Option>
          ))}
        </Select>
      )}

      {context === 'water-mitigation' && (
        <Button
          size={compact ? 'middle' : 'small'}
          icon={<CalendarOutlined style={{}} />}
          onClick={() => setDateChangeModalVisible(true)}
          style={{
            borderRadius: '6px',
            borderColor: '#667eea',
            color: '#667eea'
          }}
        >
          {compact ? 'Date' : 'Change Date'}
        </Button>
      )}

      {renderBulkExtraAction?.(
        files.filter(f => currentSelectedFiles.includes(f.id)),
        { compact, clearSelection: () => handleFileSelectionChange(new Set()) }
      )}

      <Button
        danger
        size={compact ? 'middle' : 'small'}
        icon={<DeleteOutlined style={{}} />}
        onClick={handleBulkDelete}
        style={{ borderRadius: '6px' }}
      >
        {compact ? 'Delete' : 'Delete (' + currentSelectedFiles.length + ')'}
      </Button>
    </>
  );

  const renderHeader = () => {
    const filteredFileIds = filteredFiles.map(f => f.id);
    const allFilteredSelected = filteredFileIds.length > 0 && filteredFileIds.every(id => currentSelectedFiles.includes(id));
    const hasSelection = currentSelectedFiles.length > 0;
    const showInlineBulkActions = hasSelection && showBulkActions && !isCompactToolbar;

    return (
      <div className="file-gallery-header">
        {/* Main Toolbar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px 12px'
        }}>
          {/* Left Section - View Mode, Selection & Bulk Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px 12px', flexWrap: 'wrap' }}>
            {allowViewModeChange && (
              <ViewModeSelector
                value={viewMode}
                onChange={setViewMode}
              />
            )}

            {/* Grid Size Control - grid/card modes on wide screens only */}
            {allowViewModeChange && hasRoomForGridSlider && (viewMode === 'grid' || viewMode === 'card') && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 12px',
                background: '#f5f5f5',
                borderRadius: '6px',
                border: '1px solid #d9d9d9'
              }}>
                <Tooltip title="Fewer larger images">
                  <MinusOutlined style={{ fontSize: '12px', color: '#8c8c8c', cursor: 'pointer' }} onClick={() => setGridSize(Math.max(2, gridSize - 1))} />
                </Tooltip>
                <Slider
                  min={2}
                  max={8}
                  value={gridSize}
                  onChange={setGridSize}
                  style={{ width: '100px', margin: 0 }}
                  tooltip={{ formatter: (val) => `${val} per row` }}
                />
                <Tooltip title="More smaller images">
                  <PlusOutlined style={{ fontSize: '12px', color: '#8c8c8c', cursor: 'pointer' }} onClick={() => setGridSize(Math.min(8, gridSize + 1))} />
                </Tooltip>
              </div>
            )}

            {allowMultiSelect && filteredFiles.length > 0 && showSelectAll && (
              <Button
                icon={<CheckSquareOutlined style={{}} />}
                onClick={handleSelectAll}
                type={allFilteredSelected ? 'primary' : 'default'}
                ghost={allFilteredSelected}
                style={{
                  borderRadius: '6px',
                  fontWeight: 500
                }}
              >
                {allFilteredSelected ? 'Deselect All' : 'Select All'}
              </Button>
            )}

            {/* Selection count + bulk actions, joined as a single control group.
                On compact widths the bottom bar carries the count instead, so
                the toolbar does not show it twice. */}
            {hasSelection && !isCompactToolbar && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: showInlineBulkActions ? '4px' : 0,
                background: showInlineBulkActions ? '#f0f5ff' : 'transparent',
                border: showInlineBulkActions ? '1px solid #d6e4ff' : '1px solid transparent',
                borderRadius: showInlineBulkActions ? '24px' : 0,
                flexWrap: 'wrap'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  padding: '5px 14px',
                  borderRadius: '20px',
                  fontSize: '13px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 8px rgba(102, 126, 234, 0.35)'
                }}>
                  <CheckSquareOutlined style={{ marginRight: 6 }} />
                  {currentSelectedFiles.length} selected
                </div>

                {showInlineBulkActions && renderBulkActionControls(false)}
              </div>
            )}
          </div>

          {/* Right Section - Upload Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {allowUpload && mode !== 'select' && (
              <Button
                type="primary"
                icon={<UploadOutlined style={{}} />}
                onClick={() => setUploadModalVisible(true)}
                style={{
                  borderRadius: '6px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  border: 'none',
                  fontWeight: 500,
                  boxShadow: '0 2px 8px rgba(102, 126, 234, 0.35)'
                }}
              >
                {isCompactToolbar
                  ? 'Upload'
                  : 'Upload ' + (fileCategory === 'image' ? 'Photos' : fileCategory === 'document' ? 'Documents' : 'Files')}
              </Button>
            )}
          </div>
        </div>

        {/* Category Filter */}
        {showCategories && (
          <div style={{ position: 'relative' }}>
            <CategoryManager
              categories={['all', ...categories]}
              selectedCategory={selectedCategory}
              onCategorySelect={handleCategorySelect}
              allowCreate={allowCategoryCreate}
              onCategoryCreate={onCategoryCreate}
              multiSelect={context === 'water-mitigation'}
            />
            {/* Loading indicator during filter transition */}
            {isPending && (
              <div style={{
                position: 'absolute',
                top: '50%',
                right: 12,
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: '#5b4fc4',
                fontSize: 12,
                background: '#fafafa',
                paddingLeft: 8
              }}>
                <LoadingOutlined style={{ animation: 'spin 1s linear infinite' }} />
                <span>Filtering...</span>
              </div>
            )}
          </div>
        )}

        {enableDocumentSearch && (
          <div style={{ marginTop: 12, width: 300 }}>
            {/* Search component will be added here */}
          </div>
        )}
      </div>
    );
  };

  // Compact widths: bulk actions dock to a fixed bottom bar so they stay in
  // thumb reach while the photo grid keeps the full viewport above it.
  const renderMobileBulkActionBar = () => {
    if (!showBulkActions || currentSelectedFiles.length === 0 || !isCompactToolbar) {
      return null;
    }

    return (
      <div
        className="file-gallery-bulk-bar"
        role="group"
        aria-label={'Bulk actions for ' + currentSelectedFiles.length + ' selected files'}
        style={{
          ['--bulk-bar-left' as string]: containerLeft + 'px',
          ['--bulk-bar-width' as string]: containerWidth + 'px'
        }}
      >
        <div className="file-gallery-bulk-bar__count">
          <CheckSquareOutlined style={{ marginRight: 6 }} />
          {currentSelectedFiles.length} selected
        </div>
        <div className="file-gallery-bulk-bar__actions">
          {renderBulkActionControls(true)}
        </div>
      </div>
    );
  };

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

    // Dynamic grid columns based on gridSize slider
    const dynamicGridColumns = {
      xs: Math.max(2, gridSize - 2),
      sm: Math.max(2, gridSize - 1),
      md: gridSize,
      lg: gridSize,
      xl: gridSize
    };

    // Determine image quality based on grid size (photos per row)
    // - 2-3 per row (large images): use original full resolution
    // - 4-5 per row (medium images): use web quality (400px)
    // - 6+ per row (small images): use thumbnail (250px) for faster loading
    const imageQuality: 'original' | 'web' | 'thumbnail' =
      gridSize <= 3 ? 'original' :
      gridSize <= 5 ? 'web' :
      'thumbnail';

    // Base props shared by all view components (FileList, FileCard, FileGrid)
    const baseProps = {
      selectedFiles: currentSelectedFiles,
      allowMultiSelect,
      onFileSelect: handleFileSelectionChange,
      onFileClick,
      onDelete: deleteFile,
      onCategoryChange: updateFileCategory,
      fileCategory,
      showImagePreview,
      showDocumentDetails,
      context,
      renderCardExtraAction
    };

    // FileList-specific props
    const fileListProps = {
      ...baseProps,
      listLayout
    };

    // FileCard-specific props (same as base)
    const fileCardProps = {
      ...baseProps
    };

    // FileGrid-specific props (includes all extra props)
    const fileGridProps = {
      ...baseProps,
      enableImageZoom,
      showImageInfo,
      gridColumns: dynamicGridColumns,
      enableLazyLoading,
      imageQuality
    };

    return (
      <>
        <div className="date-grouped-files">
          {dateGroups.map((group) => {
            // Render content based on view mode
            let groupContent;
            switch (viewMode) {
              case 'list':
                groupContent = <FileList {...fileListProps} files={group.files} />;
                break;
              case 'card':
                groupContent = <FileCard {...fileCardProps} files={group.files} />;
                break;
              default:
                groupContent = (
                  <FileGrid
                    {...fileGridProps}
                    files={group.files}
                  />
                );
                break;
            }

            return (
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
                {groupContent}
              </div>
            );
          })}
        </div>
        {/* Infinite scroll sentinel for date-grouped view */}
        {enableInfiniteScroll && (
          <div ref={sentinelRef} style={{ height: '20px', margin: '20px 0' }}>
            {isFetchingNextPage ? (
              <div style={{ textAlign: 'center' }}>
                <Spin size="small" />
                <p style={{ marginTop: 8, color: '#8c8c8c' }}>Loading more photos...</p>
              </div>
            ) : !hasNextPage && filteredFiles.length > 0 ? (
              <p style={{ textAlign: 'center', margin: '16px 0', color: '#8c8c8c' }}>End</p>
            ) : null}
          </div>
        )}
      </>
    );
  };

  // Show fetching state (filter change, refetch) — not initial load
  const isFilterFetching = fetching && !loading;

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

    if (filteredFiles.length === 0 && !isFilterFetching) {
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

    // Dynamic grid columns based on gridSize slider
    const dynamicGridColumns = {
      xs: Math.max(2, gridSize - 2),
      sm: Math.max(2, gridSize - 1),
      md: gridSize,
      lg: gridSize,
      xl: gridSize
    };

    // Determine image quality based on grid size (photos per row)
    const imageQuality: 'original' | 'web' | 'thumbnail' = 
      gridSize <= 3 ? 'original' : 
      gridSize <= 5 ? 'web' :
      'thumbnail';

    // Base props shared by all view components (FileList, FileCard, FileGrid)
    const baseProps = {
      files: filteredFiles,
      selectedFiles: currentSelectedFiles,
      allowMultiSelect,
      onFileSelect: handleFileSelectionChange,
      onFileClick,
      onDelete: deleteFile,
      onCategoryChange: updateFileCategory,
      fileCategory,
      showImagePreview,
      showDocumentDetails,
      context,
      renderCardExtraAction
    };

    let content;
    switch (viewMode) {
      case 'list':
        content = <FileList {...baseProps} listLayout={listLayout} />;
        break;
      case 'card':
        content = <FileCard {...baseProps} />;
        break;
      default:
        content = (
          <FileGrid
            {...baseProps}
            enableImageZoom={enableImageZoom}
            showImageInfo={showImageInfo}
            gridColumns={dynamicGridColumns}
            enableLazyLoading={enableLazyLoading}
            imageQuality={imageQuality}
          />
        );
        break;
    }

    return (
      <>
        {content}
        {/* Infinite scroll sentinel */}
        {enableInfiniteScroll && (
          <div ref={sentinelRef} style={{ height: '20px', margin: '20px 0' }}>
            {isFetchingNextPage ? (
              <div style={{ textAlign: 'center' }}>
                <Spin size="small" />
              </div>
            ) : !hasNextPage && filteredFiles.length > 0 ? (
              <p style={{ textAlign: 'center', margin: '16px 0', color: '#8c8c8c' }}>End</p>
            ) : null}
          </div>
        )}
      </>
    );
  };

  return (
    <div ref={galleryRef} className={`file-gallery ${className || ''}`} style={{ height, display: 'flex', flexDirection: 'column' }}>
      {renderHeader()}

      <div className="file-gallery-body">
        <Spin spinning={isFilterFetching} tip="Loading photos...">
          {renderFileView()}
        </Spin>
      </div>

      {renderMobileBulkActionBar()}

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