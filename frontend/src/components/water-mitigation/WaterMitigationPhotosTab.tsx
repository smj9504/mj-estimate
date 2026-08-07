/**
 * Water Mitigation Photos Tab
 * Uses FileGallery component with date-based grouping option
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Space, message, Modal, Typography, Alert, Input, List, Tag, Spin, Tooltip, Progress, Grid, Table, Select, Row, Col, Dropdown } from 'antd';
import { SyncOutlined, CloudDownloadOutlined, LinkOutlined, SearchOutlined, CheckCircleOutlined, CloseCircleOutlined, CameraOutlined, GoogleOutlined, CloudUploadOutlined, ShareAltOutlined, CopyOutlined, RobotOutlined, ThunderboltOutlined, CloseOutlined, StarFilled, DownOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import FileGallery from '../common/FileGallery/FileGallery';
import api from '../../services/api';
import waterMitigationService, {
  AI_CATEGORY_LABELS,
  AI_CATEGORY_COLORS,
  type AIClassifyResult,
} from '../../services/waterMitigationService';
import type {
  CompanyCamSyncResult,
  MagicPlanProjectMatch,
  MagicPlanSyncResult,
} from '../../types/waterMitigation';
import { magicPlanService } from '../../services/waterMitigationService';
import {
  addPendingUpload,
  getPendingUploads,
  removePendingUpload,
  pendingUploadToFile,
  type PendingUploadRecord,
} from '../../utils/pendingPhotoUploadQueue';

const { Text, Title } = Typography;

// ─── Duplicate Detection Types ───
interface DuplicateGroup {
  bestPhotoId: string;  // highest quality (largest file)
  photoIds: string[];   // all photos in group
}

// ─── AI Results Grid (extracted to avoid IIFE in JSX) ───
const AI_PAGE_SIZE = 12;

const AiResultsGrid: React.FC<{
  results: AIClassifyResult[];
  filter: string;
  page: number;
  onPageChange: (p: number) => void;
  photoMap: Record<string, any>;
  overrides: Record<string, string>;
  onOverride: (photoId: string, val: string) => void;
  duplicateGroups?: DuplicateGroup[];
}> = ({ results, filter, page, onPageChange, photoMap, overrides, onOverride, duplicateGroups = [] }) => {
  // Build set of duplicate photo IDs and best photo IDs for quick lookup
  const dupPhotoIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const g of duplicateGroups) {
      for (const id of g.photoIds) ids.add(id);
    }
    return ids;
  }, [duplicateGroups]);

  const bestPhotoIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const g of duplicateGroups) ids.add(g.bestPhotoId);
    return ids;
  }, [duplicateGroups]);

  // For duplicates filter, include photos not in AI results (already-classified photos)
  const allDupResults = React.useMemo(() => {
    if (filter !== 'duplicates') return [];
    const resultIds = new Set(results.map(r => r.photo_id));
    const extraResults: AIClassifyResult[] = [];
    for (const g of duplicateGroups) {
      for (const id of g.photoIds) {
        if (!resultIds.has(id)) {
          const photo = photoMap[id];
          extraResults.push({
            photo_id: id,
            category: photo?.category || 'uncategorized',
            confidence: 1.0,
            metadata: { meter_visible: false, meter_color: null, is_demolished: false, equipment_count: 0, equipment_status: null, mold_visible: false },
          });
        }
      }
    }
    return [...results, ...extraResults].filter(r => dupPhotoIds.has(r.photo_id));
  }, [filter, results, duplicateGroups, dupPhotoIds, photoMap]);

  const filtered = filter === 'all' ? results
    : filter === 'classified' ? results.filter(r => !r.error && r.category !== 'uncategorized')
    : filter === 'uncategorized' ? results.filter(r => r.category === 'uncategorized' && !r.error)
    : filter === 'error' ? results.filter(r => !!r.error)
    : filter === 'duplicates' ? allDupResults
    : results;

  const paged = filtered.slice((page - 1) * AI_PAGE_SIZE, page * AI_PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / AI_PAGE_SIZE);

  const categoryOptions = Object.entries(AI_CATEGORY_LABELS).map(([value, label]) => ({
    value,
    label: (
      <Space size={4}>
        <span style={{
          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
          background: AI_CATEGORY_COLORS[value] || '#bfbfbf',
        }} />
        {label}
      </Space>
    ),
  }));

  return (
    <>
      <Row gutter={[12, 12]}>
        {paged.map((record) => {
          const photo = photoMap[record.photo_id];
          const thumbUrl = photo?._thumbUrl || '';
          const displayCat = overrides[record.photo_id] || record.category || 'uncategorized';
          const pct = Math.round((record.confidence || 0) * 100);
          const meta = record.metadata || null;
          const isRemoved = displayCat === 'uncategorized' && (overrides[record.photo_id] === 'uncategorized');
          const isDup = dupPhotoIds.has(record.photo_id);
          const isBest = bestPhotoIds.has(record.photo_id);

          return (
            <Col key={record.photo_id} xs={12} sm={8} md={6}>
              <div style={{
                border: isRemoved ? '2px solid #ff4d4f' : isDup ? (isBest ? '2px solid #52c41a' : '2px solid #faad14') : '1px solid #f0f0f0',
                borderRadius: 8, overflow: 'hidden', background: isRemoved ? '#fff1f0' : '#fff',
                opacity: isRemoved ? 0.6 : 1,
                position: 'relative',
              }}>
                {/* Quick remove (X) button */}
                {!record.error && !isRemoved && (
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => onOverride(record.photo_id, 'uncategorized')}
                    style={{
                      position: 'absolute', top: 4, right: 4, zIndex: 10,
                      background: 'rgba(0,0,0,0.5)', color: '#fff',
                      width: 24, height: 24, minWidth: 24,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: '50%', border: 'none', padding: 0,
                    }}
                    title="Remove (set uncategorized)"
                  />
                )}
                {/* Undo button for removed photos */}
                {isRemoved && (
                  <Button
                    type="text"
                    size="small"
                    onClick={() => {
                      // Restore to original AI category
                      onOverride(record.photo_id, record.category || 'uncategorized');
                    }}
                    style={{
                      position: 'absolute', top: 4, right: 4, zIndex: 10,
                      background: 'rgba(0,0,0,0.5)', color: '#fff',
                      fontSize: 10, height: 24, minWidth: 24,
                      borderRadius: 12, border: 'none', padding: '0 8px',
                    }}
                  >
                    Undo
                  </Button>
                )}
                {/* Best duplicate badge */}
                {isDup && isBest && !isRemoved && (
                  <div style={{
                    position: 'absolute', top: 4, left: 4, zIndex: 10,
                    background: '#52c41a', color: '#fff', borderRadius: 4,
                    fontSize: 10, padding: '1px 6px', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 3,
                  }}>
                    <StarFilled style={{ fontSize: 10 }} /> Keep
                  </div>
                )}
                {/* Duplicate indicator */}
                {isDup && !isBest && !isRemoved && (
                  <div style={{
                    position: 'absolute', top: 4, left: 4, zIndex: 10,
                    background: '#faad14', color: '#fff', borderRadius: 4,
                    fontSize: 10, padding: '1px 6px', fontWeight: 600,
                  }}>
                    Dup
                  </div>
                )}
                <div style={{ height: 130, background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {thumbUrl ? (
                    <img src={thumbUrl} alt="" loading="lazy" style={{ width: '100%', height: 130, objectFit: 'cover', display: 'block' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <CameraOutlined style={{ fontSize: 32, color: '#d9d9d9' }} />
                  )}
                </div>
                <div style={{ padding: '8px 10px' }}>
                  {record.error ? (
                    <>
                      <Tag color="red">Error</Tag>
                      <Text type="danger" style={{ fontSize: 10, display: 'block', marginTop: 4 }}>{record.error}</Text>
                    </>
                  ) : (
                    <>
                      <Select size="small" value={displayCat}
                        onChange={(val) => onOverride(record.photo_id, val)}
                        style={{ width: '100%', marginBottom: 6 }}
                        options={categoryOptions} />
                      <Progress percent={pct} size="small"
                        strokeColor={pct >= 80 ? '#52c41a' : pct >= 60 ? '#faad14' : '#ff4d4f'}
                        format={(p) => `${p}%`} style={{ marginBottom: 4 }} />
                      {meta && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                          {meta.meter_visible && (
                            <Tag style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '18px' }}
                              color={meta.meter_color === 'red' ? 'red' : meta.meter_color === 'yellow' ? 'gold' : meta.meter_color === 'green' ? 'green' : 'default'}>
                              {meta.meter_color || '?'}
                            </Tag>
                          )}
                          {meta.is_demolished && <Tag style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '18px' }} color="volcano">Demo</Tag>}
                          {meta.equipment_count > 0 && <Tag style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '18px' }} color="blue">{meta.equipment_count} equip</Tag>}
                          {meta.mold_visible && <Tag style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '18px' }} color="red">Mold</Tag>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Col>
          );
        })}
      </Row>
      {filtered.length > AI_PAGE_SIZE && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button size="small" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Prev</Button>
          <Text style={{ margin: '0 12px', fontSize: 12 }}>{page} / {totalPages}</Text>
          <Button size="small" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</Button>
        </div>
      )}
    </>
  );
};

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
  isActive?: boolean;
}

