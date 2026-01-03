/**
 * Water Mitigation Photos Tab
 * Uses FileGallery component with date-based grouping option
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Space, message, Modal, Typography, Alert, Input, Form } from 'antd';
import { SyncOutlined, CloudDownloadOutlined, StopOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import FileGallery from '../common/FileGallery/FileGallery';
import api from '../../services/api';
import waterMitigationService from '../../services/waterMitigationService';
import type { CompanyCamSyncResult } from '../../types/waterMitigation';

const { Text } = Typography;

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

// API calls - now supports optional project ID parameter
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

interface WaterMitigationPhotosTabProps {
  jobId: string;
  companycamProjectId?: string;
  onProjectIdUpdated?: (projectId: string) => void;
}

const WaterMitigationPhotosTab: React.FC<WaterMitigationPhotosTabProps> = ({
  jobId,
  companycamProjectId,
  onProjectIdUpdated
}) => {
  const queryClient = useQueryClient();
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [projectIdModalVisible, setProjectIdModalVisible] = useState(false);
  const [inputProjectId, setInputProjectId] = useState('');
  const [currentProjectId, setCurrentProjectId] = useState(companycamProjectId);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ status: 'idle' });
  const [isSyncing, setIsSyncing] = useState(false);
  const pollingRef = useRef<boolean>(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    return () => stopPolling();
  }, []);

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
      // No project ID, show input modal
      setInputProjectId('');
      setProjectIdModalVisible(true);
    }
  };

  const confirmSync = () => {
    syncMutation.mutate(undefined);
  };

  const confirmSyncWithProjectId = () => {
    if (!inputProjectId.trim()) {
      message.error('Please enter a CompanyCam Project ID');
      return;
    }
    // Update local state and notify parent
    setCurrentProjectId(inputProjectId.trim());
    if (onProjectIdUpdated) {
      onProjectIdUpdated(inputProjectId.trim());
    }
    syncMutation.mutate(inputProjectId.trim());
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

  return (
    <div className="wm-photos-tab" style={{ height: 'calc(100vh - 180px)', padding: '16px' }}>
      {/* Sync Controls - always visible */}
      <div style={{ marginBottom: '12px' }}>
        {/* Progress indicator when syncing */}
        {isSyncing && progressInfo && (
          <Alert
            type="info"
            showIcon
            icon={<SyncOutlined spin />}
            message={
              <Space direction="vertical" style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text>
                    Syncing photos... Page {progressInfo.page} |
                    Synced: {progressInfo.synced} | Skipped: {progressInfo.skipped}
                  </Text>
                  <Button
                    danger
                    size="small"
                    icon={<StopOutlined />}
                    onClick={handleCancel}
                    loading={cancelMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </Space>
            }
            style={{ marginBottom: '12px' }}
          />
        )}

        {/* Sync button - always visible */}
        {!isSyncing && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
            {currentProjectId && (
              <Text type="secondary" style={{ fontSize: '12px' }}>
                <LinkOutlined /> Project: {currentProjectId}
              </Text>
            )}
            <Button
              icon={<SyncOutlined />}
              onClick={handleSyncClick}
            >
              {currentProjectId ? 'Sync from CompanyCam' : 'Link & Sync CompanyCam'}
            </Button>
          </div>
        )}
      </div>

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

        // Multi-select support
        allowMultiSelect={true}

        // Water mitigation specific categories
        categories={[
          'uncategorized',
          'damage-assessment',
          'before-mitigation',
          'during-mitigation',
          'after-mitigation',
          'equipment',
          'moisture-readings',
          'documentation',
          'insurance',
          'general'
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
      />

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

      {/* Project ID Input Modal - when no project is linked */}
      <Modal
        title={
          <Space>
            <LinkOutlined style={{ color: '#1890ff' }} />
            <span>Link CompanyCam Project</span>
          </Space>
        }
        open={projectIdModalVisible}
        onOk={confirmSyncWithProjectId}
        onCancel={() => setProjectIdModalVisible(false)}
        confirmLoading={syncMutation.isPending}
        okText="Link & Start Sync"
        cancelText="Cancel"
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text>
            Enter the CompanyCam Project ID to link and sync photos from:
          </Text>
          <Form layout="vertical">
            <Form.Item
              label="CompanyCam Project ID"
              required
              help="You can find this in the CompanyCam project URL (e.g., https://app.companycam.com/projects/12345678)"
            >
              <Input
                placeholder="e.g., 12345678"
                value={inputProjectId}
                onChange={(e) => setInputProjectId(e.target.value)}
                onPressEnter={confirmSyncWithProjectId}
              />
            </Form.Item>
          </Form>
          <Text type="secondary">
            This will save the project ID and start syncing all photos from CompanyCam.
          </Text>
        </Space>
      </Modal>
    </div>
  );
};

export default WaterMitigationPhotosTab;
