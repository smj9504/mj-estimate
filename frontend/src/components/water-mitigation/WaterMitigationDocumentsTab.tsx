/**
 * Water Mitigation Documents Tab
 * Manages document creation from uploaded photos with PDF generation
 * Supports PDF annotation (text + signature) with re-editing capability
 */

import React, { useState, useRef, useCallback } from 'react';
import { Button, Modal, Select, Space, message, Spin, Input, Segmented, Switch, Tag, Empty } from 'antd';
import { ExclamationCircleOutlined, FilePdfOutlined, PlusOutlined, UploadOutlined, EditOutlined, FormOutlined } from '@ant-design/icons';
import PerspectiveCropModal from './PerspectiveCropModal';
import WMDocumentPages from './WMDocumentPages';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { contractTemplateService } from '../../services/contractService';
import FileGallery from '../common/FileGallery/FileGallery';
import { useSheetModal } from '../common/ui';
import WMDocumentList from './WMDocumentList';
import WMDocumentUploadModal from './WMDocumentUploadModal';
import WMPdfAnnotator from './pdf-annotator/WMPdfAnnotator';
import type { PdfAnnotationData } from './pdf-annotator/types';
import waterMitigationService from '../../services/waterMitigationService';
import api from '../../services/api';
import './documentCreate.css';

interface WaterMitigationDocumentsTabProps {
  jobId: string;
  jobAddress: string;
  dateOfLoss?: string;  // Date of loss from job data
  mitigationStartDate?: string;  // Mitigation start date (required for EWA)
  companyId?: string;  // Assigned company ID for fetching contract templates
  isActive?: boolean;
  onJobDataChange?: () => void;  // Callback when job data changes (e.g., invoice amount sync)
  canEditInvoices?: boolean;  // Off for the Water Mitigation (View) grant
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

const SCAN_EFFECTS = [
  { label: 'None', value: 'none' },
  { label: 'Color scan', value: 'color_scan' },
  { label: 'B&W scan', value: 'bw_scan' },
];

const WaterMitigationDocumentsTab: React.FC<WaterMitigationDocumentsTabProps> = ({
  jobId,
  jobAddress,
  dateOfLoss,
  mitigationStartDate,
  companyId,
  isActive,
  onJobDataChange,
  canEditInvoices = true,
}) => {
  const { isPhone: isMobile, sheetProps } = useSheetModal('tall');
  const queryClient = useQueryClient();
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
  const [editingTemplateId, setEditingTemplateId] = useState<string | undefined>(undefined);
  const [editingSignatureFields, setEditingSignatureFields] = useState<any[] | undefined>(undefined);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropPhotoId, setCropPhotoId] = useState<string>('');
  const [createSource, setCreateSource] = useState<'photos' | 'template'>('photos');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [generatingFromTemplate, setGeneratingFromTemplate] = useState(false);
  const documentListRef = useRef<any>(null);
  // The gallery's cards keep the selection handler from when they last redrew
  const selectedDocTypeRef = useRef(selectedDocType);
  selectedDocTypeRef.current = selectedDocType;

  // Fetch contract templates for assigned company (always fetch so we can decide default mode)
  const { data: templatesData } = useQuery({
    queryKey: ['contract-templates', companyId],
    queryFn: () => contractTemplateService.list(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
  // Certificate of Completion is the rebuild/recon certificate, not a WM document
  const wmTemplates = (templatesData?.templates ?? []).filter(
    (t: any) => t.is_active && t.document_type !== 'certificate_of_completion'
  );
  const contractTemplates = wmTemplates.filter((t: any) => t.field_mappings);
  // Shown disabled so a WM template that isn't set up yet doesn't silently disappear
  const unmappedTemplates = wmTemplates.filter((t: any) => !t.field_mappings);

  // Background refresh when tab becomes active
  const prevActiveRef = useRef(isActive);
  React.useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      documentListRef.current?.refresh();
    }
    prevActiveRef.current = isActive;
  }, [isActive]);

  const resetCreateForm = () => {
    setSelectedDocType(null);
    setSelectedPhotoIds([]);
    setPhotoRotations({});
    setCustomFilename('');
    setCompressPdf(false);
    setScanEffect(undefined);
    setSelectedTemplateId(null);
  };

  const handleCreateDocument = () => {
    const hasTemplates = companyId && contractTemplates.length > 0;
    setCreateModalVisible(true);
    setCreateSource(hasTemplates ? 'template' : 'photos');
    resetCreateForm();
  };

