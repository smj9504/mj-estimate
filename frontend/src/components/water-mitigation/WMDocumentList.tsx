/**
 * Water Mitigation Document List Component
 * Supports inline editing of invoice amount for Invoice-type documents
 */

import React, { useState, useCallback } from 'react';
import { List, Button, Popconfirm, message, Tag, Typography, Checkbox, Space, InputNumber, Tooltip, Grid } from 'antd';
import { FilePdfOutlined, FileImageOutlined, FileOutlined, DownloadOutlined, DeleteOutlined, EyeOutlined, EditOutlined, DollarOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import waterMitigationService from '../../services/waterMitigationService';
import './WMDocumentInvoiceList.css';

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface WMDocumentListProps {
  jobId: string;
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

const WMDocumentList = React.forwardRef<{ refresh: () => void }, WMDocumentListProps>(
  ({ jobId, onDelete, onEditAnnotation, onInvoiceAmountChange }, ref) => {
    const screens = useBreakpoint();
    const isMobile = !screens.md;
    const queryClient = useQueryClient();
    const { data: documents = [], isLoading: loading } = useQuery({
      queryKey: ['wm-documents', jobId],
      queryFn: () => waterMitigationService.documents.getByJob(jobId),
      staleTime: 2 * 60 * 1000,
    });
    const [deleting, setDeleting] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    // Inline invoice amount editing
    const [editingAmountId, setEditingAmountId] = useState<string | null>(null);
    const [editingAmountValue, setEditingAmountValue] = useState<number | null>(null);
    const [savingAmount, setSavingAmount] = useState(false);

    const invalidateDocs = useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['wm-documents', jobId] });
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

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(documents.map(doc => doc.id));
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

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      await Promise.all(selectedIds.map(id => waterMitigationService.documents.delete(id)));
      message.success(`${selectedIds.length} document(s) deleted successfully`);
      invalidateDocs();
      onDelete?.();
    } catch (error) {
      console.error('Failed to delete documents:', error);
      message.error('Failed to delete some documents');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBulkDownload = () => {
    selectedIds.forEach(id => {
      const doc = documents.find(d => d.id === id);
      if (doc) {
        handleDownload(id, doc.filename);
      }
    });
    message.success(`${selectedIds.length} document(s) download started`);
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

  const getDocumentTypeLabel = (type: string) => {
    const labels: Record<string, { label: string; color: string }> = {
      'COS': { label: 'Certificate of Satisfaction', color: 'green' },
      'EWA': { label: 'Emergency Work Agreement', color: 'blue' },
      'Invoice': { label: 'Invoice', color: 'gold' },
      'Sketch': { label: 'Sketch', color: 'cyan' },
      'Photo': { label: 'Photo', color: 'magenta' },
      'photo_report': { label: 'Photo Report', color: 'magenta' },
      'Other': { label: 'Other', color: 'default' },
      'annotated_pdf': { label: 'Annotated PDF', color: 'purple' },
    };
    return labels[type] || { label: type, color: 'default' };
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

  const isAllSelected = documents.length > 0 && selectedIds.length === documents.length;
  const isIndeterminate = selectedIds.length > 0 && selectedIds.length < documents.length;

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
            style={{ color: '#52c41a' }}
          />
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={cancelEditAmount}
            style={{ color: '#ff4d4f' }}
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

  return (
    <div>
      {/* Bulk action toolbar */}
      {documents.length > 0 && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Checkbox
            indeterminate={isIndeterminate}
            checked={isAllSelected}
            onChange={(e) => handleSelectAll(e.target.checked)}
          >
            Select All ({selectedIds.length}/{documents.length})
          </Checkbox>

          {selectedIds.length > 0 && (
            <Space>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleBulkDownload}
              >
                Download ({selectedIds.length})
              </Button>
              <Popconfirm
                title="Delete selected documents"
                description={`Are you sure you want to delete ${selectedIds.length} document(s)?`}
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
                  Delete ({selectedIds.length})
                </Button>
              </Popconfirm>
            </Space>
          )}
        </div>
      )}

      <List
        loading={loading}
        dataSource={documents}
        locale={{ emptyText: 'No documents yet' }}
        itemLayout={isMobile ? 'vertical' : 'horizontal'}
        renderItem={(doc) => {
        const typeInfo = getDocumentTypeLabel(doc.document_type);
        return (
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
                  {doc.document_type === 'Photo' || doc.document_type === 'photo_report' ? (
                    <FileImageOutlined style={{ fontSize: 32, color: '#eb2f96' }} />
                  ) : doc.document_type === 'Sketch' ? (
                    <FileOutlined style={{ fontSize: 32, color: '#13c2c2' }} />
                  ) : (
                    <FilePdfOutlined style={{ fontSize: 32, color: '#ff4d4f' }} />
                  )}
                </div>
              }
              title={
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                  <Tooltip title={doc.title && doc.title !== doc.filename ? doc.title : undefined}>
                    <Text strong style={{ wordBreak: 'break-word', overflowWrap: 'break-word', minWidth: 0 }}>{doc.filename}</Text>
                  </Tooltip>
                  <Tag color={typeInfo.color} style={{ marginLeft: 8 }}>
                    {typeInfo.label}
                  </Tag>
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
      }}
      />
    </div>
  );
});

WMDocumentList.displayName = 'WMDocumentList';

export default WMDocumentList;
