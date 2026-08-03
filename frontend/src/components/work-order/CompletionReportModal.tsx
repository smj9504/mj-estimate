import React, { useState, useMemo } from 'react';
import {
  Modal, Button, Input, DatePicker, Checkbox, Space, Typography,
  Spin, message, Empty, Image, Tag, Row, Col, Tabs,
} from 'antd';
import { FilePdfOutlined, CheckOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { fileService, type FileItem } from '../../services/fileService';
import workOrderService from '../../services/workOrderService';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface CompletionReportModalProps {
  visible: boolean;
  workOrderId: string;
  claimId?: string;
  onClose: () => void;
  onGenerated: () => void;
}

const PHOTO_CATEGORIES = ['all', 'before', 'during', 'after', 'completion', 'damage', 'general'];

const CompletionReportModal: React.FC<CompletionReportModalProps> = ({
  visible,
  workOrderId,
  claimId,
  onClose,
  onGenerated,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('Completion Photo Report');
  const [description, setDescription] = useState('');
  const [reportDate, setReportDate] = useState<dayjs.Dayjs | null>(dayjs());
  const [compress, setCompress] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['claim-photos', claimId],
    queryFn: () => fileService.getFiles('claim', claimId!, undefined, 'image'),
    enabled: visible && !!claimId,
  });

  const filteredPhotos = useMemo(() => {
    if (activeCategory === 'all') return photos;
    return photos.filter((p: FileItem) => p.category === activeCategory);
  }, [photos, activeCategory]);

  const togglePhoto = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredPhotos.map((p: FileItem) => p.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleGenerate = async () => {
    if (selectedIds.size === 0) {
      message.warning('Please select at least one photo');
      return;
    }

    setGenerating(true);
    try {
      const blob = await workOrderService.generateCompletionReport(workOrderId, {
        photo_ids: Array.from(selectedIds),
        title: title || 'Completion Photo Report',
        description: description || undefined,
        report_date: reportDate ? reportDate.format('YYYY-MM-DD') : undefined,
        compress,
      });

      // Download the PDF
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Completion Photo Report.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      message.success('Completion report generated successfully');
      onGenerated();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const getPhotoUrl = (photo: FileItem) => {
    return photo.thumbnailUrl || `/api/files/download/${photo.id}?inline=true`;
  };

  return (
    <Modal
      title={
        <Space>
          <FilePdfOutlined />
          <span>Generate Completion Photo Report</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      width={900}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button
          key="generate"
          type="primary"
          icon={<FilePdfOutlined />}
          loading={generating}
          disabled={selectedIds.size === 0}
          onClick={handleGenerate}
        >
          Generate Report ({selectedIds.size} photos)
        </Button>,
      ]}
      destroyOnClose
    >
      {!claimId ? (
        <Empty description="This work order has no linked claim. Link a claim first to upload and select photos." />
      ) : (
        <div>
          {/* Report Settings */}
          <div style={{ marginBottom: 20 }}>
            <Title level={5} style={{ marginBottom: 12 }}>Report Settings</Title>
            <Row gutter={[16, 12]}>
              <Col xs={24} md={12}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Title</Text>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Completion Photo Report"
                />
              </Col>
              <Col xs={24} md={12}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Report Date</Text>
                <DatePicker
                  value={reportDate}
                  onChange={setReportDate}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col xs={24}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Description (optional)</Text>
                <TextArea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Brief description for the cover page..."
                  rows={2}
                />
              </Col>
              <Col xs={24}>
                <Checkbox checked={compress} onChange={e => setCompress(e.target.checked)}>
                  Compress images (smaller file size)
                </Checkbox>
              </Col>
            </Row>
          </div>

          {/* Photo Selection */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Title level={5} style={{ margin: 0 }}>
                Select Photos
                {photos.length > 0 && (
                  <Text type="secondary" style={{ fontSize: 13, fontWeight: 'normal', marginLeft: 8 }}>
                    {selectedIds.size} / {photos.length} selected
                  </Text>
                )}
              </Title>
              <Space>
                <Button size="small" onClick={selectAll}>Select All</Button>
                <Button size="small" onClick={deselectAll}>Deselect All</Button>
              </Space>
            </div>

            {/* Category filter */}
            <Tabs
              size="small"
              activeKey={activeCategory}
              onChange={setActiveCategory}
              items={PHOTO_CATEGORIES.map(cat => ({
                key: cat,
                label: cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1),
              }))}
              style={{ marginBottom: 12 }}
            />

            {isLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin />
              </div>
            ) : filteredPhotos.length === 0 ? (
              <Empty
                description={
                  photos.length === 0
                    ? "No photos uploaded to this claim yet. Upload photos in the Client > Claim section first."
                    : "No photos in this category."
                }
              />
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 8,
                  maxHeight: 350,
                  overflowY: 'auto',
                  padding: 4,
                }}
              >
                {filteredPhotos.map((photo: FileItem) => {
                  const isSelected = selectedIds.has(photo.id);
                  return (
                    <div
                      key={photo.id}
                      onClick={() => togglePhoto(photo.id)}
                      style={{
                        position: 'relative',
                        cursor: 'pointer',
                        borderRadius: 6,
                        border: `2px solid ${isSelected ? '#1890ff' : '#e8e8e8'}`,
                        overflow: 'hidden',
                        transition: 'border-color 0.2s',
                      }}
                    >
                      <img
                        src={getPhotoUrl(photo)}
                        alt={photo.originalName || photo.filename}
                        style={{
                          width: '100%',
                          height: 100,
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                      {isSelected && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            background: '#1890ff',
                            borderRadius: '50%',
                            width: 22,
                            height: 22,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <CheckOutlined style={{ color: '#fff', fontSize: 12 }} />
                        </div>
                      )}
                      {photo.category && (
                        <Tag
                          style={{
                            position: 'absolute',
                            bottom: 2,
                            left: 2,
                            fontSize: 10,
                            margin: 0,
                            padding: '0 4px',
                            lineHeight: '16px',
                          }}
                        >
                          {photo.category}
                        </Tag>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};

export default CompletionReportModal;