  const closeCreateModal = () => {
    setCreateModalVisible(false);
    resetCreateForm();
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

  const getPhotoWebUrl = (photoId: string) => {
    return `${api.defaults.baseURL || ''}/api/water-mitigation/photos/${photoId}/preview?size=web`;
  };

  const getPhotoOriginalUrl = (photoId: string) => {
    return `${api.defaults.baseURL || ''}/api/water-mitigation/photos/${photoId}/preview?size=original`;
  };

  const handlePhotoSelection = (fileIds: string[]) => {
    // An EWA holds 1 photo: picking another swaps it
    setSelectedPhotoIds(selectedDocTypeRef.current === 'EWA' ? fileIds.slice(-1) : fileIds);
  };

  const handleDocTypeChange = (value: string) => {
    setSelectedDocType(value);
    // Auto-fill custom filename with job address when Custom type is selected
    if (value === 'Custom' && !customFilename) {
      setCustomFilename(jobAddress);
    }
    if (value === 'EWA' && selectedPhotoIds.length > 1) {
      message.info('EWA document requires exactly 1 photo. Kept the first one.');
      setSelectedPhotoIds(selectedPhotoIds.slice(0, 1));
    }
  };

  const handleCropped = (newPhoto: any) => {
    // The crop takes the original's page. Any turn is already in its pixels.
    setSelectedPhotoIds(prev => prev.map(id => id === cropPhotoId ? newPhoto.id : id));
    setPhotoRotations(prev => {
      const { [cropPhotoId]: _, ...rest } = prev;
      return rest;
    });
    setCropModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ['files-infinite', 'water-mitigation', jobId] });
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
        if (deg !== 0 && selectedPhotoIds.includes(id)) acc[id] = deg;
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
      closeCreateModal();
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

