/**
 * Water Mitigation Documents Tab
 * Manages document creation from uploaded photos with PDF generation
 */

import React, { useState, useRef } from 'react';
import { Button, Modal, Select, Space, message, Spin, Typography, Card, Tooltip } from 'antd';
import { FilePdfOutlined, PlusOutlined, RotateRightOutlined, CloseOutlined } from '@ant-design/icons';
import FileGallery from '../common/FileGallery/FileGallery';
import WMDocumentList from './WMDocumentList';
import waterMitigationService from '../../services/waterMitigationService';
import { useWaterMitigationPhotos } from '../../hooks/useWaterMitigationPhotos';

const { Title, Text } = Typography;

interface WaterMitigationDocumentsTabProps {
  jobId: string;
  jobAddress: string;
  dateOfLoss?: string;  // Date of loss from job data (required for EWA)
}

interface DocumentType {
  value: string;
  label: string;
  description: string;
}

const DOCUMENT_TYPES: DocumentType[] = [
  {
    value: 'COS',
    label: 'Certificate of Satisfaction',
    description: 'Certificate confirming completion and customer satisfaction'
  },
  {
    value: 'EWA',
    label: 'Emergency Work Agreement & Authorization',
    description: 'Authorization for emergency mitigation work'
  }
];

const WaterMitigationDocumentsTab: React.FC<WaterMitigationDocumentsTabProps> = ({
  jobId,
  jobAddress,
  dateOfLoss
}) => {
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<string | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [photoRotations, setPhotoRotations] = useState<Record<string, number>>({});  // {photoId: degrees}
  const [creatingPdf, setCreatingPdf] = useState(false);
  const documentListRef = useRef<any>(null);

  // Load photos for displaying selected photos with rotation controls
  const { data: allPhotos = [] } = useWaterMitigationPhotos(jobId, {
    enabled: createModalVisible,
    pageSize: 200
  });

  const handleCreateDocument = () => {
    setCreateModalVisible(true);
    setSelectedDocType(null);
    setSelectedPhotoIds([]);
    setPhotoRotations({});
  };

  // Rotate a photo by 90 degrees clockwise
  const handleRotatePhoto = (photoId: string) => {
    setPhotoRotations(prev => {
      const currentRotation = prev[photoId] || 0;
      const newRotation = (currentRotation + 90) % 360;
      return { ...prev, [photoId]: newRotation };
    });
  };

  // Remove a photo from selection
  const handleRemovePhoto = (photoId: string) => {
    setSelectedPhotoIds(prev => prev.filter(id => id !== photoId));
    setPhotoRotations(prev => {
      const { [photoId]: _, ...rest } = prev;
      return rest;
    });
  };

  // Get thumbnail URL for a photo
  const getPhotoThumbnail = (photoId: string) => {
    const photo = allPhotos.find((p: any) => p.id === photoId) as any;
    // Try both naming conventions (snake_case from API, camelCase from hook mapping)
    const thumbUrl = photo?.thumbnail_url || photo?.thumbnailUrl;
    if (thumbUrl) {
      return thumbUrl;
    }
    return `/api/water-mitigation/photos/${photoId}/preview?size=thumbnail`;
  };

  const handlePhotoSelection = (fileIds: string[]) => {
    console.log('Document tab - photos selected:', fileIds);

    // For EWA, limit to 1 photo
    if (selectedDocType === 'EWA' && fileIds.length > 1) {
      message.warning('EWA document requires exactly 1 photo. Only the first selected photo will be used.');
      setSelectedPhotoIds([fileIds[0]]);
      return;
    }

    setSelectedPhotoIds(fileIds);
  };

  const handleGeneratePdf = async () => {
    if (!selectedDocType) {
      message.error('Please select a document type');
      return;
    }

    if (selectedPhotoIds.length === 0) {
      message.error('Please select at least one photo');
      return;
    }

    // EWA-specific validations
    if (selectedDocType === 'EWA') {
      if (selectedPhotoIds.length !== 1) {
        message.error('EWA document requires exactly 1 photo');
        return;
      }

      if (!dateOfLoss) {
        message.error('Date of Loss is required for EWA document. Please update the job information.');
        return;
      }
    }

    try {
      setCreatingPdf(true);

      // Build rotations object (only include non-zero rotations)
      const rotations = Object.entries(photoRotations).reduce((acc, [id, deg]) => {
        if (deg !== 0) acc[id] = deg;
        return acc;
      }, {} as Record<string, number>);

      // Generate PDF from selected photos with rotations
      const result = await waterMitigationService.documents.generatePdf(
        jobId,
        selectedPhotoIds,
        selectedDocType,
        jobAddress,
        dateOfLoss,  // Pass date of loss for EWA documents
        Object.keys(rotations).length > 0 ? rotations : undefined
      );

      message.success(`PDF generated successfully: ${result.filename}`);
      setCreateModalVisible(false);
      setSelectedPhotoIds([]);
      setSelectedDocType(null);
      setPhotoRotations({});

      // Refresh document list to show newly created document
      documentListRef.current?.refresh();
    } catch (error: any) {
      console.error('Failed to generate PDF:', error);
      const errorMessage = error?.response?.data?.detail || 'Failed to generate PDF';
      message.error(errorMessage);
    } finally {
      setCreatingPdf(false);
    }
  };

  const getSelectedDocumentType = () => {
    return DOCUMENT_TYPES.find(dt => dt.value === selectedDocType);
  };

  return (
    <div className="wm-documents-tab" style={{ height: 'calc(100vh - 180px)', padding: '16px' }}>
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleCreateDocument}
        >
          Create Document
        </Button>
      </div>

      {/* Document List */}
      <div style={{ height: 'calc(100% - 60px)', overflow: 'auto' }}>
        <WMDocumentList
          ref={documentListRef}
          jobId={jobId}
          onDelete={() => {
            // Refresh list after delete
          }}
        />
      </div>

      <Modal
        title="Create Document"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          setSelectedPhotoIds([]);
          setSelectedDocType(null);
        }}
        width={1000}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setCreateModalVisible(false);
              setSelectedPhotoIds([]);
              setSelectedDocType(null);
            }}
          >
            Cancel
          </Button>,
          <Button
            key="generate"
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={handleGeneratePdf}
            disabled={!selectedDocType || selectedPhotoIds.length === 0}
            loading={creatingPdf}
          >
            Generate PDF ({selectedPhotoIds.length} photo{selectedPhotoIds.length !== 1 ? 's' : ''})
          </Button>
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* Document Type Selection */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Document Type</Text>
            <Select
              style={{ width: '100%' }}
              placeholder="Select document type"
              value={selectedDocType}
              onChange={setSelectedDocType}
              options={DOCUMENT_TYPES.map(dt => ({
                value: dt.value,
                label: dt.label
              }))}
            />
          </div>

          {/* Photo Selection */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Select Photos</Text>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
              {selectedDocType === 'EWA' ? (
                <>
                  <strong>EWA requires exactly 1 photo.</strong>
                  {!dateOfLoss && (
                    <span style={{ color: '#ff4d4f', display: 'block', marginTop: 4 }}>
                      ⚠️ Date of Loss is missing. Please update job information before generating EWA.
                    </span>
                  )}
                </>
              ) : (
                'Select one or more photos. Each photo will be one full page in the PDF.'
              )}
            </Text>

            <div style={{
              height: selectedPhotoIds.length > 0 ? '350px' : '500px',
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              overflow: 'hidden',
              transition: 'height 0.3s ease'
            }}>
              {creatingPdf ? (
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: '100%'
                }}>
                  <Spin size="large" tip="Generating PDF..." />
                </div>
              ) : (
                <FileGallery
                  context="water-mitigation"
                  mode="select"
                  contextId={jobId}
                  allowedTypes={['image/*']}
                  fileCategory="image"
                  height="100%"
                  allowUpload={false}  // No upload in document creation modal
                  allowMultiSelect={true}  // Always allow multi-select, handler will limit for EWA
                  selectedFiles={selectedPhotoIds}
                  onFileSelect={handlePhotoSelection}
                  categories={[
                    'documentation',  // Documentation first for document creation
                    'uncategorized',
                    'wet-area',
                    'pre-mitigation-moving',
                    'demolition',
                    'containment',
                    'protection',
                    'drying-process',
                    'day-1',
                    'day-2',
                    'day-3',
                  ]}
                  defaultViewMode="grid"
                  allowViewModeChange={false}
                  showImagePreview={true}
                  enableImageZoom={false}
                  showImageInfo={false}
                  gridColumns={{ xs: 2, sm: 3, md: 4 }}
                  showCategories={true}  // Show category filter
                  allowCategoryCreate={false}  // No category creation in modal
                  showBulkActions={false}  // Hide bulk actions in document creation modal
                  showSelectAll={false}  // Hide select all button in document creation modal
                  enableDateGrouping={false}
                  showBulkCategoryUpdate={false}  // Hide Set Category action in document creation modal
                />
              )}
            </div>
          </div>

          {/* Selected Photos with Rotation Controls */}
          {selectedPhotoIds.length > 0 && !creatingPdf && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                Selected Photos ({selectedPhotoIds.length}) - Click rotate to adjust orientation
              </Text>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                maxHeight: '140px',
                overflowY: 'auto',
                padding: '8px',
                background: '#fafafa',
                borderRadius: 8,
                border: '1px solid #e8e8e8'
              }}>
                {selectedPhotoIds.map((photoId, index) => {
                  const rotation = photoRotations[photoId] || 0;
                  return (
                    <Card
                      key={photoId}
                      size="small"
                      style={{
                        width: 100,
                        padding: 0,
                        overflow: 'hidden'
                      }}
                      bodyStyle={{ padding: 4 }}
                    >
                      <div style={{ position: 'relative' }}>
                        <div style={{
                          width: '100%',
                          height: 70,
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: '#f0f0f0',
                          borderRadius: 4
                        }}>
                          <img
                            src={getPhotoThumbnail(photoId)}
                            alt={`Photo ${index + 1}`}
                            style={{
                              maxWidth: '100%',
                              maxHeight: '100%',
                              objectFit: 'contain',
                              transform: `rotate(${rotation}deg)`,
                              transition: 'transform 0.3s ease'
                            }}
                          />
                        </div>
                        {rotation !== 0 && (
                          <div style={{
                            position: 'absolute',
                            top: 2,
                            left: 2,
                            background: 'rgba(24, 144, 255, 0.9)',
                            color: 'white',
                            fontSize: 10,
                            padding: '1px 4px',
                            borderRadius: 3
                          }}>
                            {rotation}°
                          </div>
                        )}
                      </div>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: 4,
                        marginTop: 4
                      }}>
                        <Tooltip title="Rotate 90°">
                          <Button
                            type="text"
                            size="small"
                            icon={<RotateRightOutlined />}
                            onClick={() => handleRotatePhoto(photoId)}
                            style={{ color: '#1890ff' }}
                          />
                        </Tooltip>
                        <Tooltip title="Remove">
                          <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={() => handleRemovePhoto(photoId)}
                            style={{ color: '#ff4d4f' }}
                          />
                        </Tooltip>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </Space>
      </Modal>
    </div>
  );
};

export default WaterMitigationDocumentsTab;