const { useBreakpoint } = Grid;

const WaterMitigationPhotosTab: React.FC<WaterMitigationPhotosTabProps> = ({
  jobId,
  clientId,
  companycamProjectId,
  onProjectIdUpdated,
  isActive,
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

  // Background refresh when tab becomes active
  const prevActiveRef = useRef(isActive);
  useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      queryClient.invalidateQueries({ queryKey: ['files-infinite', 'water-mitigation', jobId] });
    }
    prevActiveRef.current = isActive;
  }, [isActive, jobId, queryClient]);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Project search state
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CompanyCamProject[]>([]);
  const [jobAddress, setJobAddress] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<CompanyCamProject | null>(null);
  const [manualInput, setManualInput] = useState(false);

  // MagicPlan sync state
  const [mpModalVisible, setMpModalVisible] = useState(false);
  const [mpSearching, setMpSearching] = useState(false);
  const [mpCandidates, setMpCandidates] = useState<MagicPlanProjectMatch[]>([]);
  const [mpAutoMatch, setMpAutoMatch] = useState<MagicPlanProjectMatch | null>(null);
  const [mpSelectedProject, setMpSelectedProject] = useState<MagicPlanProjectMatch | null>(null);
  const [mpSyncing, setMpSyncing] = useState(false);
  const [mpSyncResult, setMpSyncResult] = useState<MagicPlanSyncResult | null>(null);

  // Photo source filter state
  const [sourceFilter, setSourceFilter] = useState<string | undefined>(undefined);

  // Google Drive export state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ status: 'idle' });
  const [isExporting, setIsExporting] = useState(false);
  const exportPollingRef = useRef<boolean>(false);
  const exportTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Crew Upload Link state
  const [uploadLinkModalVisible, setUploadLinkModalVisible] = useState(false);
  const [uploadLinks, setUploadLinks] = useState<any[]>([]);
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkCrewName, setLinkCrewName] = useState('');
  const [linkLabel, setLinkLabel] = useState('');

  // AI Classification state
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiResults, setAiResults] = useState<AIClassifyResult[]>([]);
  const [aiClassifying, setAiClassifying] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0 });
  const [aiPage, setAiPage] = useState(1);
  const [aiFilter, setAiFilter] = useState<'all' | 'classified' | 'uncategorized' | 'error' | 'duplicates'>('all');
  // Track per-result overrides: photo_id -> user-selected category
  const [aiOverrides, setAiOverrides] = useState<Record<string, string>>({});
  const aiAbortRef = useRef(false);
  const aiAbortControllerRef = useRef<AbortController | null>(null);
  // Map photo_id -> photo data for thumbnail display in AI modal
  const aiPhotoMapRef = useRef<Record<string, any>>({});
  // Duplicate detection state (from backend perceptual hash API)
  const [aiDuplicateGroups, setAiDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [aiDetectingDuplicates, setAiDetectingDuplicates] = useState(false);

  // Update current project ID when prop changes
  useEffect(() => {
    setCurrentProjectId(companycamProjectId);
  }, [companycamProjectId]);

  // Files that exhausted their in-flight retries in uploadMultiple and were
  // saved to IndexedDB so they aren't lost on reload/navigation.
  const [pendingUploads, setPendingUploads] = useState<PendingUploadRecord[]>([]);
  const [retryingPending, setRetryingPending] = useState(false);

  const refreshPendingUploads = useCallback(async () => {
    try {
      setPendingUploads(await getPendingUploads(jobId));
    } catch (err) {
      console.error('Failed to read pending upload queue:', err);
    }
  }, [jobId]);

  useEffect(() => {
    refreshPendingUploads();
  }, [refreshPendingUploads]);

  // Custom upload handler for Water Mitigation photos
  const handleUpload = useCallback(async (files: File[], category?: string): Promise<void> => {
    const msgKey = 'photo-upload-progress';
    message.loading({ content: `Uploading 0/${files.length} photos...`, key: msgKey, duration: 0 });

    try {
      const { results, failed } = await waterMitigationService.photos.uploadMultiple(
        jobId,
        files,
        category,
        (completed, total, failedCount) => {
          const progress = Math.round((completed / total) * 100);
          message.loading({
            content: `Uploading photos ${completed}/${total} (${progress}%)${failedCount > 0 ? ` — ${failedCount} failed` : ''}`,
            key: msgKey,
            duration: 0,
          });
        },
      );

      if (failed.length > 0) {
        // Retries were already exhausted inside uploadMultiple - save these
        // to the local queue so a dropped connection doesn't lose the photo.
        await Promise.all(
          failed.map(f => addPendingUpload(jobId, f.file, category).catch(err =>
            console.error('Failed to save pending upload:', err)
          ))
        );
        await refreshPendingUploads();
      }

      if (failed.length === 0) {
        message.success({ content: `Successfully uploaded ${results.length} photo(s)`, key: msgKey, duration: 3 });
      } else if (results.length > 0) {
        message.warning({
          content: `Uploaded ${results.length}/${files.length} photos. ${failed.length} failed and were saved to retry later.`,
          key: msgKey,
          duration: 5,
        });
      } else {
        message.error({
          content: `All ${files.length} uploads failed and were saved to retry later. ${failed[0]?.error || 'Unknown error'}`,
          key: msgKey,
          duration: 5,
        });
      }
      // Refresh photos after upload
      queryClient.invalidateQueries({ queryKey: ['files', 'water-mitigation', jobId] });
      queryClient.invalidateQueries({ queryKey: ['files-infinite', 'water-mitigation', jobId] });
    } catch (error: any) {
      console.error('Upload failed:', error);
      message.error({ content: `Upload failed: ${error.message || 'Unknown error'}`, key: msgKey, duration: 5 });
      throw error;
    }
  }, [jobId, queryClient, refreshPendingUploads]);

  // Resend everything sitting in the local pending-upload queue (grouped by
  // category, since uploadMultiple takes one category per call).
  const handleRetryPendingUploads = useCallback(async () => {
    if (pendingUploads.length === 0) return;
    setRetryingPending(true);
    const msgKey = 'pending-upload-retry';
    message.loading({ content: `Retrying ${pendingUploads.length} pending photo(s)...`, key: msgKey, duration: 0 });

    try {
      const groups = new Map<string, PendingUploadRecord[]>();
      pendingUploads.forEach(rec => {
        const key = rec.category || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(rec);
      });

      const succeededIds: string[] = [];
      const stillFailedIds: string[] = [];

      for (const [category, records] of groups) {
        const files = records.map(pendingUploadToFile);
        const { failed } = await waterMitigationService.photos.uploadMultiple(
          jobId,
          files,
          category || undefined,
        );
        const failedNames = new Set(failed.map(f => f.name));
        records.forEach(rec => {
          if (failedNames.has(rec.fileName)) {
            stillFailedIds.push(rec.id);
          } else {
            succeededIds.push(rec.id);
          }
        });
      }

      await Promise.all(succeededIds.map(id => removePendingUpload(id)));
      await refreshPendingUploads();

      const stillFailedCount = stillFailedIds.length;
      if (stillFailedCount === 0) {
        message.success({ content: `Successfully uploaded ${succeededIds.length} pending photo(s)`, key: msgKey, duration: 3 });
      } else {
        message.warning({
          content: `${succeededIds.length} uploaded, ${stillFailedCount} still failing. They remain saved for retry.`,
          key: msgKey,
          duration: 5,
        });
      }

      if (succeededIds.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['files', 'water-mitigation', jobId] });
        queryClient.invalidateQueries({ queryKey: ['files-infinite', 'water-mitigation', jobId] });
      }
    } catch (error: any) {
      console.error('Retry of pending uploads failed:', error);
      message.error({ content: `Retry failed: ${error.message || 'Unknown error'}`, key: msgKey, duration: 5 });
    } finally {
      setRetryingPending(false);
    }
  }, [pendingUploads, jobId, queryClient, refreshPendingUploads]);

  const handleDiscardPendingUploads = useCallback(async () => {
    await Promise.all(pendingUploads.map(rec => removePendingUpload(rec.id)));
    await refreshPendingUploads();
    message.info('Pending uploads discarded.');
  }, [pendingUploads, refreshPendingUploads]);

  // Auto-retry once the browser reports connectivity is back, so a worker
  // doesn't have to remember to come tap "retry" after they get signal again.
  useEffect(() => {
    if (pendingUploads.length === 0) return;
    const handleOnline = () => { handleRetryPendingUploads(); };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [pendingUploads.length, handleRetryPendingUploads]);

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

  // ─── AI Classification handlers ───
  const handleAiClassify = useCallback(async (resume = false, reclassifyAll = false) => {
    aiAbortRef.current = false;
    setAiClassifying(true);
    setAiModalVisible(true);

    // Fresh start: clear previous results
    if (!resume) {
      setAiResults([]);
      setAiOverrides({});
      setAiDuplicateGroups([]);
      setAiProgress({ current: 0, total: 0 });
      setAiPage(1);
      setAiFilter('all');
      aiPhotoMapRef.current = {};
    }

    try {
      // Fetch all photos for this job to get IDs (paginated)
      let allItems: any[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const params = new URLSearchParams({ page_size: '100', page: String(page) });
        const response = await api.get(`/api/water-mitigation/jobs/${jobId}/photos?${params}`);
        const pageItems = response.data.items || response.data.photos || [];
        allItems.push(...pageItems);
        totalPages = response.data.total_pages || 1;
        page++;
      } while (page <= totalPages);
      const items = allItems;

      // Filter: uncategorized only (default) or all photos (reclassify)
      const targetPhotos = reclassifyAll
        ? items
        : items.filter(
            (p: any) => !p.category || p.category === '' || p.category === 'uncategorized'
          );

      if (targetPhotos.length === 0) {
        message.info(reclassifyAll ? 'No photos found.' : 'All photos already have categories assigned.');
        setAiClassifying(false);
        return;
      }

      // Build photo map for thumbnail display in AI modal
      const baseURL = api.defaults.baseURL || '';
      for (const p of targetPhotos) {
        const thumbUrl = p.thumbnail_url
          ? (p.thumbnail_url.startsWith('http') ? p.thumbnail_url : `${baseURL}${p.thumbnail_url}`)
          : `${baseURL}/api/water-mitigation/photos/${p.id}/preview?size=web`;
        aiPhotoMapRef.current[p.id] = { ...p, _thumbUrl: thumbUrl };
      }

      let photoIds = targetPhotos.map((p: any) => p.id);

      // Resume: skip already-classified photo IDs
      if (resume && aiResults.length > 0) {
        const doneIds = new Set(aiResults.map(r => r.photo_id));
        photoIds = photoIds.filter((id: string) => !doneIds.has(id));

        if (photoIds.length === 0) {
          message.info('All uncategorized photos are already classified.');
          setAiClassifying(false);
          return;
        }
      }

      // Classify in batches of 10 to avoid timeout
      const batchSize = 10;
      const allResults: AIClassifyResult[] = resume ? [...aiResults] : [];
      const totalPhotos = (resume ? aiResults.length : 0) + photoIds.length;
      setAiProgress({ current: allResults.length, total: totalPhotos });

      for (let i = 0; i < photoIds.length; i += batchSize) {
        if (aiAbortRef.current) {
          message.info(`Stopped. ${allResults.length} photos classified.`);
          break;
        }

        const batch = photoIds.slice(i, i + batchSize);
        const controller = new AbortController();
        aiAbortControllerRef.current = controller;

        try {
          const result = await waterMitigationService.photos.aiClassify(batch, reclassifyAll, controller.signal);
          allResults.push(...result.results);
          setAiResults([...allResults]);
          setAiProgress({ current: allResults.length, total: totalPhotos });
        } catch (err: any) {
          if (err.name === 'AbortError' || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
            message.info(`Stopped. ${allResults.length} photos classified.`);
            break;
          }
          const detail = err?.response?.data?.detail || err.message || 'Unknown error';
          console.error('AI batch classification failed:', detail, err);
          message.error(`AI classification error: ${detail}`);
          break;
        }
      }

      if (allResults.length === 0 && !aiAbortRef.current) {
        message.warning('AI classification returned no results. Check GEMINI_API_KEY configuration.');
      }
    } catch (error: any) {
      console.error('AI classification failed:', error);
      message.error(`AI classification failed: ${error?.response?.data?.detail || error.message || 'Unknown error'}`);
    } finally {
      setAiClassifying(false);
    }
  }, [jobId, aiResults]);

  // Load previously cached AI results
  const handleAiLoadPrevious = useCallback(async () => {
    try {
      setAiClassifying(true);
      setAiModalVisible(true);
      setAiResults([]);
      setAiOverrides({});
      setAiPage(1);
      setAiFilter('all');

      // Fetch photo data for thumbnails (paginated)
      const baseURL = api.defaults.baseURL || '';
      let allPhotos: any[] = [];
      let pgNum = 1;
      let pgTotal = 1;
      do {
        const params = new URLSearchParams({ page_size: '100', page: String(pgNum) });
        const photoResp = await api.get(`/api/water-mitigation/jobs/${jobId}/photos?${params}`);
        const pgItems = photoResp.data.items || photoResp.data.photos || [];
        allPhotos.push(...pgItems);
        pgTotal = photoResp.data.total_pages || 1;
        pgNum++;
      } while (pgNum <= pgTotal);
      const photos = allPhotos;
      aiPhotoMapRef.current = {};
      for (const p of photos) {
        const thumbUrl = p.thumbnail_url
          ? (p.thumbnail_url.startsWith('http') ? p.thumbnail_url : `${baseURL}${p.thumbnail_url}`)
          : `${baseURL}/api/water-mitigation/photos/${p.id}/preview?size=web`;
        aiPhotoMapRef.current[p.id] = { ...p, _thumbUrl: thumbUrl };
      }

      // Fetch cached results
      const data = await waterMitigationService.photos.aiResults(jobId);
      if (data.results.length === 0) {
        message.info('No previous AI classification results found.');
      }
      setAiResults(data.results);
      setAiProgress({ current: data.results.length, total: data.results.length });
    } catch (error: any) {
      message.error(`Failed to load results: ${error.message}`);
    } finally {
      setAiClassifying(false);
    }
  }, [jobId]);

  const handleAiStop = useCallback(() => {
    aiAbortRef.current = true;
    aiAbortControllerRef.current?.abort();
  }, []);

  const handleAiCancel = useCallback(() => {
    aiAbortRef.current = true;
    aiAbortControllerRef.current?.abort();
    setAiResults([]);
    setAiOverrides({});
    setAiDuplicateGroups([]);
    setAiModalVisible(false);
  }, []);

  const handleAiApplyAll = useCallback(async () => {
    setAiApplying(true);
    try {
      // Build updates: each photo gets its own category
      const updates = aiResults
        .filter(r => {
          if (r.error) return false;
          const finalCategory = aiOverrides[r.photo_id] || r.category;
          return finalCategory && finalCategory !== 'uncategorized';
        })
        .map(r => ({
          photo_id: r.photo_id,
          category: aiOverrides[r.photo_id] || r.category,
        }));

      if (updates.length === 0) {
        message.info('No categories to apply.');
        setAiApplying(false);
        return;
      }

      // Single bulk API call instead of N individual calls
      const result = await waterMitigationService.photos.bulkSetCategories(updates);

      message.success(`Applied categories to ${result.applied} photos${result.failed > 0 ? ` (${result.failed} failed)` : ''}`);
      setAiModalVisible(false);

      // Refresh gallery
      queryClient.invalidateQueries({ queryKey: ['files', 'water-mitigation', jobId] });
      queryClient.invalidateQueries({ queryKey: ['files-infinite', 'water-mitigation', jobId] });
    } catch (error: any) {
      message.error(`Failed to apply: ${error.message}`);
    } finally {
      setAiApplying(false);
    }
  }, [aiResults, aiOverrides, jobId, queryClient]);

  // ─── Crew Upload Link handlers ───
  const fetchUploadLinks = useCallback(async () => {
    try {
      const res = await api.get(`/api/crew-upload/admin/links/water-mitigation/${jobId}`);
      setUploadLinks(res.data.items || []);
    } catch {
      // Endpoint may not exist yet
    }
  }, [jobId]);

  const handleCreateUploadLink = async () => {
    setCreatingLink(true);
    try {
      const res = await api.post('/api/crew-upload/admin/links', {
        context: 'water-mitigation',
        context_id: jobId,
        crew_name: linkCrewName || undefined,
        label: linkLabel || undefined,
        expires_in_days: 7,
      });
      const link = res.data;
      const url = `${window.location.origin}/upload/${link.token}`;
      setUploadLinks(prev => [{ ...link, upload_url: url }, ...prev]);
      setLinkCrewName('');
      setLinkLabel('');
      message.success('Upload link created');

      // Auto-copy to clipboard
      try {
        await navigator.clipboard.writeText(url);
        message.info('Link copied to clipboard');
      } catch {
        // Clipboard not available
      }
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to create link');
    } finally {
      setCreatingLink(false);
    }
  };

  const handleDeactivateLink = async (linkId: string) => {
    try {
      await api.put(`/api/crew-upload/admin/links/${linkId}/deactivate`);
      setUploadLinks(prev => prev.map(l => l.id === linkId ? { ...l, is_active: false } : l));
      message.success('Link deactivated');
    } catch {
      message.error('Failed to deactivate link');
    }
  };

  const handleCopyLink = async (token: string) => {
    const url = `${window.location.origin}/upload/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      message.success('Link copied!');
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      message.success('Link copied!');
    }
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

  // ── MagicPlan handlers ──────────────────────────────────
  const handleMagicPlanClick = async () => {
    setMpModalVisible(true);
    setMpSearching(true);
    setMpSyncResult(null);
    setMpSelectedProject(null);
    try {
      const result = await magicPlanService.searchProjects(jobId);
      setMpAutoMatch(result.auto_match || null);
      setMpCandidates(result.candidates || []);
      if (result.auto_match) {
        setMpSelectedProject(result.auto_match);
      }
    } catch (err: any) {
      message.error('Failed to search MagicPlan projects');
    } finally {
      setMpSearching(false);
    }
  };

  const handleMagicPlanSync = async () => {
    if (!mpSelectedProject) {
      message.error('Please select a MagicPlan project');
      return;
    }
    setMpSyncing(true);
    try {
      const result = await magicPlanService.syncPhotos(
        jobId,
        mpSelectedProject.project_id,
        mpSelectedProject.project_name
      );
      setMpSyncResult(result);
      if (result.success) {
        message.success(`Synced ${result.photos_synced} photos from MagicPlan`);
        queryClient.invalidateQueries({ queryKey: ['files-infinite', 'water-mitigation', jobId] });
      } else {
        message.error('MagicPlan sync failed');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'MagicPlan sync failed');
    } finally {
      setMpSyncing(false);
    }
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
      background: '#fff',
      border: '1px solid #f0f0f0',
      borderRadius: 8,
      overflow: 'hidden'
    }}>
      {/* Toolbar */}
      <div style={{
        padding: isMobile ? '8px 12px' : '12px 16px',
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        {/* Source filter — left side */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: '1 1 auto' }}>
          {[
            { key: undefined, label: 'All' },
            { key: 'companycam', label: 'CompanyCam' },
            { key: 'magicplan', label: 'MagicPlan' },
            { key: 'manual_upload', label: 'Upload' },
          ].map(tab => (
            <Button
              key={tab.key || 'all'}
              type={sourceFilter === tab.key ? 'primary' : 'text'}
              size="small"
              onClick={() => setSourceFilter(tab.key)}
              style={{
                borderRadius: 6,
                fontSize: 12,
                fontWeight: sourceFilter === tab.key ? 500 : 400,
              }}
            >
              {tab.label}
            </Button>
          ))}
          {currentProjectId && (
            <Tooltip title={`CompanyCam ID: ${currentProjectId}`}>
              <Tag color="blue" style={{ margin: 0, lineHeight: '22px', fontSize: 11 }}>
                <CheckCircleOutlined style={{ marginRight: 3 }} />Linked
              </Tag>
            </Tooltip>
          )}
        </div>

        {/* Actions — right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {/* Sync / Export progress inline */}
          {isSyncing && progressInfo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
              <SyncOutlined spin style={{ color: '#52c41a' }} />
              <Text style={{ fontSize: 12 }}>
                Syncing… {progressInfo.synced + progressInfo.skipped} photos
              </Text>
              <Button type="text" danger size="small" icon={<CloseCircleOutlined />} onClick={handleCancel} loading={cancelMutation.isPending} style={{ padding: '0 4px' }} />
            </div>
          )}
          {!isSyncing && syncStatus.status === 'running' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#e6f7ff', borderRadius: 6, border: '1px solid #91d5ff' }}>
              <SyncOutlined spin style={{ color: '#1890ff', fontSize: 12 }} />
              <Text style={{ fontSize: 12 }}>Sync running</Text>
              <Button size="small" onClick={() => { setIsSyncing(true); startPolling(); }}>Resume</Button>
              <Button type="text" danger size="small" icon={<CloseCircleOutlined />} onClick={handleCancel} loading={cancelMutation.isPending} style={{ padding: '0 4px' }} />
            </div>
          )}
          {isExporting && (() => {
            const ep = getExportProgressInfo();
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: '#e6f7ff', borderRadius: 6, border: '1px solid #91d5ff' }}>
                <CloudUploadOutlined style={{ color: '#1890ff' }} />
                <Text style={{ fontSize: 12 }}>
                  Exporting {ep?.uploaded || 0}/{ep?.total || 0}
                </Text>
                <Progress percent={ep?.percent || 0} size="small" showInfo={false} style={{ width: 60, margin: 0 }} />
                <Button type="text" danger size="small" icon={<CloseCircleOutlined />} onClick={handleCancelExport} loading={cancelExportMutation.isPending} style={{ padding: '0 4px' }} />
              </div>
            );
          })()}

          {/* Import dropdown — CompanyCam, MagicPlan, Upload Link */}
          <Dropdown
            menu={{
              items: [
                {
                  key: 'companycam',
                  icon: currentProjectId ? <SyncOutlined /> : <LinkOutlined />,
                  label: currentProjectId ? 'Sync CompanyCam' : 'Link CompanyCam',
                  onClick: handleSyncClick,
                  disabled: isSyncing,
                },
                {
                  key: 'magicplan',
                  icon: <CloudDownloadOutlined />,
                  label: 'Sync MagicPlan',
                  onClick: handleMagicPlanClick,
                  disabled: mpSyncing,
                },
                { type: 'divider' as const },
                {
                  key: 'upload-link',
                  icon: <ShareAltOutlined />,
                  label: 'Crew Upload Link',
                  onClick: () => { setUploadLinkModalVisible(true); fetchUploadLinks(); },
                },
              ],
            }}
            trigger={['click']}
          >
            <Button size={isMobile ? 'small' : 'middle'} icon={<CloudDownloadOutlined />}>
              Import {!isMobile && <DownOutlined style={{ fontSize: 10 }} />}
            </Button>
          </Dropdown>

          {/* Tools dropdown — AI, Export */}
          <Dropdown
            menu={{
              items: [
                {
                  key: 'ai-uncategorized',
                  icon: <RobotOutlined />,
                  label: 'AI Classify (uncategorized)',
                  onClick: () => handleAiClassify(false, false),
                  disabled: aiClassifying,
                },
                {
                  key: 'ai-all',
                  icon: <ReloadOutlined />,
                  label: 'AI Classify (all photos)',
                  onClick: () => handleAiClassify(false, true),
                  disabled: aiClassifying,
                },
                {
                  key: 'ai-results',
                  icon: <SearchOutlined />,
                  label: 'View AI Results',
                  onClick: handleAiLoadPrevious,
                },
                { type: 'divider' as const },
                {
                  key: 'export-drive',
                  icon: <GoogleOutlined />,
                  label: 'Export to Google Drive',
                  onClick: handleExportClick,
                  disabled: isExporting,
                },
              ],
            }}
            trigger={['click']}
          >
            <Button size={isMobile ? 'small' : 'middle'} icon={<RobotOutlined />}>
              Tools {!isMobile && <DownOutlined style={{ fontSize: 10 }} />}
            </Button>
          </Dropdown>
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
                <span style={{ color: '#8c8c8c', marginLeft: 8 }}>
                  ({syncStatus.skipped_existing} skipped)
                </span>
              )}
            </span>
          }
          closable
          style={{ borderRadius: 0, border: 'none', borderBottom: '1px solid #b7eb8f' }}
        />
      )}

      {/* Pending Upload Queue - photos that failed to upload (network drop, etc.)
          and were saved locally so they aren't lost */}
      {pendingUploads.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={
            <span>
              <strong>{pendingUploads.length}</strong> photo(s) failed to upload and are saved on this device for retry.
            </span>
          }
          action={
            <Space>
              <Button size="small" onClick={handleDiscardPendingUploads} disabled={retryingPending}>
                Discard
              </Button>
              <Button type="primary" size="small" onClick={handleRetryPendingUploads} loading={retryingPending}>
                Retry Now
              </Button>
            </Space>
          }
          style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none' }}
        />
      )}

      {/* Main Content Area */}
      <div style={{
        flex: 1,
        padding: isMobile ? '8px' : '16px',
        overflow: 'hidden',
        background: '#fff'
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
            'property-overview',
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

          // Source filter (companycam, magicplan, manual_upload)
          sourceFilter={sourceFilter}

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

      {/* Crew Upload Link Modal */}
      <Modal
        title="Crew Upload Links"
        open={uploadLinkModalVisible}
        onCancel={() => setUploadLinkModalVisible(false)}
        footer={null}
        width={520}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* Create new link */}
          <div style={{
            background: '#fafafa',
            borderRadius: 8,
            padding: 16,
            border: '1px solid #f0f0f0',
          }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>New Upload Link</Text>
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Input
                placeholder="Crew name (optional)"
                value={linkCrewName}
                onChange={e => setLinkCrewName(e.target.value)}
                size="small"
              />
              <Input
                placeholder="Label - e.g. Kitchen photos (optional)"
                value={linkLabel}
                onChange={e => setLinkLabel(e.target.value)}
                size="small"
              />
              <Button
                type="primary"
                icon={<ShareAltOutlined />}
                onClick={handleCreateUploadLink}
                loading={creatingLink}
                block
              >
                Create Link (7 days)
              </Button>
            </Space>
          </div>

          {/* Existing links */}
          {uploadLinks.length > 0 && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Existing Links</Text>
              <List
                size="small"
                dataSource={uploadLinks}
                renderItem={(link: any) => {
                  const isExpired = new Date(link.expires_at) < new Date();
                  const isActive = link.is_active && !isExpired;
                  return (
                    <List.Item
                      style={{ padding: '8px 0' }}
                      actions={isActive ? [
                        <Tooltip title="Copy link" key="copy">
                          <Button
                            type="text"
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={() => handleCopyLink(link.token)}
                          />
                        </Tooltip>,
                        <Button
                          type="text"
                          size="small"
                          danger
                          key="deactivate"
                          onClick={() => handleDeactivateLink(link.id)}
                        >
                          Deactivate
                        </Button>,
                      ] : undefined}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={4}>
                            <span>{link.crew_name || link.label || 'Upload Link'}</span>
                            {isActive ? (
                              <Tag color="green" style={{ fontSize: 11 }}>Active</Tag>
                            ) : (
                              <Tag color="default" style={{ fontSize: 11 }}>
                                {isExpired ? 'Expired' : 'Inactive'}
                              </Tag>
                            )}
                          </Space>
                        }
                        description={
                          <span style={{ fontSize: 12 }}>
                            {link.upload_count || 0} files uploaded
                            {link.expires_at && ` · Expires ${new Date(link.expires_at).toLocaleDateString()}`}
                          </span>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            </div>
          )}
        </Space>
      </Modal>
      {/* AI Classification Results Modal */}
      <Modal
        title={
          <Space>
            <RobotOutlined style={{ color: '#722ed1' }} />
            <span>AI Photo Classification</span>
          </Space>
        }
        open={aiModalVisible}
        onCancel={() => {
          if (aiClassifying) {
            handleAiCancel();
          } else {
            setAiModalVisible(false);
          }
        }}
        width={960}
        footer={
          <Space>
            {aiClassifying ? (
              <>
                <Button onClick={handleAiStop}>
                  Stop
                </Button>
                <Button danger onClick={handleAiCancel}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => setAiModalVisible(false)} disabled={aiApplying}>
                  Close
                </Button>
                {aiResults.length > 0 && aiProgress.current < aiProgress.total && (
                  <Button
                    icon={<RobotOutlined />}
                    onClick={() => { handleAiClassify(true); }}
                  >
                    Resume ({aiProgress.total - aiProgress.current} remaining)
                  </Button>
                )}
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  onClick={handleAiApplyAll}
                  loading={aiApplying}
                  disabled={aiResults.filter(r => !r.error && r.category !== 'uncategorized').length === 0}
                >
                  Apply All ({aiResults.filter(r => !r.error && (aiOverrides[r.photo_id] || r.category) !== 'uncategorized').length} photos)
                </Button>
              </>
            )}
          </Space>
        }
      >
        {aiClassifying && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 12 }}>
              <Text>Analyzing photos with AI...</Text>
              <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                {aiProgress.current} / {aiProgress.total} photos
              </Text>
            </div>
          </div>
        )}

        {aiResults.length > 0 && (() => {
          const dupCount = aiDuplicateGroups.reduce((sum, g) => sum + g.photoIds.length, 0);
          const dupExtraCount = aiDuplicateGroups.reduce((sum, g) => sum + g.photoIds.length - 1, 0);

          return (
          <>
            <div style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {[
                { key: 'all' as const, label: `All (${aiResults.length})`, color: 'default' },
                { key: 'classified' as const, label: `Classified (${aiResults.filter(r => !r.error && r.category !== 'uncategorized').length})`, color: 'green' },
                { key: 'uncategorized' as const, label: `Uncategorized (${aiResults.filter(r => r.category === 'uncategorized' && !r.error).length})`, color: 'orange' },
                ...(dupCount > 0 ? [{ key: 'duplicates' as const, label: `Duplicates (${dupCount})`, color: 'gold' }] : []),
                ...(aiResults.some(r => r.error) ? [{ key: 'error' as const, label: `Failed (${aiResults.filter(r => r.error).length})`, color: 'red' }] : []),
              ].map(f => (
                <Tag
                  key={f.key}
                  color={f.color}
                  style={{
                    cursor: 'pointer',
                    border: aiFilter === f.key ? '2px solid #1890ff' : undefined,
                    fontWeight: aiFilter === f.key ? 600 : undefined,
                  }}
                  onClick={() => { setAiFilter(f.key); setAiPage(1); }}
                >
                  {f.label}
                </Tag>
              ))}
              {/* Detect Duplicates button */}
              {aiDuplicateGroups.length === 0 && !aiDetectingDuplicates && (
                <Button
                  size="small"
                  icon={<SearchOutlined />}
                  style={{ marginLeft: 'auto' }}
                  onClick={async () => {
                    setAiDetectingDuplicates(true);
                    try {
                      const result = await waterMitigationService.photos.detectDuplicates(jobId);
                      if (result.groups.length === 0) {
                        message.info('No duplicate photos detected.');
                      } else {
                        const groups: DuplicateGroup[] = result.groups.map(g => ({
                          bestPhotoId: g.best_photo_id,
                          photoIds: g.photos.map(p => p.photo_id),
                        }));
                        setAiDuplicateGroups(groups);
                        // Also build photoMap entries for duplicates not already in results
                        const baseURL = api.defaults.baseURL || '';
                        for (const g of result.groups) {
                          for (const p of g.photos) {
                            if (!aiPhotoMapRef.current[p.photo_id]) {
                              aiPhotoMapRef.current[p.photo_id] = {
                                id: p.photo_id,
                                file_name: p.file_name,
                                category: p.category,
                                _thumbUrl: `${baseURL}/api/water-mitigation/photos/${p.photo_id}/preview?size=web`,
                              };
                            }
                          }
                        }
                        message.success(`Found ${result.total_duplicates} duplicate photos in ${result.groups.length} groups.`);
                        setAiFilter('duplicates');
                        setAiPage(1);
                      }
                    } catch (err: any) {
                      message.error(`Duplicate detection failed: ${err?.response?.data?.detail || err.message}`);
                    } finally {
                      setAiDetectingDuplicates(false);
                    }
                  }}
                >
                  Detect Duplicates
                </Button>
              )}
              {aiDetectingDuplicates && (
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8c8c8c' }}>
                  <Spin size="small" /> Analyzing images...
                </span>
              )}
              {dupExtraCount > 0 && aiFilter === 'duplicates' && (
                <Button
                  size="small"
                  type="primary"
                  style={{ background: '#faad14', borderColor: '#faad14', marginLeft: aiDuplicateGroups.length > 0 ? 'auto' : undefined }}
                  onClick={() => {
                    const newOverrides = { ...aiOverrides };
                    for (const g of aiDuplicateGroups) {
                      for (const id of g.photoIds) {
                        if (id !== g.bestPhotoId) {
                          newOverrides[id] = 'uncategorized';
                        }
                      }
                    }
                    setAiOverrides(newOverrides);
                    message.success(`Marked ${dupExtraCount} duplicate photos as uncategorized. Review and click "Apply All" to confirm.`);
                  }}
                >
                  Auto-remove {dupExtraCount} duplicates (keep best)
                </Button>
              )}
            </div>

            <AiResultsGrid
              results={aiResults}
              filter={aiFilter}
              page={aiPage}
              onPageChange={setAiPage}
              photoMap={aiPhotoMapRef.current}
              overrides={aiOverrides}
              onOverride={(photoId, val) => setAiOverrides(prev => ({ ...prev, [photoId]: val }))}
              duplicateGroups={aiDuplicateGroups}
            />
          </>
          );
        })()}

        {!aiClassifying && aiResults.length === 0 && (
          <Alert
            type="info"
            message="No uncategorized photos found"
            description="All photos in this job already have categories assigned."
          />
        )}
      </Modal>

      {/* MagicPlan Sync Modal */}
      <Modal
        title={
          <Space>
            <CloudDownloadOutlined style={{ color: '#722ed1' }} />
            <span>Sync from MagicPlan</span>
          </Space>
        }
        open={mpModalVisible}
        onCancel={() => { setMpModalVisible(false); setMpSyncResult(null); }}
        footer={mpSyncResult ? [
          <Button key="close" onClick={() => { setMpModalVisible(false); setMpSyncResult(null); }}>
            Close
          </Button>
        ] : [
          <Button key="cancel" onClick={() => setMpModalVisible(false)}>
            Cancel
          </Button>,
          <Button
            key="sync"
            type="primary"
            loading={mpSyncing}
            disabled={!mpSelectedProject}
            onClick={handleMagicPlanSync}
            style={{ background: '#722ed1', borderColor: '#722ed1' }}
          >
            Sync Photos
          </Button>
        ]}
        width={600}
      >
        {mpSyncResult ? (
          <Alert
            type={mpSyncResult.success ? 'success' : 'error'}
            message={mpSyncResult.success ? 'Sync Complete' : 'Sync Failed'}
            description={
              <div>
                <div>Photos synced: <strong>{mpSyncResult.photos_synced}</strong></div>
                <div>Photos skipped (existing): <strong>{mpSyncResult.photos_skipped}</strong></div>
                {mpSyncResult.errors.length > 0 && (
                  <div style={{ marginTop: 8, color: '#ff4d4f' }}>
                    Errors: {mpSyncResult.errors.slice(0, 3).join(', ')}
                  </div>
                )}
              </div>
            }
          />
        ) : mpSearching ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 12 }}>
              <Text>Searching MagicPlan projects...</Text>
            </div>
          </div>
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {mpAutoMatch && (
              <Alert
                type="success"
                message="Auto-matched project found"
                description={
                  <div>
                    <strong>{mpAutoMatch.project_name}</strong>
                    {mpAutoMatch.address && <div style={{ color: '#666' }}>{mpAutoMatch.address}</div>}
                    <Tag color="green" style={{ marginTop: 4 }}>
                      {Math.round(mpAutoMatch.match_score * 100)}% match
                    </Tag>
                  </div>
                }
                style={{ cursor: 'pointer', border: mpSelectedProject?.project_id === mpAutoMatch.project_id ? '2px solid #52c41a' : undefined }}
                onClick={() => setMpSelectedProject(mpAutoMatch)}
              />
            )}

            {mpCandidates.length > 0 && (
              <div>
                <Text strong style={{ marginBottom: 8, display: 'block' }}>
                  {mpAutoMatch ? 'Other candidates:' : 'Select a MagicPlan project:'}
                </Text>
                <List
                  size="small"
                  dataSource={mpCandidates.filter(c => c.project_id !== mpAutoMatch?.project_id).slice(0, 10)}
                  renderItem={(item) => (
                    <List.Item
                      style={{
                        cursor: 'pointer',
                        background: mpSelectedProject?.project_id === item.project_id ? '#f0f5ff' : undefined,
                        borderLeft: mpSelectedProject?.project_id === item.project_id ? '3px solid #1890ff' : '3px solid transparent',
                        paddingLeft: 12,
                      }}
                      onClick={() => setMpSelectedProject(item)}
                    >
                      <List.Item.Meta
                        title={item.project_name}
                        description={
                          <Space size={4}>
                            {item.address && <Text type="secondary" style={{ fontSize: 12 }}>{item.address}</Text>}
                            <Tag color="blue" style={{ fontSize: 10 }}>
                              {Math.round(item.match_score * 100)}%
                            </Tag>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            )}

            {mpCandidates.length === 0 && !mpAutoMatch && (
              <Alert
                type="warning"
                message="No matching projects found"
                description="No MagicPlan projects match this job's address. Make sure you have projects in MagicPlan."
              />
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
};

export default WaterMitigationPhotosTab;
