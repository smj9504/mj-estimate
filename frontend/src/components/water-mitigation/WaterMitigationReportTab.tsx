/**
 * Water Mitigation Report Tab
 * Main tab for creating and managing photo reports
 * Features sidebar navigation and modal-based photo selection with category filtering
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Button,
  Space,
  message,
  Spin,
  Typography,
  Input,
  Row,
  Col,
  Select,
  Form,
  Image,
  Empty,
  Checkbox,
  Tag,
  Tooltip,
  Divider,
  Menu,
  Modal
} from 'antd';
import {
  PlusOutlined,
  SaveOutlined,
  FileTextOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileImageOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import waterMitigationService from '../../services/waterMitigationService';
import { useWaterMitigationPhotos } from '../../hooks/useWaterMitigationPhotos';
import PhotoSelectorModal from './PhotoSelectorModal';
import type {
  ReportConfig,
  ReportSection,
  PhotoMetadata
} from '../../types/waterMitigation';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface WaterMitigationReportTabProps {
  jobId: string;
  jobAddress: string;
}

interface Photo {
  id: string;
  file_path: string;
  caption?: string;
  category?: string;
  taken_date?: string;
  description?: string;
  thumbnail_path?: string;
}

const WaterMitigationReportTab: React.FC<WaterMitigationReportTabProps> = ({
  jobId,
  jobAddress
}) => {
  // Use React Query for automatic caching - config query
  const {
    data: config,
    isLoading: loadingConfig,
    refetch: refetchConfig
  } = useQuery({
    queryKey: ['wm-report-config', jobId],
    queryFn: () => waterMitigationService.report.getConfig(jobId),
    retry: 1,
    enabled: !!jobId
  });

  // Use React Query for photos (shared cache with other components)
  const { data: availablePhotos = [], isLoading: loadingPhotos } = useWaterMitigationPhotos(jobId);

  const loading = loadingConfig || loadingPhotos;

  const [saving, setSaving] = useState(false);
  const [coverTitle, setCoverTitle] = useState('Water Mitigation Report');
  const [coverDescription, setCoverDescription] = useState('');
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>('cover');
  const [editingSectionTitle, setEditingSectionTitle] = useState(false);
  const [tempSectionTitle, setTempSectionTitle] = useState('');
  const [photoSelectorVisible, setPhotoSelectorVisible] = useState(false);
  const [pdfPreviewVisible, setPdfPreviewVisible] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  // Initialize form data when config loads
  useEffect(() => {
    if (config) {
      setCoverTitle(config.cover_title || 'Water Mitigation Report');
      setCoverDescription(config.cover_description || '');
      setSections(config.sections || []);
    } else {
      // Initialize default config if no config found
      initializeDefaultConfig();
    }
  }, [config, jobAddress]);

  const initializeDefaultConfig = () => {
    setCoverTitle('Water Mitigation Report');
    setCoverDescription(`Property: ${jobAddress || 'N/A'}\n\nThis report documents the water mitigation work performed at the above property.`);
    setSections([]);
  };

  const handleSaveConfig = async () => {
    try {
      setSaving(true);

      if (config?.id) {
        const updateData = {
          cover_title: coverTitle,
          cover_description: coverDescription,
          sections: sections.map((section, index) => ({
            ...section,
            display_order: index
          }))
        };
        await waterMitigationService.report.updateConfig(jobId, updateData);
        message.success('Report configuration updated');
      } else {
        const createData = {
          job_id: jobId,
          cover_title: coverTitle,
          cover_description: coverDescription,
          sections: sections.map((section, index) => ({
            ...section,
            display_order: index
          }))
        };
        await waterMitigationService.report.saveConfig(jobId, createData);
        message.success('Report configuration saved');
      }

      await refetchConfig();
    } catch (error) {
      console.error('Failed to save report config:', error);
      message.error('Failed to save report configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePDF = async () => {
    try {
      message.loading('Generating PDF report...', 0);

      const requestData = config?.id
        ? { config_id: config.id }
        : {
            save_config: true,
            config: {
              job_id: jobId,
              cover_title: coverTitle,
              cover_description: coverDescription,
              sections: sections.map((section, index) => ({
                ...section,
                display_order: index
              }))
            }
          };

      const blob = await waterMitigationService.report.generateReport(jobId, requestData);

      // Create blob URL for preview
      const url = window.URL.createObjectURL(blob);
      setPdfBlobUrl(url);
      setPdfPreviewVisible(true);

      message.destroy();
      message.success('PDF report generated successfully');
    } catch (error) {
      message.destroy();
      console.error('Failed to generate PDF:', error);
      message.error('Failed to generate PDF report');
    }
  };

  const handleAddSection = () => {
    const newSection: ReportSection = {
      id: Date.now().toString(),
      title: `Section ${sections.length + 1}`,
      summary: '',
      photos: [],
      layout: 'four',
      display_order: sections.length
    };
    setSections([...sections, newSection]);
    setSelectedSectionId(newSection.id);
  };

  const handleDeleteSection = (sectionId: string) => {
    setSections(sections.filter(s => s.id !== sectionId));
    if (selectedSectionId === sectionId) {
      setSelectedSectionId('cover');
    }
    message.success('Section deleted');
  };

  const handleUpdateSection = (sectionId: string, updates: Partial<ReportSection>) => {
    setSections(sections.map(s =>
      s.id === sectionId ? { ...s, ...updates } : s
    ));
  };

  const handleOpenPhotoSelector = () => {
    setPhotoSelectorVisible(true);
  };

  const handlePhotoSelectorOk = (selectedPhotos: PhotoMetadata[]) => {
    const currentSection = sections.find(s => s.id === selectedSectionId);
    if (!currentSection) return;

    handleUpdateSection(currentSection.id, { photos: selectedPhotos });
    setPhotoSelectorVisible(false);
    message.success(`${selectedPhotos.length} photos selected`);
  };

  const handlePhotoSelectorCancel = () => {
    setPhotoSelectorVisible(false);
  };

  const handleRemovePhoto = (photoId: string) => {
    const currentSection = sections.find(s => s.id === selectedSectionId);
    if (!currentSection) return;

    const updatedPhotos = currentSection.photos.filter(p => p.photo_id !== photoId);
    handleUpdateSection(currentSection.id, { photos: updatedPhotos });
    message.success('Photo removed from section');
  };

  const handleDownloadPdf = () => {
    if (!pdfBlobUrl) return;

    const link = document.createElement('a');
    link.href = pdfBlobUrl;
    link.download = `water-mitigation-report-${jobId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    message.success('PDF downloaded successfully');
  };

  const handleClosePdfPreview = () => {
    if (pdfBlobUrl) {
      window.URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }
    setPdfPreviewVisible(false);
  };

  // Create a Map for O(1) photo lookup (fixes N+1 pattern)
  const photoMap = useMemo(() => {
    const map = new Map<string, Photo>();
    availablePhotos.forEach(photo => map.set(photo.id, photo));
    return map;
  }, [availablePhotos]);

  const getCurrentSection = () => {
    return sections.find(s => s.id === selectedSectionId);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    );
  }

  const currentSection = getCurrentSection();

  return (
    <div style={{ height: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid #f0f0f0',
        background: '#fff'
      }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={3} style={{ margin: 0 }}>
              <FileTextOutlined /> Photo Report Builder
            </Title>
          </Col>
          <Col>
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSaveConfig}
                loading={saving}
              >
                Save Configuration
              </Button>
              <Button
                type="default"
                icon={<FileImageOutlined />}
                onClick={handleGeneratePDF}
                disabled={!config?.id && sections.length === 0}
              >
                Preview & Download PDF
              </Button>
            </Space>
          </Col>
        </Row>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left Sidebar - Section Navigation */}
        <div style={{
          width: 250,
          borderRight: '1px solid #f0f0f0',
          background: '#fafafa',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ padding: 16, borderBottom: '1px solid #f0f0f0' }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddSection}
              block
            >
              New Section
            </Button>
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            <Menu
              mode="inline"
              selectedKeys={[selectedSectionId || 'cover']}
              style={{ border: 'none', background: 'transparent' }}
            >
              <Menu.Item
                key="cover"
                icon={<FileTextOutlined />}
                onClick={() => setSelectedSectionId('cover')}
              >
                Cover Page
              </Menu.Item>

              {sections.map((section, index) => (
                <Menu.Item
                  key={section.id}
                  icon={<FileImageOutlined />}
                  onClick={() => setSelectedSectionId(section.id)}
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{section.title}</span>
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      {section.photos.length}
                    </Tag>
                  </div>
                </Menu.Item>
              ))}
            </Menu>
          </div>
        </div>

        {/* Right Content Area */}
        <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
          {selectedSectionId === 'cover' ? (
            // Cover Page Editor
            <div style={{ padding: 24, maxWidth: 800 }}>
              <Title level={4}>Cover Page</Title>
              <Form layout="vertical">
                <Form.Item label="Report Title">
                  <Input
                    value={coverTitle}
                    onChange={e => setCoverTitle(e.target.value)}
                    placeholder="Water Mitigation Report"
                    size="large"
                  />
                </Form.Item>
                <Form.Item label="Description">
                  <TextArea
                    value={coverDescription}
                    onChange={e => setCoverDescription(e.target.value)}
                    placeholder="Property information, client details, report description..."
                    rows={6}
                  />
                </Form.Item>
              </Form>
            </div>
          ) : currentSection ? (
            // Section Editor
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              {/* Section Header */}
              <div style={{ padding: 24, borderBottom: '1px solid #f0f0f0' }}>
                <Row justify="space-between" align="middle">
                  <Col flex="auto">
                    {editingSectionTitle ? (
                      <Input
                        value={tempSectionTitle}
                        onChange={e => setTempSectionTitle(e.target.value)}
                        onPressEnter={() => {
                          handleUpdateSection(currentSection.id, { title: tempSectionTitle });
                          setEditingSectionTitle(false);
                        }}
                        onBlur={() => {
                          handleUpdateSection(currentSection.id, { title: tempSectionTitle });
                          setEditingSectionTitle(false);
                        }}
                        autoFocus
                        style={{ fontSize: 20, fontWeight: 600 }}
                      />
                    ) : (
                      <Title
                        level={4}
                        style={{ margin: 0, cursor: 'pointer' }}
                        onClick={() => {
                          setTempSectionTitle(currentSection.title);
                          setEditingSectionTitle(true);
                        }}
                      >
                        {currentSection.title}
                        <EditOutlined style={{ marginLeft: 8, fontSize: 16, color: '#999' }} />
                      </Title>
                    )}
                    <Text type="secondary">{currentSection.photos.length} Photos</Text>
                  </Col>
                  <Col>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteSection(currentSection.id)}
                    >
                      Delete Section
                    </Button>
                  </Col>
                </Row>

                <Form layout="vertical" style={{ marginTop: 16 }}>
                  <Form.Item label="Section Summary">
                    <TextArea
                      value={currentSection.summary}
                      onChange={e => handleUpdateSection(currentSection.id, { summary: e.target.value })}
                      placeholder="Brief description of this section..."
                      rows={2}
                    />
                  </Form.Item>
                  <Form.Item label="Photo Layout">
                    <Select
                      value={currentSection.layout}
                      onChange={value => handleUpdateSection(currentSection.id, { layout: value })}
                      style={{ width: 200 }}
                    >
                      <Select.Option value="single">1 photo per page</Select.Option>
                      <Select.Option value="two">2 photos per page</Select.Option>
                      <Select.Option value="three">3 photos per page</Select.Option>
                      <Select.Option value="four">4 photos per page</Select.Option>
                      <Select.Option value="six">6 photos per page</Select.Option>
                    </Select>
                  </Form.Item>
                </Form>
              </div>

              {/* Selected Photos Display */}
              <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
                <div style={{ marginBottom: 16 }}>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={handleOpenPhotoSelector}
                  >
                    Add Photos
                  </Button>
                </div>

                {currentSection.photos.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No photos added to this section yet"
                  >
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={handleOpenPhotoSelector}
                    >
                      Add Photos
                    </Button>
                  </Empty>
                ) : (
                  <Row gutter={[16, 16]}>
                    {currentSection.photos.map(photoMeta => {
                      // Use Map for O(1) lookup instead of array.find (O(n))
                      const photo = photoMap.get(photoMeta.photo_id);
                      if (!photo) return null;
                      return (
                        <Col key={photoMeta.photo_id} xs={12} sm={8} md={6} lg={4}>
                          <Card
                            hoverable
                            bodyStyle={{ padding: 8 }}
                            cover={
                              <div style={{ position: 'relative', height: 150, overflow: 'hidden' }}>
                                <Image
                                  src={`/api/water-mitigation/photos/${photo.id}/preview`}
                                  alt={photo.caption || 'Photo'}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  preview={{
                                    src: `/api/water-mitigation/photos/${photo.id}/preview`
                                  }}
                                />
                                <Tooltip title="Remove from section">
                                  <Button
                                    type="primary"
                                    danger
                                    shape="circle"
                                    size="small"
                                    icon={<CloseCircleOutlined />}
                                    onClick={() => handleRemovePhoto(photoMeta.photo_id)}
                                    style={{
                                      position: 'absolute',
                                      top: 8,
                                      right: 8
                                    }}
                                  />
                                </Tooltip>
                              </div>
                            }
                          >
                            <div style={{ fontSize: 12 }}>
                              {photo.caption && (
                                <div style={{
                                  fontWeight: 500,
                                  marginBottom: 4,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {photo.caption}
                                </div>
                              )}
                              {photo.category && (
                                <Tag color="blue" style={{ fontSize: 10, marginBottom: 4 }}>
                                  {photo.category}
                                </Tag>
                              )}
                              {photo.taken_date && (
                                <div style={{ color: '#999', fontSize: 10 }}>
                                  {new Date(photo.taken_date).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </Card>
                        </Col>
                      );
                    })}
                  </Row>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Photo Selector Modal */}
      {photoSelectorVisible && (
        <PhotoSelectorModal
          visible={photoSelectorVisible}
          jobId={jobId}
          selectedPhotos={currentSection?.photos || []}
          onOk={handlePhotoSelectorOk}
          onCancel={handlePhotoSelectorCancel}
        />
      )}

      {/* PDF Preview Modal */}
      <Modal
        title="PDF Preview"
        open={pdfPreviewVisible}
        onCancel={handleClosePdfPreview}
        width="90vw"
        style={{ top: 20 }}
        footer={[
          <Button key="close" onClick={handleClosePdfPreview}>
            Close
          </Button>,
          <Button
            key="download"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleDownloadPdf}
          >
            Download PDF
          </Button>
        ]}
        bodyStyle={{ height: 'calc(90vh - 110px)', padding: 0 }}
      >
        {pdfBlobUrl && (
          <iframe
            src={pdfBlobUrl}
            style={{
              width: '100%',
              height: '100%',
              border: 'none'
            }}
            title="PDF Preview"
          />
        )}
      </Modal>
    </div>
  );
};

export default WaterMitigationReportTab;
