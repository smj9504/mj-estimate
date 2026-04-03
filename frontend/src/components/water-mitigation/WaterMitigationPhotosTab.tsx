/**
 * Water Mitigation Photos Tab
 * Uses FileGallery component with date-based grouping option
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Space, message, Modal, Typography, Alert, Input, List, Tag, Spin, Tooltip, Progress, Grid } from 'antd';
import { SyncOutlined, CloudDownloadOutlined, LinkOutlined, SearchOutlined, CheckCircleOutlined, CloseCircleOutlined, CameraOutlined, GoogleOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import FileGallery from '../common/FileGallery/FileGallery';
import api from '../../services/api';
import waterMitigationService from '../../services/waterMitigationService';
import type { CompanyCamSyncResult } from '../../types/waterMitigation';

const { Text, Title } = Typography;

// Sync status type
interface SyncStatus {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'unknown';
  synced_count?: number;
  skipped_existing?: number;
  skipped_trashed?: number;
  total_companycam?: number;
  current_page?: number;
  errors?: string[];
  message?: string;
}

// Google Drive export status type
interface ExportStatus {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
  message?: string;
  total_photos?: number;
  uploaded_count?: number;
  skipped_count?: number;
  error_count?: number;
  current_photo?: number;
  current_filename?: string;
  drive_folder_url?: string;
  errors?: string[];
}

// CompanyCam project search result
interface CompanyCamProject {
  id: string;
  name: string;
  address: string;
  match_score: number;
  photo_count: number;
  created_at?: string;
  updated_at?: string;
}

interface ProjectSearchResult {
  job_address: string;
  search_query: string;
  projects: CompanyCamProject[];
  total: number;
}

// API calls
const syncCompanyCamPhotos = async (jobId: string, projectId?: string): Promise<CompanyCamSyncResult> => {
  const params = projectId ? `?companycam_project_id=${encodeURIComponent(projectId)}` : '';
  const response = await api.post(`/api/water-mitigation/jobs/${jobId}/sync-companycam-photos${params}`);
  return response.data;
};

const getSyncStatus = async (jobId: string): Promise<SyncStatus> => {
  const response = await api.get(`/api/water-mitigation/jobs/${jobId}/sync-companycam-photos/status`);
  return response.data;
};

const cancelSync = async (jobId: string): Promise<{ success: boolean; message: string }> => {
  const response = await api.post(`/api/water-mitigation/jobs/${jobId}/sync-companycam-photos/cancel`);
  return response.data;
};

const searchCompanyCamProjects = async (jobId: string, query?: string): Promise<ProjectSearchResult> => {
  const params = query ? `?query=${encodeURIComponent(query)}` : '';
  const response = await api.get(`/api/water-mitigation/jobs/${jobId}/search-companycam-projects${params}`);
  return response.data;
};

interface WaterMitigationPhotosTabProps {
  jobId: string;
  clientId?: string;  // Client ID for category management
  companycamProjectId?: string;
  onProjectIdUpdated?: (projectId: string) => void;
}

const { useBreakpoint } = Grid;

const WaterMitigationPhotosTab: React.FC<WaterMitigationPhotosTabProps> = ({
  jobId,
  clientId,
  companycamProjectId,
  onProjectIdUpdated
}) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const queryClient = useQueryClient();
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [projectIdModalVisible, setProjectIdModalVisible] = useState(false);
  const [inputProjectId, setInputProjectId] = useState('');
  const [currentProjectId, setCurrentProjectId] = useState(companycamProjectId);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ status: 'idle' });
  const [isSyncing, setIsSyncing] = useState(false);
  const pollingRef = useRef<boolean>(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Project search state
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CompanyCamProject[]>([]);
  const [jobAddress, setJobAddress] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<CompanyCamProject | null>(null);
  const [manualInput, setManualInput] = useState(false);

  // Google Drive export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ status: 'idle' });
  const [isExporting, setIsExporting] = useState(false);
  const exportPollingRef = useRef<boolean>(false);
  const exportTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update current project ID when prop changes
  useEffect(() => {
    setCurrentProjectId(companycamProjectId);
  }, [companycamProjectId]);

  // Custom upload handler for Water Mitigation photos
  const handleUpload = useCallback(async (files: File[], category?: string): Promise<void> => {
    try {
      await waterMitigationService.photos.uploadMultiple(jobId, files, category);
      message.success(`Successfully uploaded ${files.length} photo(s)`);
      // Refresh photos after upload
      queryClient.invalidateQueries({ queryKey: ['files', 'water-mitigation', jobId] });
      queryClient.invalidateQueries({ queryKey: ['files-infinite', 'water-mitigation', jobId] });
    } catch (error: any) {
      console.error('Upload failed:', error);
      message.error(`Upload failed: ${error.message || 'Unknown error'}`);
      throw error;
    }
  }, [jobId, queryClient]);

  // Handle category creation
  const handleCategoryCreate = useCallback(async (categoryName: string): Promise<void> => {
    if (!clientId) {
      message.warning('Cannot create category: Client ID not available.');
      console.warn('Category creation attempted without client_id');
      return;
    }

    try {
      await api.post('/api/water-mitigation/categories', {
        category_name: categoryName,
        category_type: 'custom',
        color_code: '#1890ff'
      }, {
        params: { client_id: clientId }
      });

      message.success(`Category "${categoryName}" created successfully!`);

      // Note: Category list will auto-refresh on next component mount or
      // you can add category refresh logic here if needed
    } catch (error: any) {
      console.error('Failed to create category:', error);
      const errorMsg = error.response?.data?.detail || error.message || 'Failed to create category';
      message.error(errorMsg);
    }
  }, [clientId]);

  // Poll for sync status using setTimeout (waits for previous request to complete)
  const pollStatus = async () => {
    if (!pollingRef.current) return;

    try {
      const status = await getSyncStatus(jobId);

      // Check if still polling (component might have unmounted)
      if (!pollingRef.current) return;

      setSyncStatus(status);

      // Stop polling if sync completed or cancelled
      if (status.status === 'completed' || status.status === 'cancelled') {
        stopPolling();
        setIsSyncing(false);
        // Refresh photos
        queryClient.invalidateQueries({ queryKey: ['files', 'water-mitigation', jobId] });
        queryClient.invalidateQueries({ queryKey: ['files-infinite', 'water-mitigation', jobId] });

        if (status.status === 'completed') {
          message.success(status.message || 'Sync completed!');
        } else {
          message.info(status.message || 'Sync cancelled');
        }
      } else {
        // Schedule next poll after current one completes
        timeoutRef.current = setTimeout(pollStatus, 2000);
      }
    } catch (error) {
      console.error('Failed to get sync status:', error);
      // Retry on error if still polling
      if (pollingRef.current) {
        timeoutRef.current = setTimeout(pollStatus, 3000);
      }
    }
  };

  const startPolling = () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    pollStatus();
  };

  const stopPolling = () => {
    pollingRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      stopExportPolling();
    };
  }, []);

  // ===== Google Drive Export Functions =====

  // Poll for export status
  const pollExportStatus = async () => {
    if (!exportPollingRef.current) return;

    try {
      const status = await waterMitigationService.photos.getExportStatus(jobId);

      if (!exportPollingRef.current) return;

      setExportStatus(status);

      // Stop polling if export completed, cancelled, or failed
      if (status.status === 'completed' || status.status === 'cancelled' || status.status === 'failed') {
        stopExportPolling();
        setIsExporting(false);

        if (status.status === 'completed') {
          message.success(
            <span>
              Export completed! {status.uploaded_count} photos uploaded to Google Drive.
              {status.drive_folder_url && (
                <a
                  href={status.drive_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginLeft: 8 }}
                >
                  Open folder
                </a>
              )}
            </span>
          );
        } else if (status.status === 'cancelled') {
          message.info(status.message || 'Export cancelled');
        } else {
          message.error(status.message || 'Export failed');
        }
      } else {
        // Schedule next poll
        exportTimeoutRef.current = setTimeout(pollExportStatus, 2000);
      }
    } catch (error) {
      console.error('Failed to get export status:', error);
      if (exportPollingRef.current) {
        exportTimeoutRef.current = setTimeout(pollExportStatus, 3000);
      }
    }
  };

  const startExportPolling = () => {
    if (exportPollingRef.current) return;
    exportPollingRef.current = true;
    pollExportStatus();
  };

  const stopExportPolling = () => {
    exportPollingRef.current = false;
    if (exportTimeoutRef.current) {
      clearTimeout(exportTimeoutRef.current);
      exportTimeoutRef.current = null;
    }
  };

  // Check initial export status on mount
  useEffect(() => {
    const checkInitialExportStatus = async () => {
      try {
        const status = await waterMitigationService.photos.getExportStatus(jobId);
        setExportStatus(status);
        if (status.status === 'running') {
          setIsExporting(true);
          startExportPolling();
        }
      } catch (error) {
        // Ignore errors on initial check
      }
    };
    checkInitialExportStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Export mutation
  const exportMutation = useMutation({
    mutationFn: () => waterMitigationService.photos.exportToGoogleDrive(jobId),
    onMutate: () => {
      setIsExporting(true);
      setExportModalVisible(false);
      startExportPolling();
    },
    onSuccess: (result) => {
      if (!result.success) {
        message.error(result.message || 'Failed to start export');
        setIsExporting(false);
        stopExportPolling();
      }
    },
    onError: (error: any) => {
      stopExportPolling();
      setIsExporting(false);
      message.error(`Export failed: ${error?.response?.data?.detail || error.message || 'Unknown error'}`);
    }
  });

  // Cancel export mutation
  const cancelExportMutation = useMutation({
    mutationFn: () => waterMitigationService.photos.cancelExport(jobId),
    onSuccess: (result) => {
      if (result.success) {
        message.info(result.message);
      } else {
        message.warning(result.message);
      }
    },
    onError: (error: any) => {
      message.error(`Failed to cancel export: ${error?.message || 'Unknown error'}`);
    }
  });

  const handleExportClick = () => {
    setExportModalVisible(true);
  };

  const confirmExport = () => {
    exportMutation.mutate();
  };

  const handleCancelExport = () => {
    cancelExportMutation.mutate();
  };

  // Calculate export progress
  const getExportProgressInfo = () => {
    if (exportStatus.status !== 'running') return null;

    const uploaded = exportStatus.uploaded_count || 0;
    const skipped = exportStatus.skipped_count || 0;
    const errors = exportStatus.error_count || 0;
    const total = exportStatus.total_photos || 0;
    const current = exportStatus.current_photo || 0;
    const processed = uploaded + skipped + errors;
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

    return {
      uploaded,
      skipped,
      errors,
      total,
      current,
      processed,
      percent,
      currentFilename: exportStatus.current_filename
    };
  };

  // Check initial status on mount
  useEffect(() => {
    const checkInitialStatus = async () => {
      try {
        const status = await getSyncStatus(jobId);
        setSyncStatus(status);
        if (status.status === 'running') {
          setIsSyncing(true);
          startPolling();
        }
      } catch (error) {
        // Ignore errors on initial check
      }
    };
    // Always check status - sync might have been started with a manually entered project ID
    checkInitialStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Search for CompanyCam projects when modal opens
  const handleSearchProjects = async () => {
    setIsSearching(true);
    setSearchResults([]);
    setSelectedProject(null);
    setManualInput(false);

    try {
      const result = await searchCompanyCamProjects(jobId);
      setJobAddress(result.job_address || '');
      setSearchResults(result.projects || []);

      // Auto-select if there's a high-confidence match (>70%)
      if (result.projects?.length > 0 && result.projects[0].match_score > 70) {
        setSelectedProject(result.projects[0]);
      }
    } catch (error: any) {
      console.error('Failed to search CompanyCam projects:', error);
      message.error(`Failed to search projects: ${error?.response?.data?.detail || error.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  // Sync mutation - now supports project ID parameter
  const syncMutation = useMutation({
    mutationFn: (projectId?: string) => syncCompanyCamPhotos(jobId, projectId),
    onMutate: () => {
      setIsSyncing(true);
      setSyncModalVisible(false);
      setProjectIdModalVisible(false);
      startPolling();
    },
    onSuccess: (result) => {
      // Polling will handle the final state
      if (result.cancelled) {
        message.info('Sync was cancelled');
      }
    },
    onError: (error: any) => {
      stopPolling();
      setIsSyncing(false);
      message.error(`Sync failed: ${error?.response?.data?.detail || error.message || 'Unknown error'}`);
    }
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: () => cancelSync(jobId),
    onSuccess: (result) => {
      if (result.success) {
        message.info(result.message);
      } else {
        message.warning(result.message);
      }
    },
    onError: (error: any) => {
      message.error(`Failed to cancel: ${error?.message || 'Unknown error'}`);
    }
  });

  const handleSyncClick = () => {
    if (currentProjectId) {
      // Project ID exists, show confirmation modal
      setSyncModalVisible(true);
    } else {
      // No project ID, show search modal and start search
      setProjectIdModalVisible(true);
      handleSearchProjects();
    }
  };

  const confirmSync = () => {
    syncMutation.mutate(undefined);
  };

  const confirmSyncWithProjectId = () => {
    const projectId = manualInput ? inputProjectId.trim() : selectedProject?.id;

    if (!projectId) {
      message.error('Please select a project or enter a Project ID');
      return;
    }

    // Update local state and notify parent
    setCurrentProjectId(projectId);
    if (onProjectIdUpdated) {
      onProjectIdUpdated(projectId);
    }
    syncMutation.mutate(projectId);
  };

  const handleCancel = () => {
    cancelMutation.mutate();
  };

  // Calculate progress
  const getProgressInfo = () => {
    if (syncStatus.status !== 'running') return null;

    const synced = syncStatus.synced_count || 0;
    const skipped = (syncStatus.skipped_existing || 0) + (syncStatus.skipped_trashed || 0);
    const processed = synced + skipped;

    return {
      synced,
      skipped,
      processed,
      page: syncStatus.current_page || 0
    };
  };

  const progressInfo = getProgressInfo();

  // Get match score color
  const getMatchScoreColor = (score: number) => {
    if (score >= 80) return 'green';
    if (score >= 50) return 'orange';
    return 'default';
  };

  return (
    <div className="wm-photos-tab" style={{
      height: isMobile ? 'auto' : 'calc(100vh - 180px)',
      minHeight: isMobile ? 'calc(100vh - 250px)' : undefined,
      display: 'flex',
      flexDirection: 'column',
      background: '#f5f7fa',
      borderRadius: '12px',
      overflow: 'hidden'
    }}>
      {/* Header Section */}
      <div style={{
        padding: isMobile ? '10px 12px' : '16px 20px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: '12px 12px 0 0',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: isMobile ? 8 : 0,
        boxShadow: '0 2px 8px rgba(102, 126, 234, 0.25)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CameraOutlined style={{ fontSize: isMobile ? '18px' : '24px', color: 'white' }} />
          <div>
            <Title level={5} style={{ margin: 0, color: 'white', fontWeight: 600, fontSize: isMobile ? 14 : undefined }}>
              Photos
            </Title>
            {currentProjectId && (
              <Tooltip title={`CompanyCam Project ID: ${currentProjectId}`}>
                <Text style={{ fontSize: '11px', color: 'rgba(255,255,255,0.85)' }}>
                  <CheckCircleOutlined style={{ marginRight: 4 }} />
                  CompanyCam Linked
                </Text>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Sync Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {isSyncing && progressInfo ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: isMobile ? '8px' : '16px',
              background: 'rgba(255,255,255,0.15)',
              padding: isMobile ? '6px 10px' : '8px 16px',
              borderRadius: '8px',
              backdropFilter: 'blur(10px)',
              flex: isMobile ? 1 : undefined
            }}>
              <div style={{ minWidth: isMobile ? '120px' : '180px', flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <Text style={{ color: 'white', fontSize: '12px' }}>
                    <SyncOutlined spin style={{ marginRight: 6 }} />
                    Syncing Page {progressInfo.page}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: '12px' }}>
                    {progressInfo.synced + progressInfo.skipped} photos
                  </Text>
                </div>
                <Progress
                  percent={100}
                  status="active"
                  showInfo={false}
                  strokeColor={{
                    '0%': '#52c41a',
                    '100%': '#87d068',
                  }}
                  trailColor="rgba(255,255,255,0.2)"
                  size="small"
                />
              </div>
              <Tooltip title="Cancel sync">
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<CloseCircleOutlined />}
                  onClick={handleCancel}
                  loading={cancelMutation.isPending}
                  style={{
                    color: '#ff7875',
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none'
                  }}
                >
                  Cancel
                </Button>
              </Tooltip>
            </div>
          ) : syncStatus.status === 'running' ? (
            // Show Resume button when sync is running but UI lost connection (e.g., page refresh, server restart)
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Alert
                message="Sync in progress"
                description={
                  <span>
                    {syncStatus.synced_count !== undefined && (
                      <>{syncStatus.synced_count} photos synced. </>
                    )}
                    Click Resume to monitor progress.
                  </span>
                }
                type="info"
                showIcon
                icon={<SyncOutlined spin />}
                style={{
                  margin: 0,
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(24,144,255,0.3)',
                  color: 'white'
                }}
              />
              <Button
                type="primary"
                icon={<SyncOutlined />}
                onClick={() => {
                  setIsSyncing(true);
                  startPolling();
                  message.info('Resuming sync monitoring...');
                }}
                style={{
                  background: '#1890ff',
                  border: '1px solid rgba(255,255,255,0.3)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  fontWeight: 500
                }}
              >
                Resume Monitoring
              </Button>
              <Tooltip title="Cancel sync">
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<CloseCircleOutlined />}
                  onClick={handleCancel}
                  loading={cancelMutation.isPending}
                  style={{
                    color: '#ff7875',
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none'
                  }}
                >
                  Cancel
                </Button>
              </Tooltip>
            </div>
          ) : (
            <Button
              type="primary"
              icon={currentProjectId ? <SyncOutlined /> : <LinkOutlined />}
              onClick={handleSyncClick}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.3)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                fontWeight: 500
              }}
              size={isMobile ? 'small' : 'middle'}
            >
              {currentProjectId ? (isMobile ? 'Sync' : 'Sync from CompanyCam') : (isMobile ? 'Link' : 'Link CompanyCam')}
            </Button>
          )}

          {/* Google Drive Export Button */}
          {isExporting ? (
            (() => {
              const exportProgress = getExportProgressInfo();
              return (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  background: 'rgba(255,255,255,0.15)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  backdropFilter: 'blur(10px)'
                }}>
                  <div style={{ minWidth: '180px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <Text style={{ color: 'white', fontSize: '12px' }}>
                        <CloudUploadOutlined style={{ marginRight: 6 }} />
                        Uploading to Google Drive
                      </Text>
                      <Text style={{ color: 'white', fontSize: '12px' }}>
                        {exportProgress?.uploaded || 0}/{exportProgress?.total || 0} photos
                      </Text>
                    </div>
                    <Progress
                      percent={exportProgress?.percent || 0}
                      status="active"
                      showInfo={false}
                      strokeColor={{
                        '0%': '#4285f4',
                        '100%': '#34a853',
                      }}
                      trailColor="rgba(255,255,255,0.2)"
                      size="small"
                    />
                    {exportProgress?.currentFilename && (
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: '10px', display: 'block', marginTop: '2px' }}>
                        {exportProgress.currentFilename}
                      </Text>
                    )}
                  </div>
                  <Tooltip title="Cancel export">
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<CloseCircleOutlined />}
                      onClick={handleCancelExport}
                      loading={cancelExportMutation.isPending}
                      style={{
                        color: '#ff7875',
                        background: 'rgba(255,255,255,0.1)',
                        border: 'none'
                      }}
                    >
                      Cancel
                    </Button>
                  </Tooltip>
                </div>
              );
            })()
          ) : (
            <Tooltip title="Export all photos to Google Drive">
              <Button
                type="default"
                icon={<GoogleOutlined />}
                onClick={handleExportClick}
                size={isMobile ? 'small' : 'middle'}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  fontWeight: 500,
                  color: 'white'
                }}
              >
                {isMobile ? 'Drive' : 'Export to Drive'}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Sync Status Bar - shows when sync was recently completed */}
      {syncStatus.status === 'completed' && syncStatus.synced_count !== undefined && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message={
            <span>
              Sync completed! <strong>{syncStatus.synced_count}</strong> new photos added
              {(syncStatus.skipped_existing || 0) > 0 && (
                <span style={{ color: '#8c8c8c', marginLeft: '8px' }}>
                  ({syncStatus.skipped_existing} skipped)
                </span>
              )}
            </span>
          }
          closable
          style={{
            borderRadius: 0,
            border: 'none',
            borderBottom: '1px solid #b7eb8f'
          }}
        />
      )}

      {/* Main Content Area */}
      <div style={{
        flex: 1,
        padding: isMobile ? '8px' : '16px',
        overflow: 'hidden',
        background: 'white',
        borderRadius: '0 0 12px 12px'
      }}>
        <FileGallery
          context="water-mitigation"
          mode="upload"
          contextId={jobId}

          // Image-specific settings
          allowedTypes={['image/*']}
          fileCategory="image"

          // Full screen utilization
          height="100%"
          allowUpload={true}
          allowCategoryCreate={true}

          // Custom upload handler for Water Mitigation photos
          onUpload={handleUpload}
          onCategoryCreate={handleCategoryCreate}

          // Multi-select support
          allowMultiSelect={true}

          // Water mitigation specific categories
          categories={[
            'uncategorized',
            'wet-area',
            'personal-properties',
            'pre-mitigation-moving',
            'demolition',
            'containment',
            'protection',
            'drying-process',
            'day-1',
            'day-2',
            'day-3',
            'documentation',
          ]}
          defaultViewMode="grid"
          allowViewModeChange={true}

          // Image-specific functionality
          showImagePreview={true}
          enableImageZoom={true}
          showImageInfo={true}
          allowBulkUpload={true}

          // Large image handling
          maxFileSize={20 * 1024 * 1024} // 20MB
          maxFiles={500} // Water mitigation jobs can have many photos

          // UI customization for images
          gridColumns={{ xs: 2, sm: 3, md: 4, lg: 5, xl: 6 }}
          showThumbnails={true}
          enableLazyLoading={true}

          // Performance optimization: Enable infinite scroll
          enableInfiniteScroll={true}
          pageSize={20}  // Smaller initial load (20) for faster perceived performance, subsequent pages load 30

          // Upload configuration
          uploadConfig={{
            multiple: true,
            showUploadList: false,
            listType: 'picture-card',
            accept: 'image/*'
          }}

          // Enable date grouping for water mitigation photos
          enableDateGrouping={true}

          // Enhanced styling
          className="wm-photo-gallery"
        />
      </div>

      {/* Sync Confirmation Modal - when project is already linked */}
      <Modal
        title={
          <Space>
            <CloudDownloadOutlined style={{ color: '#1890ff' }} />
            <span>Sync Photos from CompanyCam</span>
          </Space>
        }
        open={syncModalVisible}
        onOk={confirmSync}
        onCancel={() => setSyncModalVisible(false)}
        confirmLoading={syncMutation.isPending}
        okText="Start Sync"
        cancelText="Cancel"
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text>
            This will sync photos from the linked CompanyCam project:
          </Text>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>New photos will be downloaded and added</li>
            <li>Existing photos will be skipped (not re-downloaded)</li>
            <li>Trashed photos will remain trashed</li>
            <li>Photo categories you've set will be preserved</li>
          </ul>
          <Text type="secondary">
            This may take a while for projects with many photos. You can cancel anytime.
          </Text>
        </Space>
      </Modal>

      {/* Project Search Modal - when no project is linked */}
      <Modal
        title={
          <Space>
            <SearchOutlined style={{ color: '#1890ff' }} />
            <span>Find CompanyCam Project</span>
          </Space>
        }
        open={projectIdModalVisible}
        onOk={confirmSyncWithProjectId}
        onCancel={() => {
          setProjectIdModalVisible(false);
          setSelectedProject(null);
          setManualInput(false);
          setInputProjectId('');
        }}
        confirmLoading={syncMutation.isPending}
        okText="Link & Start Sync"
        cancelText="Cancel"
        width={600}
        okButtonProps={{ disabled: !selectedProject && !inputProjectId.trim() }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* Job Address Display */}
          {jobAddress && (
            <Alert
              type="info"
              message={
                <Text>
                  <strong>Job Address:</strong> {jobAddress}
                </Text>
              }
              style={{ marginBottom: 8 }}
            />
          )}

          {/* Loading State */}
          {isSearching && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <Spin />
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                Searching all CompanyCam projects by address match...
              </Text>
              <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                This may take a moment if you have many projects
              </Text>
            </div>
          )}

          {/* Search Results */}
          {!isSearching && searchResults.length > 0 && !manualInput && (
            <>
              <Text>Select a matching CompanyCam project:</Text>
              <List
                size="small"
                bordered
                dataSource={searchResults}
                style={{ maxHeight: '300px', overflow: 'auto' }}
                renderItem={(project) => (
                  <List.Item
                    style={{
                      cursor: 'pointer',
                      backgroundColor: selectedProject?.id === project.id ? '#e6f7ff' : 'transparent',
                      borderLeft: selectedProject?.id === project.id ? '3px solid #1890ff' : '3px solid transparent',
                      padding: '12px 16px'
                    }}
                    onClick={() => setSelectedProject(project)}
                  >
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Text strong>{project.name || 'Unnamed Project'}</Text>
                        <Tag>{project.photo_count} photos</Tag>
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {project.address || 'No address'}
                      </Text>
                    </div>
                  </List.Item>
                )}
              />
              <Button
                type="link"
                onClick={() => setManualInput(true)}
                style={{ padding: 0 }}
              >
                Can't find the project? Enter ID manually
              </Button>
            </>
          )}

          {/* No Results */}
          {!isSearching && searchResults.length === 0 && !manualInput && (
            <>
              <Alert
                type="warning"
                message="No matching projects found"
                description="No CompanyCam projects match this job's address. You can enter the Project ID manually."
              />
              <Button
                type="primary"
                onClick={() => setManualInput(true)}
              >
                Enter Project ID Manually
              </Button>
            </>
          )}

          {/* Manual Input */}
          {manualInput && (
            <>
              <div>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                  CompanyCam Project ID <span style={{ color: '#ff4d4f' }}>*</span>
                </Text>
                <Input
                  placeholder="e.g., 12345678"
                  value={inputProjectId}
                  onChange={(e) => setInputProjectId(e.target.value)}
                  onPressEnter={confirmSyncWithProjectId}
                />
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                  You can find this in the CompanyCam project URL (e.g., https://app.companycam.com/projects/12345678)
                </Text>
              </div>
              {searchResults.length > 0 && (
                <Button
                  type="link"
                  onClick={() => {
                    setManualInput(false);
                    setInputProjectId('');
                  }}
                  style={{ padding: 0 }}
                >
                  ← Back to search results
                </Button>
              )}
            </>
          )}
        </Space>
      </Modal>

      {/* Google Drive Export Confirmation Modal */}
      <Modal
        title={
          <Space>
            <GoogleOutlined style={{ color: '#4285f4' }} />
            <span>Export Photos to Google Drive</span>
          </Space>
        }
        open={exportModalVisible}
        onOk={confirmExport}
        onCancel={() => setExportModalVisible(false)}
        confirmLoading={exportMutation.isPending}
        okText="Start Export"
        cancelText="Cancel"
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text>
            This will export all photos from this job to your Google Drive:
          </Text>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Photos will be uploaded to <strong>CompanyCam/[Job Address]</strong> folder</li>
            <li>Existing files with the same name will be skipped</li>
            <li>Original photo quality will be preserved</li>
            <li>You can cancel the export at any time</li>
          </ul>
          <Alert
            type="info"
            message="Google Drive Authorization Required"
            description="Make sure you have connected your Google Drive account in Profile settings."
            showIcon
          />
          <Text type="secondary">
            This may take a while for jobs with many photos. Progress will be shown in the header.
          </Text>
        </Space>
      </Modal>
    </div>
  );
};

export default WaterMitigationPhotosTab;
