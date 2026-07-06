/**
 * Water Mitigation Trash Tab
 * Shows trashed photos with restore/delete permanently options
 * Photos are automatically deleted after 30 days in trash
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Empty,
  Spin,
  Button,
  Space,
  Image,
  Checkbox,
  Modal,
  message,
  Typography,
  Tag,
  Tooltip,
  Row,
  Col,
  Alert
} from 'antd';
import {
  DeleteOutlined,
  UndoOutlined,
  ExclamationCircleOutlined,
  CheckSquareOutlined,
  BorderOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import waterMitigationService from '../../services/waterMitigationService';
import api from '../../services/api';
import dayjs from 'dayjs';

const { Text, Title } = Typography;

const TRASH_RETENTION_DAYS = 30;

interface WaterMitigationTrashTabProps {
  jobId: string;
  isActive?: boolean;
}

interface TrashedPhoto {
  id: string;
  file_name: string;
  file_path: string;
  thumbnail_url?: string;
  storage_thumbnail_url?: string;
  storage_web_url?: string;
  trashed_at: string;
  trash_reason: string;
  category?: string;
  captured_date?: string;
}

/** Calculate remaining days before auto-deletion */
const getDaysRemaining = (trashedAt: string): number => {
  const trashedDate = dayjs(trashedAt);
  const expiryDate = trashedDate.add(TRASH_RETENTION_DAYS, 'day');
  const remaining = expiryDate.diff(dayjs(), 'day');
  return Math.max(0, remaining);
};

/** Get color for remaining days badge */
const getDaysRemainingColor = (days: number): string => {
  if (days <= 3) return '#ff4d4f';
  if (days <= 7) return '#fa8c16';
  return '#8c8c8c';
};

