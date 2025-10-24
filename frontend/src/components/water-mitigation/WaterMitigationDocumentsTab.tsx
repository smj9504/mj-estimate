/**
 * Water Mitigation Documents Tab
 * Manages document creation from uploaded photos with PDF generation
 */

import React, { useState, useRef } from 'react';
import { Button, Modal, Select, Space, message, Spin, Typography } from 'antd';
import { FilePdfOutlined, PlusOutlined } from '@ant-design/icons';
import FileGallery from '../common/FileGallery/FileGallery';
import WMDocumentList from './WMDocumentList';
import waterMitigationService from '../../services/waterMitigationService';

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
  const [creatingPdf, setCreatingPdf] = useState(false);
  const documentListRef = useRef<any>(null);

  const handleCreateDocument = () => {
    setCreateModalVisible(true);
    setSelectedDocType(null);
    setSelectedPhotoIds([]);
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

      // Generate PDF from selected photos
      const result = await waterMitigationService.documents.generatePdf(
        jobId,
        selectedPhotoIds,
        selectedDocType,
        jobAddress,
        dateOfLoss  // Pass date of loss for EWA documents
      );

      message.success(`PDF generated successfully: ${result.filename}`);
      setCreateModalVisible(false);
      setSelectedPhotoIds([]);
      setSelectedDocType(null);

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
              height: '500px',
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              overflow: 'hidden'
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
                  allowUpload={true}
                  allowMultiSelect={true}  // Always allow multi-select, handler will limit for EWA
                  selectedFiles={selectedPhotoIds}
                  onFileSelect={handlePhotoSelection}
                  categories={['documentation']}
                  defaultViewMode="grid"
                  allowViewModeChange={false}
                  showImagePreview={true}
                  enableImageZoom={false}
                  showImageInfo={false}
                  gridColumns={{ xs: 2, sm: 3, md: 4 }}
                  showCategories={false}
                  enableDateGrouping={false}
                />
              )}
            </div>
          </div>
        </Space>
      </Modal>
    </div>
  );
};

export default WaterMitigationDocumentsTab;