      const { blob, annotations, signatureFields, templateId } = await waterMitigationService.documents.generateFromTemplate(
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
      setEditingTemplateId(templateId);
      setEditingSignatureFields(signatureFields);
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

  const pageCount = selectedPhotoIds.length > 0
    ? selectedPhotoIds.length + (selectedDocType === 'EWA' ? 1 : 0)
    : 0;
  const canGeneratePdf = !!selectedDocType
    && selectedPhotoIds.length > 0
    && !(selectedDocType === 'EWA' && !dateOfLoss)
    && !(selectedDocType === 'Custom' && !customFilename.trim());

  // --- PDF Annotator Handlers ---

  const handleOpenAnnotator = () => {
    setEditingDocumentId(undefined);
    setEditingAnnotations(null);
    setEditingSourceUrl(undefined);
    setEditingDocType(undefined);
    setEditingTemplateId(undefined);
    setEditingSignatureFields(undefined);
    setAnnotatorOpen(true);
  };

  const handleEditAnnotatedDocument = useCallback((
    documentId: string,
    annotationDataJson: string | null,
    previewUrl: string,
    hasSourcePdf: boolean,
    docType?: string,
    templateId?: string,
    signatureFields?: any[]
  ) => {
    setEditingDocumentId(documentId);
    setEditingDocType(docType);
    // Re-derived by the backend from the source ContractTemplate's field
    // mappings (if this document was generated from one), so the "Sign
    // Here" overlays reappear when re-editing.
    setEditingTemplateId(templateId);
    setEditingSignatureFields(signatureFields);

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
      sourcePdfBlob,
      editingTemplateId
    );
    setAnnotatorOpen(false);
    documentListRef.current?.refresh();
  };

  return (
    <div className="wm-documents-tab" style={{ height: isMobile ? 'auto' : 'calc(100vh - 180px)', minHeight: isMobile ? 'calc(100vh - 250px)' : undefined, padding: isMobile ? '8px' : '16px', overflow: 'auto' }}>
      {/* Uploaded and generated documents, and the invoices from the scope.
          No titled card around it: the tab already says Documents */}
      <WMDocumentList
        ref={documentListRef}
        jobId={jobId}
        jobAddress={jobAddress}
        canEditInvoices={canEditInvoices}
        onDelete={() => {
          // Refresh list after delete
        }}
        onEditAnnotation={handleEditAnnotatedDocument}
        onInvoiceAmountChange={onJobDataChange}
        toolbarExtra={
          <Space size="small">
            <Button
              icon={<UploadOutlined />}
              onClick={() => setUploadModalVisible(true)}
            >
              Upload
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateDocument}
            >
              Create
            </Button>
            <Button
              icon={<EditOutlined />}
              onClick={handleOpenAnnotator}
            >
              Annotate
            </Button>
          </Space>
        }
      />

      <Modal
        {...sheetProps}
        className="wdc-modal"
        title="Create document"
        open={createModalVisible}
        onCancel={closeCreateModal}
        width={createSource === 'photos' ? 1180 : 760}
        style={isMobile ? undefined : { maxWidth: '96vw', top: 24 }}
        footer={[
          <Button key="cancel" onClick={closeCreateModal}>
            Cancel
          </Button>,
          createSource === 'photos' ? (
            <Button
              key="generate"
              type="primary"
              icon={<FilePdfOutlined />}
              onClick={handleGeneratePdf}
              disabled={!canGeneratePdf}
              loading={creatingPdf}
            >
              {pageCount > 0 ? `Generate PDF · ${pageCount} page${pageCount !== 1 ? 's' : ''}` : 'Generate PDF'}
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
        {/* Source Selection */}
        {companyId && contractTemplates.length > 0 && (
          <div className="wdc-source">
            <Segmented
              block
              value={createSource}
              onChange={(value) => {
                setCreateSource(value as 'photos' | 'template');
                setSelectedDocType(null);
                setSelectedPhotoIds([]);
                setPhotoRotations({});
                setSelectedTemplateId(null);
              }}
              options={[
                { value: 'photos', label: 'From photos', icon: <FilePdfOutlined /> },
                { value: 'template', label: isMobile ? 'From template' : 'From contract template', icon: <FormOutlined /> },
              ]}
            />
          </div>
        )}

        {/* === Template Source === */}
        {createSource === 'template' && (
          <div className="wdc-templates">
            <h3 className="wdc-section-head">Select contract template</h3>
            {contractTemplates.length === 0 ? (
              <Empty
                description="No templates with field mappings found for this company"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <div className="wdc-template-grid">
                {contractTemplates.map((tmpl: any) => {
                  const isSelected = selectedTemplateId === tmpl.id;
                  const mappingCount = (() => {
                    try { return JSON.parse(tmpl.field_mappings || '[]').length; }
                    catch { return 0; }
                  })();
                  return (
                    <button
                      key={tmpl.id}
                      type="button"
                      className={`wdc-template${isSelected ? ' is-selected' : ''}`}
                      aria-pressed={isSelected}
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
                    >
                      <span className="wdc-template-name">{tmpl.name}</span>
                      <Space size={4} wrap>
                        <Tag>{tmpl.document_type?.replace(/_/g, ' ')}</Tag>
                        <Tag color="blue">{mappingCount} fields mapped</Tag>
                      </Space>
                      {tmpl.file_name && (
                        <span className="wdc-template-file">
                          <FilePdfOutlined style={{ marginRight: 4 }} />
                          {tmpl.file_name}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {unmappedTemplates.length > 0 && (
              <div className="wdc-unmapped">
                <p className="wdc-hint" style={{ margin: '0 0 4px' }}>
                  Not available yet — map the fields in the company's Contract Templates first:
                </p>
                <Space size={4} wrap>
                  {unmappedTemplates.map((tmpl: any) => (
                    <Tag key={tmpl.id} style={{ opacity: 0.7 }}>
                      {tmpl.name} · 0 fields mapped
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
          </div>
        )}

        {/* === Photo Source === */}
        {createSource === 'photos' && (
          <div className="wdc-split">
            {/* Photo Selection */}
            <section className="wdc-gallery" aria-label="Job photos">
              <div className="wdc-gallery-body">
                <FileGallery
                  context="water-mitigation"
                  mode="select"
                  contextId={jobId}
                  allowedTypes={['image/*']}
                  fileCategory="image"
                  photosOnly
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
                  enableInfiniteScroll={true}  // Same photo API as the Photos tab: real thumbnails, paged
                  pageSize={20}
                />
              </div>
            </section>

            <aside className="wdc-rail" aria-label="Document">
              {/* Document Type */}
              <div className="wdc-rail-setup">
                <div className="wdc-field">
                  <label className="wdc-label" htmlFor="wdc-doc-type">Document type</label>
                  <Select
                    id="wdc-doc-type"
                    style={{ width: '100%' }}
                    size={isMobile ? 'large' : undefined}
                    placeholder="Select document type"
                    value={selectedDocType}
                    onChange={handleDocTypeChange}
                    options={DOCUMENT_TYPES.map(dt => ({
                      value: dt.value,
                      label: dt.label
                    }))}
                  />
                  {selectedDocType === 'EWA' && !dateOfLoss && (
                    <p className="wdc-warning">
                      <ExclamationCircleOutlined aria-hidden />
                      <span>Date of Loss is missing. Please update job information before generating EWA.</span>
                    </p>
                  )}
                </div>

                {/* Custom Filename Input - only for Custom type */}
                {selectedDocType === 'Custom' && (
                  <div className="wdc-field">
                    <label className="wdc-label" htmlFor="wdc-filename">Custom filename</label>
                    <Input
                      id="wdc-filename"
                      size={isMobile ? 'large' : undefined}
                      placeholder="Enter custom filename"
                      value={customFilename}
                      onChange={(e) => setCustomFilename(e.target.value)}
                      maxLength={200}
                      suffix=".pdf"
                    />
                  </div>
                )}
              </div>

              {/* The pages, in order */}
              <div className="wdc-rail-pages">
                <h3 className="wdc-section-head">
                  Pages
                  {pageCount > 0 && <span className="wdc-section-count">{pageCount}</span>}
                </h3>
                {selectedPhotoIds.length === 0 ? (
                  <div className="wdc-empty">
                    {selectedDocType === 'EWA'
                      ? 'Select 1 photo. It goes in after the agreement form.'
                      : 'Select photos. Each one becomes a full page, in this order.'}
                  </div>
                ) : (
                  <WMDocumentPages
                    photoIds={selectedPhotoIds}
                    rotations={photoRotations}
                    leadingPage={selectedDocType === 'EWA' ? 'Agreement form, filled in from the job' : undefined}
                    sheetUrl={getPhotoWebUrl}
                    fullSizeUrl={getPhotoOriginalUrl}
                    onReorder={setSelectedPhotoIds}
                    onRotate={handleRotatePhoto}
                    onCrop={(photoId) => {
                      setCropPhotoId(photoId);
                      setCropModalOpen(true);
                    }}
                    onRemove={handleRemovePhoto}
                  />
                )}
              </div>

              {/* Compress PDF & Scan Effect Options */}
              <div className="wdc-rail-options">
                <div className="wdc-field">
                  <span className="wdc-label">Scan effect</span>
                  <Segmented
                    block
                    size={isMobile ? 'middle' : 'small'}
                    options={SCAN_EFFECTS}
                    value={scanEffect || 'none'}
                    onChange={(val) => setScanEffect(val === 'none' ? undefined : String(val))}
                  />
                  <p className="wdc-hint">Make photos look like scanned documents</p>
                </div>
                <div className="wdc-field">
                  <div className="wdc-compress">
                    <label className="wdc-compress-label" htmlFor="wdc-compress">Compress PDF</label>
                    <Switch id="wdc-compress" size="small" checked={compressPdf} onChange={setCompressPdf} />
                  </div>
                  <p className="wdc-hint">Reduce file size by compressing images (lower quality)</p>
                </div>
              </div>
            </aside>

            {creatingPdf && (
              <div className="wdc-busy" role="status">
                <Spin size="large" />
                Generating PDF...
              </div>
            )}
          </div>
        )}
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
        // dvh, not vh: on mobile 100vh includes the area behind the browser's
        // address bar, which pushed the bottom of the PDF off-screen
        styles={{ body: { height: 'calc(100dvh - 100px)', padding: 0, overflow: 'hidden' } }}
        destroyOnHidden
      >
        <WMPdfAnnotator
          jobId={jobId}
          documentId={editingDocumentId}
          existingAnnotations={editingAnnotations}
          sourcePdfUrl={editingSourceUrl}
          documentType={editingDocType}
          defaultFilename={editingFilename}
          signatureFields={editingSignatureFields}
          onSave={handleAnnotatorSave}
          onClose={() => setAnnotatorOpen(false)}
        />
      </Modal>

      {/* Perspective Crop Modal */}
      <PerspectiveCropModal
        open={cropModalOpen}
        photoId={cropPhotoId}
        photoUrl={cropPhotoId ? getPhotoOriginalUrl(cropPhotoId) : ''}
        previewUrl={cropPhotoId ? getPhotoWebUrl(cropPhotoId) : undefined}
        rotation={photoRotations[cropPhotoId] || 0}
        onClose={() => setCropModalOpen(false)}
        onCropped={handleCropped}
      />
    </div>
  );
};

export default WaterMitigationDocumentsTab;