const WaterMitigationTrashTab: React.FC<WaterMitigationTrashTabProps> = ({ jobId, isActive }) => {
  const queryClient = useQueryClient();
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());

  // Fetch trashed photos
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['trashed-photos', jobId],
    queryFn: () => waterMitigationService.photos.getTrashed(jobId),
    staleTime: 30 * 1000,
  });

  // Background refresh when tab becomes active
  const prevActiveRef = React.useRef(isActive);
  React.useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      refetch();
    }
    prevActiveRef.current = isActive;
  }, [isActive, refetch]);

  const trashedPhotos: TrashedPhoto[] = data?.items || [];

  // Restore mutation
  const restoreMutation = useMutation({
    mutationFn: async (photoIds: string[]) => {
      await waterMitigationService.photos.bulkRestore(photoIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trashed-photos', jobId] });
      queryClient.invalidateQueries({ queryKey: ['files', 'water-mitigation', jobId, 'image'] });
      queryClient.invalidateQueries({ queryKey: ['files-infinite', 'water-mitigation', jobId, 'image'] });
      // Also invalidate water-mitigation-photos query used by Report tab
      queryClient.invalidateQueries({ queryKey: ['water-mitigation-photos', jobId] });
      setSelectedPhotos(new Set());
      message.success('Photos restored successfully');
    },
    onError: (error: any) => {
      message.error(`Failed to restore photos: ${error.message || 'Unknown error'}`);
    }
  });

  // Permanent delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (photoIds: string[]) => {
      await waterMitigationService.photos.bulkDelete(photoIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trashed-photos', jobId] });
      // Also invalidate water-mitigation-photos query used by Report tab
      queryClient.invalidateQueries({ queryKey: ['water-mitigation-photos', jobId] });
      setSelectedPhotos(new Set());
      message.success('Photos permanently deleted');
    },
    onError: (error: any) => {
      message.error(`Failed to delete photos: ${error.message || 'Unknown error'}`);
    }
  });

  // Toggle photo selection
  const toggleSelection = (photoId: string) => {
    const newSelected = new Set(selectedPhotos);
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    setSelectedPhotos(newSelected);
  };

  // Select/Deselect all
  const toggleSelectAll = () => {
    if (selectedPhotos.size === trashedPhotos.length) {
      setSelectedPhotos(new Set());
    } else {
      setSelectedPhotos(new Set(trashedPhotos.map(p => p.id)));
    }
  };

  // Restore selected photos
  const handleRestore = () => {
    if (selectedPhotos.size === 0) {
      message.warning('No photos selected');
      return;
    }

    Modal.confirm({
      title: 'Restore Photos',
      icon: <UndoOutlined style={{ color: '#52c41a' }} />,
      content: `Are you sure you want to restore ${selectedPhotos.size} photo(s)?`,
      okText: 'Restore',
      okType: 'primary',
      cancelText: 'Cancel',
      onOk: () => {
        restoreMutation.mutate(Array.from(selectedPhotos));
      }
    });
  };

  // Permanently delete selected photos
  const handlePermanentDelete = () => {
    if (selectedPhotos.size === 0) {
      message.warning('No photos selected');
      return;
    }

    Modal.confirm({
      title: 'Permanently Delete Photos',
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div>
          <p>Are you sure you want to permanently delete {selectedPhotos.size} photo(s)?</p>
          <p style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
            This action cannot be undone!
          </p>
        </div>
      ),
      okText: 'Delete Permanently',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: () => {
        deleteMutation.mutate(Array.from(selectedPhotos));
      }
    });
  };

  // Get trash reason display text
  const getTrashReasonText = (reason: string) => {
    switch (reason) {
      case 'companycam_deleted':
        return 'Deleted in CompanyCam';
      case 'manual':
        return 'Manual deletion';
      case 'bulk_deletion':
        return 'Bulk deletion';
      default:
        return reason;
    }
  };

  // Get trash reason tag color
  const getTrashReasonColor = (reason: string) => {
    switch (reason) {
      case 'companycam_deleted':
        return 'orange';
      case 'manual':
        return 'blue';
      case 'bulk_deletion':
        return 'purple';
      default:
        return 'default';
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <Text type="danger">Failed to load trashed photos</Text>
      </div>
    );
  }

  // Count photos expiring within 7 days
  const expiringSoonCount = trashedPhotos.filter(
    p => getDaysRemaining(p.trashed_at) <= 7
  ).length;

  return (
    <div style={{ padding: '16px' }}>
      {/* Auto-delete policy banner */}
      {trashedPhotos.length > 0 && (
        <Alert
          message="Auto-delete Policy"
          description={
            expiringSoonCount > 0
              ? `Photos in trash are automatically and permanently deleted after ${TRASH_RETENTION_DAYS} days. ${expiringSoonCount} photo(s) will be deleted within 7 days.`
              : `Photos in trash are automatically and permanently deleted after ${TRASH_RETENTION_DAYS} days.`
          }
          type={expiringSoonCount > 0 ? 'warning' : 'info'}
          showIcon
          icon={<ClockCircleOutlined />}
          style={{ marginBottom: '16px' }}
          closable
        />
      )}

      {/* Header with actions */}
      <Card size="small" className="compact-card-sm" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <DeleteOutlined style={{ color: '#ff4d4f' }} />
            <Title level={5} style={{ margin: 0 }}>
              Trash ({trashedPhotos.length} photos)
            </Title>
          </Space>

          {trashedPhotos.length > 0 && (
            <Space>
              <Button
                icon={selectedPhotos.size === trashedPhotos.length ? <CheckSquareOutlined /> : <BorderOutlined />}
                onClick={toggleSelectAll}
              >
                {selectedPhotos.size === trashedPhotos.length ? 'Deselect All' : 'Select All'}
              </Button>

              {selectedPhotos.size > 0 && (
                <>
                  <Button
                    type="primary"
                    icon={<UndoOutlined />}
                    onClick={handleRestore}
                    loading={restoreMutation.isPending}
                  >
                    Restore ({selectedPhotos.size})
                  </Button>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={handlePermanentDelete}
                    loading={deleteMutation.isPending}
                  >
                    Delete Permanently ({selectedPhotos.size})
                  </Button>
                </>
              )}
            </Space>
          )}
        </div>
      </Card>

      {/* Empty state */}
      {trashedPhotos.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No photos in trash"
          style={{ marginTop: '48px' }}
        />
      ) : (
        /* Photo grid */
        <Row gutter={[16, 16]}>
          {trashedPhotos.map((photo) => {
            const daysRemaining = getDaysRemaining(photo.trashed_at);
            return (
              <Col key={photo.id} xs={12} sm={8} md={6} lg={4} xl={3}>
                <Card
                  hoverable
                  size="small"
                  className="compact-card-sm"
                  style={{
                    border: selectedPhotos.has(photo.id) ? '2px solid #1890ff' : undefined,
                    opacity: 0.85
                  }}
                  cover={
                    <div
                      style={{
                        position: 'relative',
                        paddingTop: '100%',
                        backgroundColor: '#f0f0f0',
                        cursor: 'pointer'
                      }}
                      onClick={() => toggleSelection(photo.id)}
                    >
                      <Image
                        src={photo.storage_thumbnail_url || photo.storage_web_url || photo.thumbnail_url || `${api.defaults.baseURL || ''}/api/water-mitigation/photos/${photo.id}/preview?size=thumbnail`}
                        alt={photo.file_name}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          filter: 'grayscale(50%)'
                        }}
                        preview={false}
                        fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMIAAADDCAYAAADQvc6UAAABRWlDQ1..."
                      />

                      {/* Selection checkbox */}
                      <div style={{ position: 'absolute', top: 8, left: 8 }}>
                        <Checkbox
                          checked={selectedPhotos.has(photo.id)}
                          onChange={() => toggleSelection(photo.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>

                      {/* Days remaining badge */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          backgroundColor: getDaysRemainingColor(daysRemaining),
                          borderRadius: '10px',
                          padding: '2px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        <ClockCircleOutlined style={{ color: 'white', fontSize: '10px' }} />
                        <Text style={{ color: 'white', fontSize: '10px', fontWeight: 'bold' }}>
                          {daysRemaining}d
                        </Text>
                      </div>
                    </div>
                  }
                >
                  <Card.Meta
                    title={
                      <Tooltip title={photo.file_name}>
                        <Text ellipsis style={{ fontSize: '12px' }}>
                          {photo.file_name}
                        </Text>
                      </Tooltip>
                    }
                    description={
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Tag color={getTrashReasonColor(photo.trash_reason)} style={{ fontSize: '10px' }}>
                          {getTrashReasonText(photo.trash_reason)}
                        </Tag>
                        <Tooltip title={`Auto-delete in ${daysRemaining} day(s)`}>
                          <Text type="secondary" style={{ fontSize: '10px' }}>
                            {dayjs(photo.trashed_at).format('MM/DD/YY HH:mm')}
                          </Text>
                        </Tooltip>
                      </Space>
                    }
                  />
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </div>
  );
};

export default WaterMitigationTrashTab;
