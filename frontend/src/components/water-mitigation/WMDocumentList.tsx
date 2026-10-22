/**
 * Water Mitigation Document List Component
 * Lists the job's documents together with the invoices generated from its
 * scope. Supports inline editing of invoice amount for Invoice-type documents
 */

import React, { useState, useCallback, useMemo } from 'react';
import { List, Button, Popconfirm, message, Tag, Typography, Checkbox, Space, InputNumber, Select, Tooltip, Grid, Dropdown, Modal } from 'antd';
import type { MenuProps } from 'antd';
import { FilePdfOutlined, FileImageOutlined, FileOutlined, FileTextOutlined, DownloadOutlined, DeleteOutlined, EyeOutlined, EditOutlined, DollarOutlined, CheckOutlined, CloseOutlined, DownOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import waterMitigationService from '../../services/waterMitigationService';
import type { WMScopeInvoiceResponse } from '../../types/waterMitigation';
import { WM_DOCUMENT_TYPES, getDocumentTypeInfo } from '../../constants/wmDocumentTypes';
import './WMDocumentInvoiceList.css';

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface WMDocumentListProps {
  jobId: string;
  jobAddress?: string;
  // Opening a generated invoice in the invoice editor
  canEditInvoices?: boolean;
  onDelete?: () => void;
  onEditAnnotation?: (documentId: string, annotationData: string | null, previewUrl: string, hasSourcePdf: boolean, docType?: string, templateId?: string, signatureFields?: any[]) => void;
  onInvoiceAmountChange?: () => void;
}

interface Document {
  id: string;
  filename: string;
  document_type: string;
  file_size: number;
  photo_count: number;
  annotation_data?: string | null;
  has_source_pdf?: boolean;
  invoice_amount?: number | null;
  upload_source?: string | null;
  title?: string | null;
  description?: string | null;
  created_at: string;
  template_id?: string;
  signature_fields?: any[];
}

// A document or a generated invoice, one row in the list. Invoice keys are
// prefixed so they can't collide with document ids in the selection.
type Row =
  | { kind: 'document'; key: string; date: string; doc: Document }
  | { kind: 'invoice'; key: string; date: string; invoice: WMScopeInvoiceResponse };

const invoiceKey = (invoiceId: string) => `invoice:${invoiceId}`;

const WMDocumentList = React.forwardRef<{ refresh: () => void }, WMDocumentListProps>(
  ({ jobId, jobAddress, canEditInvoices = true, onDelete, onEditAnnotation, onInvoiceAmountChange }, ref) => {
    const screens = useBreakpoint();
    const isMobile = !screens.md;
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: documents = [], isLoading: docsLoading } = useQuery({
      queryKey: ['wm-documents', jobId],
      queryFn: () => waterMitigationService.documents.getByJob(jobId),
      staleTime: 2 * 60 * 1000,
    });
    const { data: invoiceHistory, isLoading: invoicesLoading } = useQuery({
      queryKey: ['wm-scope-invoices', jobId],
      queryFn: () => waterMitigationService.scopeInvoice.getInvoiceHistory(jobId),
      staleTime: 2 * 60 * 1000,
    });
    const loading = docsLoading || invoicesLoading;

    // Newest first, documents and invoices interleaved
    const rows = useMemo<Row[]>(() => [
      ...documents.map((doc: Document): Row => ({ kind: 'document', key: doc.id, date: doc.created_at, doc })),
      ...(invoiceHistory?.invoices ?? []).map((invoice): Row => ({
        kind: 'invoice', key: invoiceKey(invoice.invoice_id), date: invoice.generated_at, invoice,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [documents, invoiceHistory]);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    // Inline invoice amount editing
    const [editingAmountId, setEditingAmountId] = useState<string | null>(null);
    const [editingAmountValue, setEditingAmountValue] = useState<number | null>(null);
    const [savingAmount, setSavingAmount] = useState(false);
    // Inline document type (tag) editing
    const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
    const [savingType, setSavingType] = useState(false);

    // Invoice preview
    const [previewInvoice, setPreviewInvoice] = useState<WMScopeInvoiceResponse | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState<string | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);

    const invalidateDocs = useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['wm-documents', jobId] });
      queryClient.invalidateQueries({ queryKey: ['wm-scope-invoices', jobId] });
    }, [queryClient, jobId]);

    React.useImperativeHandle(ref, () => ({
      refresh: invalidateDocs
    }), [invalidateDocs]);

  const handleDownload = (documentId: string, filename: string) => {
    const downloadUrl = waterMitigationService.documents.getDownloadUrl(documentId);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePreview = (documentId: string) => {
    const previewUrl = waterMitigationService.documents.getPreviewUrl(documentId);
    window.open(previewUrl, '_blank');
  };

  const handleDelete = async (documentId: string) => {
    setDeleting(documentId);
    try {
      await waterMitigationService.documents.delete(documentId);
      message.success('Document deleted successfully');
      invalidateDocs();
      onDelete?.();
    } catch (error) {
      console.error('Failed to delete document:', error);
      message.error('Failed to delete document');
    } finally {
      setDeleting(null);
    }
  };

  // --- Generated invoices ---
  const invoiceFilename = (invoice: WMScopeInvoiceResponse) => {
    const addr = (jobAddress || '').split(',')[0].trim();
    return `WM - ${addr} - ${invoice.invoice_number || 'unknown'}.pdf`;
  };

  // The PDF endpoint also saves the invoice as an Invoice document, so the
  // list is refreshed after it runs
  const handleDownloadInvoice = async (invoice: WMScopeInvoiceResponse, templateVariant: string = 'a') => {
    setDownloading(invoice.invoice_id);
    try {
      await waterMitigationService.scopeInvoice.downloadPdf(jobId, invoice.invoice_id, invoiceFilename(invoice), templateVariant);
      message.success('Invoice PDF downloaded');
      invalidateDocs();
    } catch (error) {
      console.error('Failed to download invoice PDF:', error);
      message.error('Failed to download invoice PDF');
    } finally {
      setDownloading(null);
    }
  };

  const handlePreviewInvoice = async (invoice: WMScopeInvoiceResponse) => {
    setPreviewing(invoice.invoice_id);
    try {
      const blob = await waterMitigationService.scopeInvoice.getPdfBlob(jobId, invoice.invoice_id, 'a');
      setPreviewUrl(URL.createObjectURL(blob));
      setPreviewInvoice(invoice);
      invalidateDocs();
    } catch (error) {
      console.error('Failed to preview invoice PDF:', error);
      message.error('Failed to preview invoice PDF');
    } finally {
      setPreviewing(null);
    }
  };

  const handleClosePreview = () => {
    setPreviewInvoice(null);
    setTimeout(() => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
    }, 300);
  };

  const pdfVariantMenu = (invoice: WMScopeInvoiceResponse): MenuProps['items'] => [
    { key: 'a', label: 'Format A — Standard', onClick: () => handleDownloadInvoice(invoice, 'a') },
    { key: 'b', label: 'Format B — Formal', onClick: () => handleDownloadInvoice(invoice, 'b') },
    { key: 'c', label: 'Format C — Modern', onClick: () => handleDownloadInvoice(invoice, 'c') },
  ];

  const handleDeleteInvoice = async (invoiceId: string) => {
    setDeleting(invoiceKey(invoiceId));
    try {
      await waterMitigationService.scopeInvoice.deleteInvoice(invoiceId);
      message.success('Invoice deleted and scope items reset');
      invalidateDocs();
      onDelete?.();
    } catch (error) {
      console.error('Failed to delete invoice:', error);
      message.error('Failed to delete invoice');
    } finally {
      setDeleting(null);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(rows.map(row => row.key));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (documentId: string, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, documentId]);
    } else {
      setSelectedIds(selectedIds.filter(id => id !== documentId));
    }
  };

  const selectedRows = rows.filter(row => selectedIds.includes(row.key));
  const selectedInvoiceCount = selectedRows.filter(row => row.kind === 'invoice').length;

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      await Promise.all(selectedRows.map(row => (row.kind === 'document'
        ? waterMitigationService.documents.delete(row.doc.id)
        : waterMitigationService.scopeInvoice.deleteInvoice(row.invoice.invoice_id))));
      message.success(`${selectedRows.length} document(s) deleted successfully`);
      setSelectedIds([]);
      invalidateDocs();
      onDelete?.();
    } catch (error) {
      console.error('Failed to delete documents:', error);
      message.error('Failed to delete some documents');
      invalidateDocs();
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBulkDownload = () => {
    selectedRows.forEach(row => {
      if (row.kind === 'document') {
        handleDownload(row.doc.id, row.doc.filename);
      } else {
        handleDownloadInvoice(row.invoice);
      }
    });
    message.success(`${selectedRows.length} document(s) download started`);
  };

  // --- Invoice Amount Editing ---
  const startEditAmount = (doc: Document) => {
    setEditingAmountId(doc.id);
    setEditingAmountValue(doc.invoice_amount ?? null);
  };

  const cancelEditAmount = () => {
    setEditingAmountId(null);
    setEditingAmountValue(null);
  };

  const saveInvoiceAmount = async () => {
    if (!editingAmountId) return;
    setSavingAmount(true);
    try {
      await waterMitigationService.documents.updateInvoiceAmount(
        editingAmountId,
        editingAmountValue
      );
      message.success('Invoice amount updated');
      invalidateDocs();
      setEditingAmountId(null);
      setEditingAmountValue(null);
      onInvoiceAmountChange?.();
    } catch (error) {
      console.error('Failed to update invoice amount:', error);
      message.error('Failed to update invoice amount');
    } finally {
      setSavingAmount(false);
    }
  };

  // --- Document Type (tag) Editing ---
  const saveDocumentType = async (documentId: string, newType: string) => {
    setSavingType(true);
    try {
      await waterMitigationService.documents.updateDocumentType(documentId, newType);
      message.success('Document type updated');
      invalidateDocs();
      setEditingTypeId(null);
    } catch (error) {
      console.error('Failed to update document type:', error);
      message.error('Failed to update document type');
    } finally {
      setSavingType(false);
    }
  };

  const renderTypeTag = (doc: Document) => {
    const typeInfo = getDocumentTypeInfo(doc.document_type);

    if (editingTypeId === doc.id) {
      return (
        <Space size={4} style={{ marginLeft: 8 }}>
          <Select
            size="small"
            value={doc.document_type}
            options={WM_DOCUMENT_TYPES.map(t => ({ value: t.value, label: t.label }))}
            onChange={(val) => saveDocumentType(doc.id, val)}
            loading={savingType}
            style={{ width: 220 }}
            autoFocus
            defaultOpen
          />
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={() => setEditingTypeId(null)}
            style={{ color: '#d44c47' }}
          />
        </Space>
      );
    }

    return (
      <Tooltip title="Click to change document type">
        <Tag
          color={typeInfo.color}
          style={{ marginLeft: 8, cursor: 'pointer' }}
          onClick={() => setEditingTypeId(doc.id)}
        >
          {typeInfo.label}
        </Tag>
      </Tooltip>
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isAllSelected = rows.length > 0 && selectedRows.length === rows.length;
  const isIndeterminate = selectedRows.length > 0 && selectedRows.length < rows.length;

  const renderInvoiceAmount = (doc: Document) => {
    const isEditing = editingAmountId === doc.id;

    if (isEditing) {
      return (
        <Space size={4} style={{ marginLeft: 4 }}>
          <InputNumber
            size="small"
            value={editingAmountValue}
            onChange={(val) => setEditingAmountValue(val)}
            prefix="$"
            precision={2}
            min={0}
            style={{ width: 130 }}
            autoFocus
            onPressEnter={saveInvoiceAmount}
            onKeyDown={(e) => { if (e.key === 'Escape') cancelEditAmount(); }}
          />
          <Button
            type="text"
            size="small"
            icon={<CheckOutlined />}
            onClick={saveInvoiceAmount}
            loading={savingAmount}
            style={{ color: '#448361' }}
          />
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={cancelEditAmount}
            style={{ color: '#d44c47' }}
          />
        </Space>
      );
    }

    // Show amount tag (clickable for Invoice type or manual uploads)
    if (doc.invoice_amount != null) {
      return (
        <Tooltip title="Click to edit amount">
          <Tag
            color="gold"
            icon={<DollarOutlined />}
            style={{ marginLeft: 4, cursor: 'pointer' }}
            onClick={() => startEditAmount(doc)}
          >
            ${doc.invoice_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Tag>
        </Tooltip>
      );
    }

    // Show "Set Amount" button for Invoice-type documents without amount
    if (doc.document_type === 'Invoice') {
      return (
        <Tooltip title="Set invoice amount">
          <Tag
            color="default"
            icon={<DollarOutlined />}
            style={{ marginLeft: 4, cursor: 'pointer', borderStyle: 'dashed' }}
            onClick={() => startEditAmount(doc)}
          >
            Set Amount
          </Tag>
        </Tooltip>
      );
    }

    return null;
  };

  const renderDocumentItem = (doc: Document) => (
    <List.Item
      className="wm-list-item"
      actions={[
        ...(doc.annotation_data && onEditAnnotation ? [
          <Button
            key="edit"
            type="text"
            icon={<EditOutlined />}
            onClick={() => onEditAnnotation(
              doc.id,
              doc.annotation_data || null,
              waterMitigationService.documents.getPreviewUrl(doc.id),
              doc.has_source_pdf || false,
              doc.document_type,
              doc.template_id,
              doc.signature_fields
            )}
          >
            Edit
          </Button>
        ] : []),
        <Button
          key="preview"
          type="text"
          icon={<EyeOutlined />}
          onClick={() => handlePreview(doc.id)}
        >
          Preview
        </Button>,
        <Button
          key="download"
          type="text"
          icon={<DownloadOutlined />}
          onClick={() => handleDownload(doc.id, doc.filename)}
        >
          Download
        </Button>,
        <Popconfirm
          key="delete"
          title="Delete document"
          description="Are you sure you want to delete this document?"
          onConfirm={() => handleDelete(doc.id)}
          okText="Delete"
          cancelText="Cancel"
          okButtonProps={{ danger: true }}
        >
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            loading={deleting === doc.id}
          >
            Delete
          </Button>
        </Popconfirm>
      ]}
    >
      <List.Item.Meta
        style={{ minWidth: 0 }}
        avatar={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Checkbox
              checked={selectedIds.includes(doc.id)}
              onChange={(e) => handleSelectOne(doc.id, e.target.checked)}
            />
            {doc.document_type === 'Photo' || doc.document_type === 'photo_report' || doc.document_type === 'Photo Report' ? (
              <FileImageOutlined style={{ fontSize: 32, color: '#c14c8a' }} />
            ) : doc.document_type === 'Sketch' ? (
              <FileOutlined style={{ fontSize: 32, color: '#337ea9' }} />
            ) : (
              <FilePdfOutlined style={{ fontSize: 32, color: '#d44c47' }} />
            )}
          </div>
        }
        title={
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
            <Tooltip title={doc.title && doc.title !== doc.filename ? doc.title : undefined}>
              <Text strong style={{ wordBreak: 'break-word', overflowWrap: 'break-word', minWidth: 0 }}>{doc.filename}</Text>
            </Tooltip>
            {renderTypeTag(doc)}
            {doc.upload_source !== 'manual_upload' && doc.photo_count > 0 && (
              <Tag style={{ marginLeft: 4 }}>
                {doc.photo_count} photo{doc.photo_count !== 1 ? 's' : ''}
              </Tag>
            )}
            {renderInvoiceAmount(doc)}
          </div>
        }
        description={
          <Tooltip title={doc.file_size ? formatFileSize(doc.file_size) : undefined}>
            <Text type="secondary">Created {formatDate(doc.created_at)}</Text>
          </Tooltip>
        }
      />
    </List.Item>
  );

  const renderInvoiceItem = (invoice: WMScopeInvoiceResponse) => {
    const key = invoiceKey(invoice.invoice_id);
    const typeInfo = getDocumentTypeInfo('Invoice');
    return (
      <List.Item
        className="wm-list-item"
        actions={[
          ...(canEditInvoices ? [
            <Button
              key="edit"
              type="text"
              icon={<EditOutlined />}
              onClick={() => navigate(`/invoices/${invoice.invoice_id}/edit`)}
            >
              Edit
            </Button>
          ] : []),
          <Button
            key="preview"
            type="text"
            icon={<EyeOutlined />}
            loading={previewing === invoice.invoice_id}
            onClick={() => handlePreviewInvoice(invoice)}
          >
            Preview
          </Button>,
          <Dropdown key="download" menu={{ items: pdfVariantMenu(invoice) }} trigger={['click']}>
            <Button
              type="text"
              icon={<DownloadOutlined />}
              loading={downloading === invoice.invoice_id}
            >
              Download <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>,
          <Popconfirm
            key="delete"
            title="Delete invoice"
            description={
              <div>
                <p>Are you sure you want to delete this invoice?</p>
                <p style={{ color: '#d44c47', fontSize: 12 }}>
                  This will also reset the scope items' invoiced status.
                </p>
              </div>
            }
            onConfirm={() => handleDeleteInvoice(invoice.invoice_id)}
            okText="Delete"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              loading={deleting === key}
            >
              Delete
            </Button>
          </Popconfirm>
        ]}
      >
        <List.Item.Meta
          style={{ minWidth: 0 }}
          avatar={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <Checkbox
                checked={selectedIds.includes(key)}
                onChange={(e) => handleSelectOne(key, e.target.checked)}
              />
              <FileTextOutlined style={{ fontSize: 32, color: '#448361' }} />
            </div>
          }
          title={
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
              <Text strong style={{ wordBreak: 'break-word', overflowWrap: 'break-word', minWidth: 0 }}>
                {invoice.invoice_number || 'Invoice'}
              </Text>
              <Tag color={typeInfo.color} style={{ marginLeft: 8 }}>{typeInfo.label}</Tag>
              <Tag color="gold" icon={<DollarOutlined />} style={{ marginLeft: 4 }}>
                ${(invoice.invoice_total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Tag>
            </div>
          }
          description={<Text type="secondary">Generated {formatDate(invoice.generated_at)}</Text>}
        />
      </List.Item>
    );
  };

  return (
    <div>
      {/* Bulk action toolbar */}
      {rows.length > 0 && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Checkbox
            indeterminate={isIndeterminate}
            checked={isAllSelected}
            onChange={(e) => handleSelectAll(e.target.checked)}
          >
            Select All ({selectedRows.length}/{rows.length})
          </Checkbox>

          {selectedRows.length > 0 && (
            <Space>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleBulkDownload}
              >
                Download ({selectedRows.length})
              </Button>
              <Popconfirm
                title="Delete selected documents"
                description={
                  <div>
                    <p>Are you sure you want to delete {selectedRows.length} document(s)?</p>
                    {selectedInvoiceCount > 0 && (
                      <p style={{ color: '#d44c47', fontSize: 12 }}>
                        Deleting an invoice also resets its scope items' invoiced status.
                      </p>
                    )}
                  </div>
                }
                onConfirm={handleBulkDelete}
                okText="Delete"
                cancelText="Cancel"
                okButtonProps={{ danger: true }}
              >
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  loading={bulkDeleting}
                >
                  Delete ({selectedRows.length})
                </Button>
              </Popconfirm>
            </Space>
          )}
        </div>
      )}

      <List
        loading={loading}
        dataSource={rows}
        rowKey="key"
        locale={{ emptyText: 'No documents yet' }}
        itemLayout={isMobile ? 'vertical' : 'horizontal'}
        renderItem={(row) => (row.kind === 'document' ? renderDocumentItem(row.doc) : renderInvoiceItem(row.invoice))}
      />

      <Modal
        title={previewInvoice ? `Invoice Preview — ${previewInvoice.invoice_number || 'Invoice'}` : 'Invoice Preview'}
        open={!!previewInvoice}
        onCancel={handleClosePreview}
        footer={[
          <Button key="close" onClick={handleClosePreview}>
            Close
          </Button>,
          <Button
            key="download"
            type="primary"
            icon={<DownloadOutlined />}
            loading={previewInvoice ? downloading === previewInvoice.invoice_id : false}
            onClick={() => previewInvoice && handleDownloadInvoice(previewInvoice, 'a')}
          >
            Download PDF
          </Button>,
        ]}
        width="90vw"
        style={{ top: 20 }}
        styles={{ body: { height: 'calc(90vh - 110px)', padding: 0 } }}
      >
        {previewUrl && (
          <iframe
            src={previewUrl}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Invoice Preview"
          />
        )}
      </Modal>
    </div>
  );
});

WMDocumentList.displayName = 'WMDocumentList';

export default WMDocumentList;
