/**
 * Water Mitigation Document Upload Modal
 * Allows manual bulk upload of documents (COS, EWA, Invoice, Sketch, Photo, Other)
 * Invoice type includes amount field
 * Uses bulk upload API endpoint for efficient multi-file upload
 */

import React, { useState } from 'react';
import { Modal, Select, Input, InputNumber, Upload, Button, Space, Typography, message, Progress } from 'antd';
import { UploadOutlined, InboxOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import waterMitigationService from '../../services/waterMitigationService';

const { Text } = Typography;
const { Dragger } = Upload;
const { TextArea } = Input;

interface WMDocumentUploadModalProps {
  open: boolean;
  jobId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const UPLOAD_DOCUMENT_TYPES = [
  { value: 'COS', label: 'Certificate of Satisfaction (COS)' },
  { value: 'EWA', label: 'Emergency Work Agreement (EWA)' },
  { value: 'Invoice', label: 'Invoice' },
  { value: 'Sketch', label: 'Sketch' },
  { value: 'Photo', label: 'Photo' },
  { value: 'Photo Report', label: 'Photo Report' },
  { value: 'Other', label: 'Other' },
];

const WMDocumentUploadModal: React.FC<WMDocumentUploadModalProps> = ({
  open,
  jobId,
  onClose,
  onSuccess,
}) => {
  const [documentType, setDocumentType] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState<number | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  const resetForm = () => {
    setDocumentType(null);
    setTitle('');
    setDescription('');
    setInvoiceAmount(null);
    setFileList([]);
    setUploadProgress(null);
  };

  const handleClose = () => {
    if (uploading) return;
    resetForm();
    onClose();
  };

  const handleUpload = async () => {
    if (!documentType) {
      message.error('Please select a document type');
      return;
    }
    if (fileList.length === 0) {
      message.error('Please select a file to upload');
      return;
    }

    setUploading(true);
    const totalFiles = fileList.length;
    const invoiceAmountVal = documentType === 'Invoice' && invoiceAmount !== null ? invoiceAmount : undefined;

    try {
      if (totalFiles === 1) {
        // Single file: use existing single upload endpoint
        const file = fileList[0].originFileObj as File;
        await waterMitigationService.documents.uploadDocument(
          jobId,
          file,
          documentType,
          title || undefined,
          description || undefined,
          invoiceAmountVal
        );
      } else {
        // Multiple files: use bulk upload endpoint
        setUploadProgress({ current: 0, total: totalFiles });
        const files = fileList.map(f => f.originFileObj as File);
        await waterMitigationService.documents.bulkUploadDocuments(
          jobId,
          files,
          documentType,
          title || undefined,
          description || undefined,
          invoiceAmountVal
        );
        setUploadProgress({ current: totalFiles, total: totalFiles });
      }

      message.success(
        totalFiles === 1
          ? 'Document uploaded successfully'
          : `${totalFiles} documents uploaded successfully`
      );
      resetForm();
      onSuccess();
    } catch (error: any) {
      console.error('Failed to upload document:', error);
      const errorMessage = error?.response?.data?.detail || 'Failed to upload document';
      message.error(errorMessage);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const totalSize = fileList.reduce((sum, f) => sum + (f.size || 0), 0);
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Modal
      title="Upload Documents"
      open={open}
      onCancel={handleClose}
      maskClosable={!uploading}
      closable={!uploading}
      footer={[
        <Button key="cancel" onClick={handleClose} disabled={uploading}>
          Cancel
        </Button>,
        <Button
          key="upload"
          type="primary"
          icon={<UploadOutlined />}
          onClick={handleUpload}
          disabled={!documentType || fileList.length === 0}
          loading={uploading}
        >
          {fileList.length > 1
            ? `Upload ${fileList.length} Files`
            : 'Upload'}
        </Button>,
      ]}
      width={520}
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* Document Type */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Document Type *</Text>
          <Select
            style={{ width: '100%' }}
            placeholder="Select document type"
            value={documentType}
            onChange={setDocumentType}
            options={UPLOAD_DOCUMENT_TYPES}
            disabled={uploading}
          />
        </div>

        {/* Invoice Amount - only for Invoice type */}
        {documentType === 'Invoice' && (
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Invoice Amount</Text>
            <InputNumber
              style={{ width: '100%' }}
              value={invoiceAmount}
              onChange={(value) => setInvoiceAmount(value)}
              placeholder="Enter invoice amount"
              prefix="$"
              precision={2}
              min={0}
              disabled={uploading}
            />
          </div>
        )}

        {/* Title */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Title</Text>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional title"
            maxLength={200}
            disabled={uploading}
          />
        </div>

        {/* Description */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Description</Text>
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={2}
            maxLength={500}
            disabled={uploading}
          />
        </div>

        {/* File Upload */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Files *</Text>
          <Dragger
            fileList={fileList}
            onChange={({ fileList: newFileList }) => setFileList(newFileList)}
            beforeUpload={() => false}
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.tiff,.tif"
            disabled={uploading}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drag files to upload</p>
            <p className="ant-upload-hint">
              Select multiple files at once. PDF, Images, Word, Excel supported.
            </p>
          </Dragger>
        </div>

        {/* File summary */}
        {fileList.length > 0 && !uploading && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {fileList.length} file{fileList.length !== 1 ? 's' : ''} selected
            {totalSize > 0 && ` (${formatSize(totalSize)} total)`}
          </Text>
        )}

        {/* Upload progress */}
        {uploading && uploadProgress && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Uploading {uploadProgress.total} files...
            </Text>
            <Progress
              percent={Math.round((uploadProgress.current / uploadProgress.total) * 100)}
              size="small"
              status="active"
            />
          </div>
        )}
        {uploading && !uploadProgress && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Uploading...
            </Text>
            <Progress percent={0} size="small" status="active" />
          </div>
        )}
      </Space>
    </Modal>
  );
};

export default WMDocumentUploadModal;
