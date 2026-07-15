/**
 * Water Mitigation Documents Tab
 * Manages document creation from uploaded photos with PDF generation
 * Supports PDF annotation (text + signature) with re-editing capability
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Button, Modal, Select, Space, message, Spin, Typography, Card, Tooltip, Input, Checkbox, Grid, Radio, Table, Tag, Empty } from 'antd';
import { FilePdfOutlined, PlusOutlined, UploadOutlined, RotateRightOutlined, CloseOutlined, FileTextOutlined, DollarOutlined, EditOutlined, FormOutlined, ScissorOutlined } from '@ant-design/icons';
import PerspectiveCropModal from './PerspectiveCropModal';
import { useQuery } from '@tanstack/react-query';
import { contractTemplateService } from '../../services/contractService';
import FileGallery from '../common/FileGallery/FileGallery';
import WMDocumentList from './WMDocumentList';
import WMDocumentUploadModal from './WMDocumentUploadModal';
import WMInvoiceList from './WMInvoiceList';
import WMPdfAnnotator from './pdf-annotator/WMPdfAnnotator';
import type { PdfAnnotationData } from './pdf-annotator/types';
import waterMitigationService from '../../services/waterMitigationService';
import api from '../../services/api';
import { useWaterMitigationPhotos } from '../../hooks/useWaterMitigationPhotos';

const { Title, Text } = Typography;

interface WaterMitigationDocumentsTabProps {
  jobId: string;
  jobAddress: string;
  dateOfLoss?: string;  // Date of loss from job data
  mitigationStartDate?: string;  // Mitigation start date (required for EWA)
  companyId?: string;  // Assigned company ID for fetching contract templates
  isActive?: boolean;
  onJobDataChange?: () => void;  // Callback when job data changes (e.g., invoice amount sync)
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
  },
  {
    value: 'W9',
    label: 'Company W-9',
    description: 'Company W-9 tax form for insurance claims'
  },
  {
    value: 'Custom',
    label: 'Custom Document',
    description: 'Custom document with user-defined filename'
  }
];

const { useBreakpoint } = Grid;

const WaterMitigationDocumentsTab: React.FC<WaterMitigationDocumentsTabProps> = ({
  jobId,
  jobAddress,
  dateOfLoss,
  mitigationStartDate,
  companyId,
  isActive,
  onJobDataChange,
}) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<string | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [photoRotations, setPhotoRotations] = useState<Record<string, number>>({});  // {photoId: degrees}
  const [customFilename, setCustomFilename] = useState<string>('');
  const [compressPdf, setCompressPdf] = useState<boolean>(false);  // Compress PDF option
  const [scanEffect, setScanEffect] = useState<string | undefined>(undefined);
  const [creatingPdf, setCreatingPdf] = useState(false);
  const [annotatorOpen, setAnnotatorOpen] = useState(false);
  const [editingDocumentId, setEditingDocumentId] = useState<string | undefined>(undefined);
  const [editingAnnotations, setEditingAnnotations] = useState<PdfAnnotationData | null>(null);
  const [editingSourceUrl, setEditingSourceUrl] = useState<string | undefined>(undefined);
  const [editingDocType, setEditingDocType] = useState<string | undefined>(undefined);
  const [editingFilename, setEditingFilename] = useState<string | undefined>(undefined);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropPhotoId, setCropPhotoId] = useState<string>('');
  const [cropPhotoUrl, setCropPhotoUrl] = useState<string>('');
  const [createSource, setCreateSource] = useState<'photos' | 'template'>('photos');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [generatingFromTemplate, setGeneratingFromTemplate] = useState(false);
  const documentListRef = useRef<any>(null);
  const invoiceListRef = useRef<any>(null);

  // Fetch contract templates for assigned company (always fetch so we can decide default mode)
  const { data: templatesData } = useQuery({
    queryKey: ['contract-templates', companyId],
    queryFn: () => contractTemplateService.list(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
  const contractTemplates = (templatesData?.templates ?? []).filter(
    (t: any) => t.is_active && t.field_mappings
  );

  // Background refresh when tab becomes active
  const prevActiveRef = useRef(isActive);
  React.useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      documentListRef.current?.refresh();
      invoiceListRef.current?.refresh();
    }
    prevActiveRef.current = isActive;
  }, [isActive]);

  // Load photos only when photo mode is active
  const { data: allPhotos = [] } = useWaterMitigationPhotos(jobId, {
    enabled: createModalVisible && createSource === 'photos',
    pageSize: 200
  });

  const handleCreateDocument = () => {
    const hasTemplates = companyId && contractTemplates.length > 0;
    setCreateModalVisible(true);
    setCreateSource(hasTemplates ? 'template' : 'photos');
    setSelectedDocType(null);
    setSelectedPhotoIds([]);
    setPhotoRotations({});
    setCustomFilename('');
    setCompressPdf(false);
    setScanEffect(undefined);
    setSelectedTemplateId(null);
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

  // Build photo thumbnail map for O(1) lookup
  const photoThumbnailMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allPhotos as any[]) {
      const baseURL = api.defaults.baseURL || '';
      const url = p.thumbnail_url || p.thumbnailUrl || `${baseURL}/api/water-mitigation/photos/${p.id}/preview?size=thumbnail`;
      m.set(p.id, url);
    }
    return m;
  }, [allPhotos]);

  const getPhotoThumbnail = (photoId: string) => {
    return photoThumbnailMap.get(photoId) || `${api.defaults.baseURL || ''}/api/water-mitigation/photos/${photoId}/preview?size=thumbnail`;
  };

  const getPhotoFullUrl = (photoId: string) => {
    return `${api.defaults.baseURL || ''}/api/water-mitigation/photos/${photoId}/preview?size=web`;
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

    // Custom document validation
    if (selectedDocType === 'Custom') {
      if (!customFilename || !customFilename.trim()) {
        message.error('Please enter a custom filename');
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
        dateOfLoss,
        mitigationStartDate,  // Pass mitigation start date for EWA documents
        Object.keys(rotations).length > 0 ? rotations : undefined,
        selectedDocType === 'Custom' ? customFilename.trim() : undefined,
        compressPdf,  // Pass compress option
        scanEffect  // Pass scan effect option
      );

      // Open generated PDF in annotator for editing before finalizing
      const sourceUrl = waterMitigationService.documents.getSourcePdfUrl(result.id);
      setEditingDocumentId(result.id);
      setEditingAnnotations(null);
      setEditingSourceUrl(sourceUrl);
      setEditingDocType(selectedDocType || undefined);
      setEditingFilename(result.filename);
      setAnnotatorOpen(true);

      message.success('PDF generated. You can now annotate it.');
      setCreateModalVisible(false);
      setSelectedPhotoIds([]);
      setSelectedDocType(null);
      setPhotoRotations({});
      setCustomFilename('');
      setCompressPdf(false);
      setScanEffect(undefined);
    } catch (error: any) {
      console.error('Failed to generate PDF:', error);
      const errorMessage = error?.response?.data?.detail || 'Failed to generate PDF';
      message.error(errorMessage);
    } finally {
      setCreatingPdf(false);
    }
  };

  const handleGenerateFromTemplate = async () => {
    if (!selectedTemplateId) {
      message.error('Please select a template');
      return;
    }
    try {
      setGeneratingFromTemplate(true);
      message.loading('Generating prefilled PDF...', 0);

      const { blob, annotations } = await waterMitigationService.documents.generateFromTemplate(
        jobId,
        selectedTemplateId,
      );

      // Create blob URL and open in annotator with prefill annotations
      const blobUrl = window.URL.createObjectURL(blob);
      setEditingDocumentId(undefined);
      setEditingAnnotations(annotations || null);
      setEditingSourceUrl(blobUrl);
      // Preserve document type from template selection for proper categorization
      setEditingDocType(selectedDocType || undefined);
      setAnnotatorOpen(true);

      // Close create modal
      setCreateModalVisible(false);
      setSelectedTemplateId(null);
      setSelectedDocType(null);

      message.destroy();
    } catch (error: any) {
      message.destroy();
      console.error('Failed to generate from template:', error);
      message.error(error?.response?.data?.detail || 'Failed to generate document from template');
    } finally {
      setGeneratingFromTemplate(false);
    }
  };

  const getSelectedDocumentType = () => {
    return DOCUMENT_TYPES.find(dt => dt.value === selectedDocType);
  };

  // --- PDF Annotator Handlers ---

  const handleOpenAnnotator = () => {
    setEditingDocumentId(undefined);
    setEditingAnnotations(null);
    setEditingSourceUrl(undefined);
    setEditingDocType(undefined);
    setAnnotatorOpen(true);
  };

  const handleEditAnnotatedDocument = useCallback((
    documentId: string,
    annotationDataJson: string | null,
    previewUrl: string,
    hasSourcePdf: boolean,
    docType?: string
  ) => {
    setEditingDocumentId(documentId);
    setEditingDocType(docType);

    // source-pdf endpoint returns clean PDF:
    // - New docs: returns stored original (unannotated) PDF
    // - Legacy docs: dynamically erases annotation regions from baked PDF
    setEditingSourceUrl(waterMitigationService.documents.getSourcePdfUrl(documentId));

    // Always restore annotations as overlays (source-pdf is always clean)
    if (annotationDataJson) {
      try {
        setEditingAnnotations(JSON.parse(annotationDataJson));
      } catch {
        setEditingAnnotations(null);
      }
    } else {
      setEditingAnnotations(null);
    }
    setAnnotatorOpen(true);
  }, []);

  const handleAnnotatorSave = async (pdfBlob: Blob, filename: string, annotationData: PdfAnnotationData, sourcePdfBlob?: Blob) => {
    await waterMitigationService.documents.uploadAnnotatedPdf(
      jobId,
      pdfBlob,
      filename,
      JSON.stringify(annotationData),
      editingDocumentId,
      editingDocType,
      sourcePdfBlob
    );
    setAnnotatorOpen(false);
    documentListRef.current?.refresh();
  };

  return (
    <div className="wm-documents-tab" style={{ height: isMobile ? 'auto' : 'calc(100vh - 180px)', minHeight: isMobile ? 'calc(100vh - 250px)' : undefined, padding: isMobile ? '8px' : '16px', overflow: 'auto' }}>
      {/* Documents Section */}
      <Card
        title={<span><FileTextOutlined style={{ marginRight: 8 }} />Documents</span>}
        size="small"
        extra={
          <Space size="small">
            <Button
              icon={<UploadOutlined />}
              onClick={() => setUploadModalVisible(true)}
              size="small"
            >
              Upload
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateDocument}
              size="small"
            >
              Create
            </Button>
            <Button
              icon={<EditOutlined />}
              onClick={handleOpenAnnotator}
              size="small"
            >
              Annotate
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <WMDocumentList
          ref={documentListRef}
          jobId={jobId}
          onDelete={() => {
            // Refresh list after delete
          }}
          onEditAnnotation={handleEditAnnotatedDocument}
          onInvoiceAmountChange={onJobDataChange}
        />
      </Card>

      {/* Invoices Section */}
      <Card
        title={<span><DollarOutlined style={{ marginRight: 8 }} />Invoices</span>}
        size="small"
      >
        <WMInvoiceList
          ref={invoiceListRef}
          jobId={jobId}
          jobAddress={jobAddress}
        />
      </Card>

      <Modal
        title="Create Document"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          setSelectedPhotoIds([]);
          setSelectedDocType(null);
          setPhotoRotations({});
          setCustomFilename('');
          setCompressPdf(false);
          setScanEffect(undefined);
          setSelectedTemplateId(null);
        }}
        width={isMobile ? '95vw' : 1000}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setCreateModalVisible(false);
              setSelectedPhotoIds([]);
              setSelectedDocType(null);
              setPhotoRotations({});
              setCustomFilename('');
              setCompressPdf(false);
              setScanEffect(undefined);
              setSelectedTemplateId(null);
            }}
          >
            Cancel
          </Button>,
          createSource === 'photos' ? (
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
          ) : (
            <Button
              key="generate-template"
              type="primary"
              icon={<FormOutlined />}
              onClick={handleGenerateFromTemplate}
              disabled={!selectedTemplateId}
              loading={generatingFromTemplate}
            >
              Open in Annotator
            </Button>
          )
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* Source Selection */}
          {companyId && contractTemplates.length > 0 && (
            <Radio.Group
              value={createSource}
              onChange={(e) => {
                setCreateSource(e.target.value);
                setSelectedDocType(null);
                setSelectedPhotoIds([]);
                setSelectedTemplateId(null);
              }}
              optionType="button"
              buttonStyle="solid"
              style={{ width: '100%', display: 'flex' }}
            >
              <Radio.Button value="photos" style={{ flex: 1, textAlign: 'center' }}>
                <FilePdfOutlined /> From Photos
              </Radio.Button>
              <Radio.Button value="template" style={{ flex: 1, textAlign: 'center' }}>
                <FormOutlined /> From Contract Template
              </Radio.Button>
            </Radio.Group>
          )}

          {/* Document Type Selection - only for photo mode */}
          {createSource === 'photos' && (
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Document Type</Text>
            <Select
              style={{ width: '100%' }}
              placeholder="Select document type"
              value={selectedDocType}
              onChange={(value) => {
                setSelectedDocType(value);
                // Auto-fill custom filename with job address when Custom type is selected
                if (value === 'Custom' && !customFilename) {
                  setCustomFilename(jobAddress);
                }
              }}
              options={DOCUMENT_TYPES.map(dt => ({
                value: dt.value,
                label: dt.label
              }))}
            />
          </div>
          )}

          {/* === Template Source === */}
          {createSource === 'template' && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Select Contract Template</Text>
              {contractTemplates.length === 0 ? (
                <Empty
                  description="No templates with field mappings found for this company"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                  gap: 8,
                }}>
                  {contractTemplates.map((tmpl: any) => {
                    const isSelected = selectedTemplateId === tmpl.id;
                    const mappingCount = (() => {
                      try { return JSON.parse(tmpl.field_mappings || '[]').length; }
                      catch { return 0; }
                    })();
                    return (
                      <Card
                        key={tmpl.id}
                        size="small"
                        hoverable
                        onClick={() => {
                          setSelectedTemplateId(tmpl.id);
                          // Auto-set document type from template type
                          const typeMap: Record<string, string> = {
                            certificate_of_satisfaction: 'COS',
                            authorization: 'EWA',
                          };
                          if (!selectedDocType) {
                            setSelectedDocType(typeMap[tmpl.document_type] || 'Other');
                          }
                        }}
                        style={{
                          border: isSelected ? '2px solid #1890ff' : '1px solid #d9d9d9',
                          background: isSelected ? '#e6f4ff' : undefined,
                        }}
                      >
                        <Space direction="vertical" size={2} style={{ width: '100%' }}>
                          <Text strong>{tmpl.name}</Text>
                          <Space size={4} wrap>
                            <Tag>{tmpl.document_type?.replace(/_/g, ' ')}</Tag>
                            <Tag color="blue">{mappingCount} fields mapped</Tag>
                          </Space>
                          {tmpl.file_name && (
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              <FilePdfOutlined style={{ marginRight: 4 }} />
                              {tmpl.file_name}
                            </Text>
                          )}
                        </Space>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* === Photo Source === */}
          {/* Custom Filename Input - only for Custom type */}
          {createSource === 'photos' && selectedDocType === 'Custom' && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                Custom Filename
              </Text>
              <Input
                placeholder="Enter custom filename (without .pdf)"
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
                maxLength={200}
                showCount
                style={{ marginBottom: 4 }}
              />
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Extension .pdf will be added automatically
              </Text>
              {customFilename && (
                <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                  Final filename: <strong>{customFilename}.pdf</strong>
                </Text>
              )}
            </div>
          )}

          {/* Compress PDF & Scan Effect Options */}
          {createSource === 'photos' && (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <div>
                <Checkbox
                  checked={compressPdf}
                  onChange={(e) => setCompressPdf(e.target.checked)}
                >
                  <Text>Compress PDF</Text>
                </Checkbox>
                <Text type="secondary" style={{ display: 'block', fontSize: 12, marginLeft: 24 }}>
                  Reduce file size by compressing images (lower quality)
                </Text>
              </div>
              <div>
                <Text style={{ marginRight: 8 }}>Scan Effect:</Text>
                <Select
                  value={scanEffect || 'none'}
                  onChange={(val) => setScanEffect(val === 'none' ? undefined : val)}
                  style={{ width: 150 }}
                  size="small"
                >
                  <Select.Option value="none">None</Select.Option>
                  <Select.Option value="color_scan">Color Scan</Select.Option>
                  <Select.Option value="bw_scan">B&W Scan</Select.Option>
                </Select>
                <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                  Make photos look like scanned documents
                </Text>
              </div>
            </Space>
          )}

          {/* Photo Selection */}
          {createSource === 'photos' && (
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
              ) : selectedDocType === 'Custom' ? (
                'Select one or more photos. Each photo will be one full page.'
              ) : (
                'Select one or more photos. Each photo will be one full page in the PDF.'
              )}
            </Text>

            <div style={{
              height: selectedPhotoIds.length > 0 ? (isMobile ? '250px' : '350px') : (isMobile ? '300px' : '500px'),
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
                  <div style={{ textAlign: 'center' }}>
                    <Spin size="large" />
                    <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 14 }}>Generating PDF...</div>
                  </div>
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
                    'personal-properties',
                    'pre-mitigation-moving',
                    'demolition',
                    'containment',
                    'protection',
                    'drying-process',
                    'day-1',
                    'day-2',
                    'day-3',
                  ]}
                  defaultCategory="documentation"  // Start with Documentation category selected
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
          )}

          {/* Selected Photos with Rotation Controls */}
          {createSource === 'photos' && selectedPhotoIds.length > 0 && !creatingPdf && (
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
                      styles={{ body: { padding: 4 } }}
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
                        <Tooltip title="Perspective Crop">
                          <Button
                            type="text"
                            size="small"
                            icon={<ScissorOutlined />}
                            onClick={() => {
                              setCropPhotoId(photoId);
                              setCropPhotoUrl(getPhotoFullUrl(photoId));
                              setCropModalOpen(true);
                            }}
                            style={{ color: '#722ed1' }}
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

      {/* Document Upload Modal */}
      <WMDocumentUploadModal
        open={uploadModalVisible}
        jobId={jobId}
        onClose={() => setUploadModalVisible(false)}
        onSuccess={() => {
          setUploadModalVisible(false);
          documentListRef.current?.refresh();
        }}
      />

      {/* PDF Annotator Modal */}
      <Modal
        title={editingDocumentId ? "Edit Annotated PDF" : "Annotate PDF"}
        open={annotatorOpen}
        onCancel={() => setAnnotatorOpen(false)}
        footer={null}
        width="95vw"
        style={{ top: 10, maxWidth: '100vw' }}
        styles={{ body: { height: 'calc(100vh - 100px)', padding: 0, overflow: 'hidden' } }}
        destroyOnClose
      >
        <WMPdfAnnotator
          jobId={jobId}
          documentId={editingDocumentId}
          existingAnnotations={editingAnnotations}
          sourcePdfUrl={editingSourceUrl}
          documentType={editingDocType}
          defaultFilename={editingFilename}
          onSave={handleAnnotatorSave}
          onClose={() => setAnnotatorOpen(false)}
        />
      </Modal>

      {/* Perspective Crop Modal */}
      <PerspectiveCropModal
        open={cropModalOpen}
        photoId={cropPhotoId}
        photoUrl={cropPhotoUrl}
        onClose={() => setCropModalOpen(false)}
        onCropped={(newPhoto) => {
          // Replace the original photo with the cropped one in selection
          setSelectedPhotoIds(prev =>
            prev.map(id => id === cropPhotoId ? newPhoto.id : id)
          );
          setCropModalOpen(false);
        }}
      />
    </div>
  );
};

export default WaterMitigationDocumentsTab;
