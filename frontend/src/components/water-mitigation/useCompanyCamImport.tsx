/**
 * CompanyCam import: find the project, pick the capture dates, run the import
 * and follow it. A water mitigation job's Photos tab and the client page share
 * this; the server answers the same paths under a job and under a claim.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, List, Modal, Space, Spin, Tag, Typography, message } from 'antd';
import { CloseCircleOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { FileContext } from '../common/FileGallery/types';
import type { CompanyCamSyncResult } from '../../types/waterMitigation';
import CompanyCamDateSelectModal from './CompanyCamDateSelectModal';

const { Text } = Typography;

export interface CompanyCamImportTarget {
  /** Where the photos land, so its galleries refresh afterwards */
  context: FileContext;
  contextId: string;
  /** The import endpoints hang off this path */
  basePath: string;
  /** Already tied to a project: goes straight to picking dates */
  projectId?: string;
  /** The import started from a project it wasn't tied to */
  onProjectLinked?: (projectId: string) => void;
}

// Sync status type
export interface CompanyCamSyncStatus {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed' | 'unknown';
  synced_count?: number;
  skipped_existing?: number;
  skipped_trashed?: number;
  skipped_date_filtered?: number;
  total_companycam?: number;
  current_page?: number;
  errors?: string[];
  message?: string;
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
const syncCompanyCamPhotos = async (
  basePath: string,
  projectId?: string,
  selectedDates?: string[]
): Promise<CompanyCamSyncResult> => {
  const params = new URLSearchParams();
  if (projectId) params.set('companycam_project_id', projectId);
  if (selectedDates && selectedDates.length > 0) params.set('selected_dates', selectedDates.join(','));
  const qs = params.toString();
  const response = await api.post(`${basePath}/sync-companycam-photos${qs ? `?${qs}` : ''}`);
  return response.data;
};

const getSyncStatus = async (basePath: string): Promise<CompanyCamSyncStatus> => {
  // suppressErrorNotification: the callers retry or ignore a failure on their
  // own - the global "다시 시도" toast would otherwise re-pop every 2-3s for the
  // exact same transient blip the poll is already recovering from.
  const response = await api.get(`${basePath}/sync-companycam-photos/status`, {
    suppressErrorNotification: true,
  });
  return response.data;
};

const cancelSync = async (basePath: string): Promise<{ success: boolean; message: string }> => {
  const response = await api.post(`${basePath}/sync-companycam-photos/cancel`);
  return response.data;
};

const searchCompanyCamProjects = async (basePath: string, query?: string): Promise<ProjectSearchResult> => {
  const params = query ? `?query=${encodeURIComponent(query)}` : '';
  const response = await api.get(`${basePath}/search-companycam-projects${params}`);
  return response.data;
};

export const useCompanyCamImport = (target: CompanyCamImportTarget) => {
  const { basePath, context, contextId } = target;
  const queryClient = useQueryClient();
  const [dateSelectModalVisible, setDateSelectModalVisible] = useState(false);
  const [dateSelectProjectId, setDateSelectProjectId] = useState<string | undefined>(undefined);
  const [projectIdModalVisible, setProjectIdModalVisible] = useState(false);
  const [inputProjectId, setInputProjectId] = useState('');
  const [syncStatus, setSyncStatus] = useState<CompanyCamSyncStatus>({ status: 'idle' });
  const [isSyncing, setIsSyncing] = useState(false);
  const pollingRef = useRef<boolean>(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Project search state
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CompanyCamProject[]>([]);
  const [jobAddress, setJobAddress] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<CompanyCamProject | null>(null);
  const [manualInput, setManualInput] = useState(false);

  // Poll for sync status using setTimeout (waits for previous request to complete)
  const pollStatus = async () => {
    if (!pollingRef.current) return;

    try {
      const status = await getSyncStatus(basePath);

      // Check if still polling (component might have unmounted)
      if (!pollingRef.current) return;

      setSyncStatus(status);

      // Stop polling if sync finished
      if (status.status === 'completed' || status.status === 'cancelled' || status.status === 'failed') {
        stopPolling();
        setIsSyncing(false);
        // Refresh photos, including a gallery that isn't showing: they don't
        // refetch on mount, so it would come back without the new photos
        queryClient.invalidateQueries({ queryKey: ['files', context, contextId], refetchType: 'all' });
        queryClient.invalidateQueries({ queryKey: ['files-infinite', context, contextId], refetchType: 'all' });

        if (status.status === 'completed') {
          message.success(status.message || 'Sync completed!');
        } else if (status.status === 'failed') {
          message.error(status.message || 'Sync failed');
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

  // Check status when the target changes, and stop following it after that
  useEffect(() => {
    let stale = false;
    setSyncStatus({ status: 'idle' });
    setIsSyncing(false);
    // Always check status - sync might have been started with a manually entered project ID
    getSyncStatus(basePath)
      .then((status) => {
        if (stale) return;
        setSyncStatus(status);
        if (status.status === 'running') {
          setIsSyncing(true);
          startPolling();
        }
      })
      .catch(() => {
        // Ignore errors on initial check
      });
    return () => {
      stale = true;
      stopPolling();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  // Search for CompanyCam projects when modal opens
  const handleSearchProjects = async (searchPath: string) => {
    setIsSearching(true);
    setSearchResults([]);
    setSelectedProject(null);
    setManualInput(false);
    setInputProjectId('');

    try {
      const result = await searchCompanyCamProjects(searchPath);
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

  // Sync mutation - supports project ID + a date filter picked in CompanyCamDateSelectModal
  const syncMutation = useMutation({
    mutationFn: ({ projectId, selectedDates }: { projectId?: string; selectedDates?: string[] }) =>
      syncCompanyCamPhotos(basePath, projectId, selectedDates),
    onMutate: () => {
      setIsSyncing(true);
      setDateSelectModalVisible(false);
      setProjectIdModalVisible(false);
      startPolling();
    },
    onSuccess: (result, { projectId }) => {
      // Polling will handle the final state
      if (result.cancelled) {
        message.info('Sync was cancelled');
      }
      if (projectId && projectId !== target.projectId) {
        target.onProjectLinked?.(projectId);
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
    mutationFn: () => cancelSync(basePath),
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

  /** A caller about to switch target passes the new one, since this render still holds the old */
  const start = (next: CompanyCamImportTarget = target) => {
    if (next.projectId) {
      // Project ID exists, go straight to date selection
      setDateSelectProjectId(next.projectId);
      setDateSelectModalVisible(true);
    } else {
      // No project ID, show search modal and start search
      setProjectIdModalVisible(true);
      handleSearchProjects(next.basePath);
    }
  };

  const confirmSyncWithProjectId = () => {
    const projectId = manualInput ? inputProjectId.trim() : selectedProject?.id;

    if (!projectId) {
      message.error('Please select a project or enter a Project ID');
      return;
    }

    setProjectIdModalVisible(false);
    setDateSelectProjectId(projectId);
    setDateSelectModalVisible(true);
  };

  const handleCancel = () => {
    cancelMutation.mutate();
  };

  // Calculate progress
  const processed = syncStatus.status === 'running'
    ? (syncStatus.synced_count || 0) + (syncStatus.skipped_existing || 0) + (syncStatus.skipped_trashed || 0)
    : null;

  const progress = (
    <>
      {isSyncing && processed !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: '#edf3ec', borderRadius: 6, border: '1px solid #d3e5d0' }}>
          <SyncOutlined spin style={{ color: '#448361' }} />
          <Text style={{ fontSize: 12 }}>
            Syncing… {processed} photos and videos
          </Text>
          <Button type="text" danger size="small" aria-label="Cancel sync" icon={<CloseCircleOutlined />} onClick={handleCancel} loading={cancelMutation.isPending} style={{ padding: '0 4px' }} />
        </div>
      )}
      {!isSyncing && syncStatus.status === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#e7f3f8', borderRadius: 6, border: '1px solid #c6e0ee' }}>
          <SyncOutlined spin style={{ color: '#1f74c9', fontSize: 12 }} />
          <Text style={{ fontSize: 12 }}>Sync running</Text>
          <Button size="small" onClick={() => { setIsSyncing(true); startPolling(); }}>Resume</Button>
          <Button type="text" danger size="small" aria-label="Cancel sync" icon={<CloseCircleOutlined />} onClick={handleCancel} loading={cancelMutation.isPending} style={{ padding: '0 4px' }} />
        </div>
      )}
    </>
  );

  const modals = (
    <>
      {/* CompanyCam Date Select Modal - pick which capture dates to import (linked or newly-linked project) */}
      <CompanyCamDateSelectModal
        visible={dateSelectModalVisible}
        basePath={basePath}
        projectId={dateSelectProjectId}
        confirmLoading={syncMutation.isPending}
        onCancel={() => setDateSelectModalVisible(false)}
        onConfirm={(selectedDates) => syncMutation.mutate({ projectId: dateSelectProjectId, selectedDates })}
      />

      {/* Project Search Modal - when no project is linked */}
      <Modal
        title={
          <Space>
            <SearchOutlined style={{ color: '#1f74c9' }} />
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
        okText="Link & Choose Dates"
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
                      backgroundColor: selectedProject?.id === project.id ? '#e7f3f8' : 'transparent',
                      borderLeft: selectedProject?.id === project.id ? '3px solid #1f74c9' : '3px solid transparent',
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
                  CompanyCam Project ID <span style={{ color: '#d44c47' }}>*</span>
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
    </>
  );

  return { start, isSyncing, syncStatus, progress, modals };
};
