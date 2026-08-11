/**
 * CompanyCam Date Select Modal
 *
 * Before syncing photos from CompanyCam, lets the user pick which
 * capture dates to import instead of always pulling the entire project.
 * Only date + count metadata is fetched here (no images), so this stays
 * fast even for projects with hundreds of photos.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Spin, Alert, Checkbox, Space, Button, Tag, Typography, Empty, DatePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import { CloudDownloadOutlined } from '@ant-design/icons';
import api from '../../services/api';

const { Text } = Typography;
const { RangePicker } = DatePicker;

const UNKNOWN_KEY = 'unknown';

export interface CompanyCamDateBucket {
  date: string | null; // null = no capture date found on the photo
  total_count: number;
  new_count: number; // not yet imported into this job
}

interface CompanyCamPhotoDatesResult {
  success: boolean;
  project_id: string;
  dates: CompanyCamDateBucket[];
  total_photos: number;
  total_new: number;
}

const fetchCompanyCamPhotoDates = async (
  jobId: string,
  projectId?: string
): Promise<CompanyCamPhotoDatesResult> => {
  const params = projectId ? `?companycam_project_id=${encodeURIComponent(projectId)}` : '';
  const response = await api.get(`/api/water-mitigation/jobs/${jobId}/companycam-photo-dates${params}`);
  return response.data;
};

interface CompanyCamDateSelectModalProps {
  visible: boolean;
  jobId: string;
  projectId?: string;
  confirmLoading?: boolean;
  onCancel: () => void;
  /** undefined selectedDates means "no filter, sync everything" */
  onConfirm: (selectedDates: string[] | undefined) => void;
}

const CompanyCamDateSelectModal: React.FC<CompanyCamDateSelectModalProps> = ({
  visible,
  jobId,
  projectId,
  confirmLoading,
  onCancel,
  onConfirm,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<CompanyCamDateBucket[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible || !projectId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetchCompanyCamPhotoDates(jobId, projectId)
      .then(result => {
        if (cancelled) return;
        const dateBuckets = result.dates || [];
        setBuckets(dateBuckets);
        // Default to dates that still have unimported photos, so a repeat
        // sync doesn't force the user to re-pick dates they already synced.
        const hasNew = dateBuckets.some(b => b.new_count > 0);
        const defaultSelected = new Set(
          dateBuckets
            .filter(b => (hasNew ? b.new_count > 0 : true))
            .map(b => b.date ?? UNKNOWN_KEY)
        );
        setSelected(defaultSelected);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err?.response?.data?.detail || err.message || 'Failed to load CompanyCam photo dates');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, jobId, projectId]);

  const allKeys = useMemo(() => buckets.map(b => b.date ?? UNKNOWN_KEY), [buckets]);
  const totalPhotos = useMemo(() => buckets.reduce((sum, b) => sum + b.total_count, 0), [buckets]);
  const totalNew = useMemo(() => buckets.reduce((sum, b) => sum + b.new_count, 0), [buckets]);

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(allKeys));
  const selectNone = () => setSelected(new Set());
  const selectNewOnly = () =>
    setSelected(new Set(buckets.filter(b => b.new_count > 0).map(b => b.date ?? UNKNOWN_KEY)));

  const handleRangeChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
    if (!dates || !dates[0] || !dates[1]) return;
    const start = dates[0].format('YYYY-MM-DD');
    const end = dates[1].format('YYYY-MM-DD');
    const inRange = buckets
      .filter(b => b.date && b.date >= start && b.date <= end)
      .map(b => b.date as string);
    setSelected(new Set(inRange));
  };

  const handleOk = () => {
    if (selected.size === 0) return;
    // If every currently-known date is selected, send no filter at all so
    // photos captured after this list loaded (e.g. "today") aren't excluded.
    const allSelected = allKeys.length > 0 && allKeys.every(k => selected.has(k));
    onConfirm(allSelected ? undefined : Array.from(selected));
  };

  return (
    <Modal
      title={
        <Space>
          <CloudDownloadOutlined style={{ color: '#1890ff' }} />
          <span>Select Dates to Import</span>
        </Space>
      }
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      okText="Sync Selected Dates"
      cancelText="Cancel"
      okButtonProps={{ disabled: selected.size === 0 }}
      width={520}
      styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <Spin />
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">Loading photo dates from CompanyCam…</Text>
          </div>
        </div>
      ) : error ? (
        <Alert type="error" message="Failed to load dates" description={error} showIcon />
      ) : buckets.length === 0 ? (
        <Empty description="No photos found in this CompanyCam project" />
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text type="secondary">
            {totalNew} new photo{totalNew === 1 ? '' : 's'} out of {totalPhotos} total, grouped by capture date.
            Loading a thumbnail for every photo is slow — pick just the dates you need.
          </Text>

          <Space wrap>
            <Button size="small" onClick={selectAll}>Select All</Button>
            <Button size="small" onClick={selectNone}>Select None</Button>
            <Button size="small" onClick={selectNewOnly} disabled={totalNew === 0}>New Photos Only</Button>
            <RangePicker size="small" onChange={handleRangeChange} allowClear />
          </Space>

          <div style={{ border: '1px solid #f0f0f0', borderRadius: 6 }}>
            {buckets.map(bucket => {
              const key = bucket.date ?? UNKNOWN_KEY;
              const isSelected = selected.has(key);
              return (
                <div
                  key={key}
                  onClick={() => toggle(key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    cursor: 'pointer',
                    background: isSelected ? '#e6f7ff' : 'transparent',
                  }}
                >
                  <Space>
                    <Checkbox
                      checked={isSelected}
                      onChange={() => toggle(key)}
                      onClick={e => e.stopPropagation()}
                    />
                    <Text>
                      {bucket.date
                        ? new Date(`${bucket.date}T00:00:00`).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            weekday: 'short',
                          })
                        : 'Unknown date'}
                    </Text>
                  </Space>
                  <Space size={4}>
                    {bucket.new_count > 0 ? (
                      <Tag color="green">{bucket.new_count} new</Tag>
                    ) : (
                      <Tag>synced</Tag>
                    )}
                    <Tag>{bucket.total_count} total</Tag>
                  </Space>
                </div>
              );
            })}
          </div>
        </Space>
      )}
    </Modal>
  );
};

export default CompanyCamDateSelectModal;
