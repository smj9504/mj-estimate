/**
 * Water Mitigation Document List Component
 */

import React, { useEffect, useState } from 'react';
import { List, Button, Popconfirm, message, Tag, Typography, Checkbox, Space } from 'antd';
import { FilePdfOutlined, DownloadOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import waterMitigationService from '../../services/waterMitigationService';

const { Text } = Typography;

interface WMDocumentListProps {
  jobId: string;
  onDelete?: () => void;
}

interface Document {
  id: string;
  filename: string;
  document_type: string;
  file_size: number;
  photo_count: number;
  created_at: string;
}

const WMDocumentList = React.forwardRef<{ refresh: () => void }, WMDocumentListProps>(
  ({ jobId, onDelete }, ref) => {
    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [bulkDeleting, setBulkDeleting] = useState(false);

    const fetchDocuments = async () => {
    setLoading(true);
    try {
      const docs = await waterMitigationService.documents.getByJob(jobId);
      setDocuments(docs);
      setSelectedIds([]); // Clear selection when documents refresh
    } catch (error) {
      console.error('Failed to fetch documents:', error);
      message.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [jobId]);

  // Expose refresh method via ref
  React.useImperativeHandle(ref, () => ({
    refresh: fetchDocuments
  }));

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
      fetchDocuments();
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
      fetchDocuments();
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

  const getDocumentTypeLabel = (type: string) => {
    const labels: Record<string, { label: string; color: string }> = {
      'COS': { label: 'Certificate of Satisfaction', color: 'green' },
      'EWA': { label: 'Emergency Work Agreement', color: 'blue' }
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
        renderItem={(doc) => {
        const typeInfo = getDocumentTypeLabel(doc.document_type);
        return (
          <List.Item
            actions={[
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
              avatar={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={selectedIds.includes(doc.id)}
                    onChange={(e) => handleSelectOne(doc.id, e.target.checked)}
                  />
                  <FilePdfOutlined style={{ fontSize: 32, color: '#ff4d4f' }} />
                </div>
              }
              title={
                <div>
                  <Text strong>{doc.filename}</Text>
                  <Tag color={typeInfo.color} style={{ marginLeft: 8 }}>
                    {typeInfo.label}
                  </Tag>
                </div>
              }
              description={
                <div>
                  <Text type="secondary">
                    {formatFileSize(doc.file_size)} • {doc.photo_count} photo{doc.photo_count !== 1 ? 's' : ''} • Created {formatDate(doc.created_at)}
                  </Text>
                </div>
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
